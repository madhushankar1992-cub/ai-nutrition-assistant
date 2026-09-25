import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ChatResponseSchema, type ChatResponse } from "./schema";
import { SYSTEM_PROMPT } from "./systemPrompt";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.2; // low but nonzero: reduces run-to-run drift without hiding it entirely from evaluation

const SUBMIT_ANSWER_TOOL = {
  name: "submit_answer",
  description:
    "Submit the final structured answer: the answer text and a list of the factual claims it contains.",
  input_schema: zodToJsonSchema(ChatResponseSchema, "ChatResponse").definitions![
    "ChatResponse"
  ] as Anthropic.Tool.InputSchema,
};

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

class SchemaValidationError extends Error {}

async function callOnce(history: ConversationTurn[]): Promise<ChatResponse> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: SYSTEM_PROMPT,
    messages: history.map((turn) => ({ role: turn.role, content: turn.content })),
    tools: [SUBMIT_ANSWER_TOOL],
    tool_choice: { type: "tool", name: "submit_answer" },
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) {
    throw new SchemaValidationError("Model did not return a tool_use block");
  }

  const parsed = ChatResponseSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new SchemaValidationError(parsed.error.message);
  }

  return parsed.data;
}

/**
 * Calls Claude with structured output forced via tool-use. Retries once on
 * schema validation failure with an explicit correction nudge; callers should
 * treat a thrown error as a hard failure (logged as `invalid_schema`).
 */
export async function generateStructuredAnswer(
  history: ConversationTurn[]
): Promise<ChatResponse> {
  try {
    return await callOnce(history);
  } catch (err) {
    if (!(err instanceof SchemaValidationError)) throw err;

    const retryHistory: ConversationTurn[] = [
      ...history,
      {
        role: "user",
        content:
          "Your previous response did not match the required schema. " +
          "Call submit_answer again with valid `answer` (string) and `claims` " +
          "(array of { text: string, source: null }) fields.",
      },
    ];
    return await callOnce(retryHistory);
  }
}

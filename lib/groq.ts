import Groq from "groq-sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ChatResponseSchema, type ChatResponse } from "./schema";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { groqRateLimiter, estimateTokens } from "./rateLimiter";

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Default: openai/gpt-oss-120b. Override with GROQ_MODEL, e.g. "qwen/qwen3-32b".
const MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
// Kept modest (rather than the model's max) specifically to conserve the
// tokens-per-minute budget — see lib/rateLimiter.ts.
const MAX_TOKENS = 700;
const TEMPERATURE = 0.2; // low but nonzero: reduces run-to-run drift without hiding it entirely from evaluation

// Caps how much conversation history is sent per call, bounding both prompt
// token usage (rate-limit budget) and model context growth on long chats.
const MAX_HISTORY_TURNS = 8;

const RESPONSE_SCHEMA = zodToJsonSchema(ChatResponseSchema, "ChatResponse").definitions![
  "ChatResponse"
] as Record<string, unknown>;

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

class SchemaValidationError extends Error {}

const MAX_TRANSPORT_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads Retry-After (seconds or HTTP-date) off a rate-limit response, if present. */
function retryAfterMs(err: InstanceType<typeof Groq.RateLimitError>): number | null {
  const header = err.headers?.get?.("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = Date.parse(header);
  return Number.isNaN(dateMs) ? null : Math.max(dateMs - Date.now(), 0);
}

async function callOnce(history: ConversationTurn[]): Promise<ChatResponse> {
  const trimmedHistory = history.slice(-MAX_HISTORY_TURNS);
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...trimmedHistory.map((turn) => ({ role: turn.role, content: turn.content })),
  ];

  const estimatedTokens =
    messages.reduce((sum, m) => sum + estimateTokens(m.content), 0) + MAX_TOKENS;

  let attempt = 0;
  for (;;) {
    await groqRateLimiter.reserve(estimatedTokens);

    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        messages,
        // Structured Outputs (json_schema), not forced tool-calling: gpt-oss
        // reasoning models intermittently emit chain-of-thought text instead
        // of a clean tool call under forced tool_choice, which Groq's own
        // tool-call parser then rejects with a 400 `output_parse_failed`.
        // json_schema output goes into `message.content` as plain text
        // instead, sidestepping that parser entirely.
        reasoning_effort: "low",
        reasoning_format: "hidden",
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "chat_response",
            schema: RESPONSE_SCHEMA,
            strict: true,
          },
        },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new SchemaValidationError("Model returned no content");
      }

      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(content);
      } catch {
        throw new SchemaValidationError("Response content was not valid JSON");
      }

      const parsed = ChatResponseSchema.safeParse(parsedArgs);
      if (!parsed.success) {
        throw new SchemaValidationError(parsed.error.message);
      }

      return parsed.data;
    } catch (err) {
      // Transport-level failures (rate limit / transient 5xx / connection drop)
      // are retried with backoff, separately from schema-validation failures
      // (handled by the caller's single retry-with-correction).
      const isRateLimit = err instanceof Groq.RateLimitError;
      const isRetryableServerError =
        err instanceof Groq.InternalServerError || err instanceof Groq.APIConnectionError;

      if ((isRateLimit || isRetryableServerError) && attempt < MAX_TRANSPORT_RETRIES) {
        attempt += 1;
        const backoff = isRateLimit
          ? (retryAfterMs(err as InstanceType<typeof Groq.RateLimitError>) ?? 2000 * attempt)
          : 1000 * attempt;
        await sleep(backoff);
        continue;
      }

      throw err;
    }
  }
}

/**
 * Calls Groq (openai/gpt-oss-120b by default) with structured output forced
 * via a strict JSON schema response format. Retries once on schema
 * validation failure with an explicit correction nudge; callers should treat
 * a thrown error as a hard failure (logged as `invalid_schema`). Rate
 * limiting and transport-error backoff are handled internally (see
 * lib/rateLimiter.ts).
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
          "Respond again with valid JSON matching the schema: `answer` (string) and `claims` " +
          "(array of { text: string, source: null }) fields.",
      },
    ];
    return await callOnce(retryHistory);
  }
}

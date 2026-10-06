import Groq from "groq-sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { LlmResponseSchema, type LlmResponse } from "./schema";
import { SYSTEM_PROMPT_GENERAL, SYSTEM_PROMPT_RAG } from "./systemPrompt";
import { groqRateLimiter, estimateTokens } from "./rateLimiter";
import { setTimeout as delay } from "node:timers/promises";

// Created on first use, never at import. The SDK throws when GROQ_API_KEY is
// missing, and `next build` imports this module while collecting page data -
// so an eagerly created client failed every build that had no key in its
// environment (a Docker image build, for one). Requests still fail clearly at
// call time if the key is absent.
let groqClient: Groq | null = null;
function getClient(): Groq {
  if (!groqClient) {
    groqClient = new Groq({
      apiKey: process.env.GROQ_API_KEY,
      // Retries are managed below; SDK retries must not multiply that budget.
      maxRetries: 0,
      timeout: 30_000,
    });
  }
  return groqClient;
}

// Default: openai/gpt-oss-120b. Override with GROQ_MODEL, e.g. "qwen/qwen3-32b".
const MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
// Kept modest (rather than the model's max) specifically to conserve the
// tokens-per-minute budget — see lib/rateLimiter.ts.
/**
 * Wall-clock budget for one grounded answer, including rate-limit waits and
 * retries. Overridable so a slow model can be measured rather than guessed at.
 */
const GENERATION_DEADLINE_MS = Number(process.env.GENERATION_DEADLINE_MS) || 45_000;
const MAX_TOKENS = 700;
const TEMPERATURE = 0.2; // low but nonzero: reduces run-to-run drift without hiding it entirely from evaluation

// Caps how much conversation history is sent per call, bounding both prompt
// token usage (rate-limit budget) and model context growth on long chats.
const MAX_HISTORY_TURNS = 4;

// The model may emit a chunkId and NOTHING else citation-shaped, so it cannot
// fabricate a publisher or a year. (The Milestone 1 ungrounded path, its
// schema and its prompt had no runtime caller and were removed; every answer
// is grounded.)
const RAG_SCHEMA = zodToJsonSchema(LlmResponseSchema, "GroundedResponse").definitions![
  "GroundedResponse"
] as Record<string, unknown>;

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

class SchemaValidationError extends Error {}

const MAX_TRANSPORT_RETRIES = 3;

/** Reads Retry-After (seconds or HTTP-date) off a rate-limit response, if present. */
function retryAfterMs(err: InstanceType<typeof Groq.RateLimitError>): number | null {
  const header = err.headers?.get?.("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = Date.parse(header);
  return Number.isNaN(dateMs) ? null : Math.max(dateMs - Date.now(), 0);
}

async function callOnce(
  history: ConversationTurn[],
  systemExtra?: string,
  signal: AbortSignal = AbortSignal.timeout(45_000),
  basePrompt: string = SYSTEM_PROMPT_RAG
): Promise<any> {
  // Grounded calls carry retrieved passages, which dominate the token budget,
  // so history is trimmed hard: retrieval already supplies the grounding that
  // history was partly serving.
  const trimmedHistory = history.slice(-MAX_HISTORY_TURNS);
  const messages = [
    {
      role: "system" as const,
      content: systemExtra ? `${basePrompt}\n\n${systemExtra}` : basePrompt,
    },
    ...trimmedHistory.map((turn) => ({ role: turn.role, content: turn.content })),
  ];

  const estimatedTokens =
    messages.reduce((sum, m) => sum + estimateTokens(m.content), 0) + MAX_TOKENS;

  let attempt = 0;
  for (;;) {
    signal.throwIfAborted();
    await groqRateLimiter.reserve(estimatedTokens, signal);

    try {
      const response = await getClient().chat.completions.create({
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
            schema: RAG_SCHEMA,
            strict: true,
          },
        },
      }, { signal });

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

      const parsed = LlmResponseSchema.safeParse(parsedArgs);
      if (!parsed.success) {
        throw new SchemaValidationError(parsed.error.message);
      }

      return parsed.data;
    } catch (err) {
      signal.throwIfAborted();
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
        await delay(backoff, undefined, { signal });
        continue;
      }

      throw err;
    }
  }
}

/**
 * Grounded generation: the model sees ONLY the supplied passages and may cite
 * them by chunkId. It cannot emit a publisher or a year, so a fabricated
 * citation is not expressible in the schema it is held to.
 */
export async function generateGroundedAnswer(
  history: ConversationTurn[],
  passages: string
): Promise<LlmResponse> {
  const signal = AbortSignal.timeout(GENERATION_DEADLINE_MS);
  const systemExtra = `REFERENCE PASSAGES — the only material you may answer from:

${passages}`;
  try {
    return await callOnce(history, systemExtra, signal);
  } catch (err) {
    if (!(err instanceof SchemaValidationError)) throw err;
    return await callOnce(
      [
        ...history,
        {
          role: "user",
          content:
            "Your previous response did not match the required schema. Respond again " +
            "with valid JSON: `answer` (string) and `claims` (array of { text, chunkId }), " +
            "where every chunkId is copied exactly from a supplied passage.",
        },
      ],
      systemExtra,
      signal
    );
  }
}

/**
 * General-knowledge generation (the second tier, added 2026-10-06).
 *
 * Called ONLY when retrieval fails the sufficiency gate. The model sees no
 * passages and answers food, nutrition, cooking and food-safety questions from
 * general knowledge under SYSTEM_PROMPT_GENERAL, which carries the same topic
 * restriction, out-of-scope rules and population framing as the grounded tier.
 *
 * It is held to the same structured-output schema, but `claims` is forced to
 * an empty list here regardless of what the model emits: with no retrieved
 * passages there is nothing a claim could be bound to, so a citation on a
 * general answer could only be fabricated. The rate limiter and the generation
 * deadline apply exactly as for a grounded call.
 */
export async function generateGeneralAnswer(
  history: ConversationTurn[]
): Promise<LlmResponse> {
  const signal = AbortSignal.timeout(GENERATION_DEADLINE_MS);
  let result: LlmResponse;
  try {
    result = await callOnce(history, undefined, signal, SYSTEM_PROMPT_GENERAL);
  } catch (err) {
    if (!(err instanceof SchemaValidationError)) throw err;
    result = await callOnce(
      [
        ...history,
        {
          role: "user",
          content:
            "Your previous response did not match the required schema. Respond again " +
            'with valid JSON: `answer` (string) and `claims` (an empty array).',
        },
      ],
      undefined,
      signal,
      SYSTEM_PROMPT_GENERAL
    );
  }
  return { answer: result.answer, claims: [] };
}

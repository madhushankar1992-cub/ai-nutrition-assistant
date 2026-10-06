// Answer cache: serve a repeated first question without spending Groq quota.
//
// Why: Groq's free tier allows ~8,000 tokens a minute for the whole site, and
// one answer costs ~3,500-4,500 of them, so the site can serve only one or two
// fresh answers a minute. Popular questions ("how much salt per day?") and
// impatient repeats were each paying full price. A cached answer costs zero
// tokens and returns in milliseconds, which leaves the budget for questions
// nobody has asked yet.
//
// Correctness rules - a cached answer must be exactly what a fresh call would
// have been allowed to return:
//   - Only the FIRST question of a conversation is cached. With history, the
//     same words can mean something different, so those are never served from
//     cache.
//   - Only successful grounded or general answers are stored. Refusals cost no
//     tokens (the scope guard and gates run in code), and errors or capacity
//     replies must never be replayed.
//   - The key includes the question (normalised), the documentKey filter, the
//     retrieval config hash, a hash of both system prompts, and the corpus
//     version (the latest document refresh time). Changing any of them -
//     a prompt edit, a config change, the daily re-ingest - misses the cache,
//     so no answer outlives the corpus it was built from.
//
// The cache is in memory on the backend container: it resets on deploy or
// restart and is not shared between instances. That is acceptable - it is an
// optimisation, never a source of truth.

import { createHash } from "node:crypto";
import { prisma } from "./db";
import { RETRIEVAL_CONFIG_HASH } from "./retrievalConfig";
import { SYSTEM_PROMPT_GENERAL, SYSTEM_PROMPT_RAG } from "./systemPrompt";

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const CORPUS_VERSION_TTL_MS = 5 * 60 * 1000;

export const PROMPT_VERSION = createHash("sha256")
  .update(SYSTEM_PROMPT_RAG)
  .update("\u0000")
  .update(SYSTEM_PROMPT_GENERAL)
  .digest("hex")
  .slice(0, 12);

export interface CachedAnswer {
  answer: string;
  claims: unknown[];
  answerMode: "grounded" | "general";
  retrieval: unknown;
}

interface Entry {
  value: CachedAnswer;
  expiresAt: number;
}

const globalForCache = globalThis as unknown as {
  answerCache?: Map<string, Entry>;
  corpusVersion?: { value: string; fetchedAt: number };
};
const store: Map<string, Entry> = (globalForCache.answerCache ??= new Map());

/** Latest corpus refresh, cached briefly so a lookup costs at most one cheap query. */
async function corpusVersion(): Promise<string> {
  const cached = globalForCache.corpusVersion;
  if (cached && Date.now() - cached.fetchedAt < CORPUS_VERSION_TTL_MS) return cached.value;
  const latest = await prisma.document.findFirst({
    orderBy: { retrievedAt: "desc" },
    select: { retrievedAt: true },
  });
  const value = latest?.retrievedAt?.toISOString() ?? "none";
  globalForCache.corpusVersion = { value, fetchedAt: Date.now() };
  return value;
}

/** Same question, different spacing, case or trailing punctuation -> same key. */
export function normaliseQuestion(message: string): string {
  return message
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s?!.]+$/, "")
    .trim();
}

async function keyFor(message: string, documentKey: string | null | undefined): Promise<string> {
  return createHash("sha256")
    .update(
      [
        normaliseQuestion(message),
        documentKey ?? "",
        RETRIEVAL_CONFIG_HASH,
        PROMPT_VERSION,
        await corpusVersion(),
      ].join("\u0000")
    )
    .digest("hex");
}

export async function getCachedAnswer(
  message: string,
  documentKey: string | null | undefined
): Promise<CachedAnswer | null> {
  try {
    const key = await keyFor(message, documentKey);
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      store.delete(key);
      return null;
    }
    // Refresh recency, so the eviction below drops the least recently used.
    store.delete(key);
    store.set(key, entry);
    return entry.value;
  } catch {
    return null; // a cache problem must never fail a request
  }
}

export async function setCachedAnswer(
  message: string,
  documentKey: string | null | undefined,
  value: CachedAnswer
): Promise<void> {
  try {
    const key = await keyFor(message, documentKey);
    store.set(key, { value, expiresAt: Date.now() + TTL_MS });
    while (store.size > MAX_ENTRIES) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  } catch {
    // Not caching is always safe.
  }
}

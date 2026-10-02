// Retrieval: find the passages that answer a question, and decide whether they
// actually do.
//
// Two things happen here that pure vector search does not give you:
//
// 1. HYBRID RE-RANKING. Measured problem: "How long can I keep cooked
//    leftovers in the fridge?" returned an FSA passage about changing the
//    fridge power setting (0.817) ABOVE the passage carrying the 48-hour rule.
//    Both are from the same document and both are "about fridges", so the
//    embedding cannot separate them — but the question's distinctive words
//    (leftovers, keep, long) appear in one and not the other. So candidates are
//    fetched by vector, then re-scored with lexical overlap.
//
// 2. A SUFFICIENCY GATE. If the best passages are weak, the model is never
//    asked to write an answer from them. Handed thin material a capable model
//    writes a confident wrong answer, which is the quietest way grounding
//    fails.

import { embedQuery } from "./corpus/embeddings";
import { queryChunks, type RetrievedChunk } from "./corpus/vectorStore";
import { RETRIEVAL_CONFIG } from "./retrievalConfig";

/** Fetch this many times k before re-ranking, so the right chunk can climb. */
const CANDIDATE_MULTIPLIER = 4;

/** How much lexical overlap can move a result. Vector score stays dominant. */
const LEXICAL_WEIGHT = 0.35;

// Words too common in this corpus to carry signal. Everything is about food.
const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","by","can","do","does","for","from","how",
  "i","in","is","it","long","many","much","my","of","on","or","should","that",
  "the","to","was","what","when","where","which","who","will","with","you","your",
  "me","if","they","this","there","have","has","had","been","would","could","about",
]);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Lexical relevance by term DENSITY, not presence.
 *
 * Binary presence was tried first and failed in a specific, measurable way:
 * every top candidate scored 1.000 because the HTML chunks were large enough
 * (up to 757 tokens) to contain all of "fridge", "keep", "long" and
 * "leftovers" somewhere, even when the passage was about fridge power
 * settings. A metric that saturates cannot rank.
 *
 * Density fixes that: a passage mentioning "leftovers" twice in 200 tokens
 * beats one mentioning it once in 700. Scores are normalised per 100 tokens
 * and averaged over the query's distinctive terms, so a passage must be about
 * the question rather than merely contain its words.
 */
function lexicalRelevance(queryTerms: string[], passage: string): number {
  if (!queryTerms.length) return 0;

  const haystack = " " + passage.toLowerCase().replace(/[^a-z0-9\s-]/g, " ") + " ";
  const passageTokens = Math.max(1, haystack.split(/\s+/).length);

  let total = 0;
  for (const term of queryTerms) {
    // Crude stemming: "leftovers" should match "leftover".
    const stem = term.replace(/(ies|es|s)$/, "");
    const needle = stem.length > 3 ? stem : term;
    const occurrences = haystack.split(needle).length - 1;
    if (!occurrences) continue;

    // Occurrences per 100 tokens, capped so one keyword-stuffed passage cannot
    // dominate on a single term.
    const density = (occurrences / passageTokens) * 100;
    total += Math.min(density, 2) / 2;
  }
  return total / queryTerms.length;
}

export interface ScoredChunk extends RetrievedChunk {
  vectorScore: number;
  lexicalScore: number;
}

export interface RetrievalResult {
  chunks: ScoredChunk[];
  sufficient: boolean;
  reason: string;
  documentsSearched: { sourceKey: string; name: string; publisher: string; year: number }[];
  k: number;
}

/** Documents available to search — used to say what was searched on a refusal. */
async function listSearchedDocuments(chunks: RetrievedChunk[]) {
  const seen = new Map<string, { sourceKey: string; name: string; publisher: string; year: number }>();
  for (const c of chunks) {
    if (!seen.has(c.sourceKey)) {
      seen.set(c.sourceKey, {
        sourceKey: c.sourceKey, name: c.documentName,
        publisher: c.publisher, year: c.year,
      });
    }
  }
  return [...seen.values()];
}

/**
 * Is this set of passages good enough to answer from?
 *
 * Deliberately a simple, inspectable threshold rule. The alternative — asking
 * the model to judge its own retrieval — costs a call and produces a decision
 * that cannot be unit-tested.
 */
function assessSufficiency(chunks: ScoredChunk[]): { sufficient: boolean; reason: string } {
  if (!chunks.length) {
    return { sufficient: false, reason: "no passages matched the question" };
  }
  const top = chunks[0];
  if (top.score < RETRIEVAL_CONFIG.absoluteFloor) {
    return {
      sufficient: false,
      reason: `best match scored ${top.score.toFixed(2)}, below the ${RETRIEVAL_CONFIG.absoluteFloor} floor`,
    };
  }
  const relevant = chunks.filter((c) => c.score >= RETRIEVAL_CONFIG.relevanceFloor);
  if (!relevant.length) {
    return {
      sufficient: false,
      reason: `no passage reached the ${RETRIEVAL_CONFIG.relevanceFloor} relevance threshold`,
    };
  }
  return { sufficient: true, reason: `${relevant.length} relevant passage(s)` };
}

export async function retrieve(
  question: string,
  options: { k?: number; documentKey?: string | null } = {}
): Promise<RetrievalResult> {
  const k = options.k ?? RETRIEVAL_CONFIG.k;
  const queryVector = await embedQuery(question);

  // Over-fetch, then re-rank. The right passage is often present but not first.
  const candidates = await queryChunks(
    queryVector,
    k * CANDIDATE_MULTIPLIER,
    options.documentKey ?? undefined
  );

  const qTerms = terms(question);
  const scored: ScoredChunk[] = candidates
    .map((c) => {
      const lexicalScore = lexicalRelevance(qTerms, c.text);
      return {
        ...c,
        vectorScore: c.score,
        lexicalScore,
        score: c.score * (1 - LEXICAL_WEIGHT) + lexicalScore * LEXICAL_WEIGHT,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  const { sufficient, reason } = assessSufficiency(scored);

  return {
    chunks: scored,
    sufficient,
    reason,
    documentsSearched: await listSearchedDocuments(candidates),
    k,
  };
}

/** Render retrieved passages for the prompt, each tagged with its chunkId. */
export function formatPassages(chunks: ScoredChunk[]): string {
  return chunks
    .map(
      (c, i) =>
        `[PASSAGE ${i + 1}] chunkId=${c.id} | ${c.publisher} (${c.year}) | ${c.documentName}` +
        (c.section ? ` | §${c.section}` : "") +
        `\n${c.text.replace(/\s+/g, " ").trim()}`
    )
    .join("\n\n");
}

export { LEXICAL_WEIGHT, CANDIDATE_MULTIPLIER };

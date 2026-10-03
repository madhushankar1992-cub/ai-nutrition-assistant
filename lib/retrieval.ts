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
//    (leftovers, keep) appear in one and not the other. Note "long" is NOT one
//    of them - it is in STOPWORDS below, because it carries no signal here. So candidates are
//    fetched by vector, then re-scored with lexical overlap.
//
// 2. A SUFFICIENCY GATE. If the best passages are weak, the model is never
//    asked to write an answer from them. Handed thin material a capable model
//    writes a confident wrong answer, which is the quietest way grounding
//    fails.

import { embedQuery } from "./corpus/embeddings";
import { queryChunks, listSearchableDocuments, type RetrievedChunk } from "./corpus/vectorStore";
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

/** Crude stemming: "leftovers" should match "leftover". */
function stemOf(term: string): string {
  const stem = term.replace(/(ies|es|s)$/, "");
  return stem.length > 3 ? stem : term;
}

function occurrencesOf(needle: string, haystack: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * How much each query term is worth, measured against the candidate pool.
 *
 * A term shared by every candidate cannot separate them, however important it
 * looks in the question. This is the measured failure: for "What is the dietary
 * fibre REFERENCE VALUE for ADULTS?" against EFSA's reference-values report,
 * "reference", "value" and "adults" appear in nearly every candidate, so an
 * equal-weight average let three bibliography chunks score 0.58-0.60 while the
 * passage actually stating 25 g/day scored no better. Only "fibre" discriminates.
 *
 * Weighting by inverse candidate frequency is computed over the retrieved pool
 * rather than the whole corpus: the job here is to separate THESE candidates
 * from one another, and it needs no corpus statistics, no extra query, and no
 * index to keep in sync.
 */
function candidateIdf(queryTerms: string[], passages: string[]): Map<string, number> {
  const idf = new Map<string, number>();
  const n = Math.max(1, passages.length);

  for (const term of queryTerms) {
    const needle = stemOf(term);
    const df = passages.filter((p) => p.includes(needle)).length;
    // log(1 + N/df): ~0 when every candidate has it, highest when one does.
    idf.set(term, Math.log(1 + (n - df) / n) / Math.log(2));
  }
  return idf;
}

/**
 * Lexical relevance by term DENSITY, weighted by how distinctive each term is.
 *
 * Binary presence was tried first and failed in a specific, measurable way:
 * every top candidate scored 1.000 because the HTML chunks were large enough
 * (up to 757 tokens) to contain all of "fridge", "keep", "long" and
 * "leftovers" somewhere, even when the passage was about fridge power
 * settings. A metric that saturates cannot rank.
 *
 * Density fixes that — a passage mentioning "leftovers" twice in 200 tokens
 * beats one mentioning it once in 700 — and the IDF weight above fixes the
 * remaining half of the problem, where a passage scored well on words every
 * candidate shared.
 */
function lexicalRelevance(
  queryTerms: string[],
  passage: string,
  idf: Map<string, number>
): number {
  if (!queryTerms.length) return 0;

  const haystack = " " + passage.toLowerCase().replace(/[^a-z0-9\s-]/g, " ") + " ";
  const passageTokens = Math.max(1, haystack.split(/\s+/).length);

  let total = 0;
  let weightSum = 0;
  for (const term of queryTerms) {
    const weight = idf.get(term) ?? 0;
    weightSum += weight;
    if (weight === 0) continue;

    const occurrences = occurrencesOf(stemOf(term), haystack);
    if (!occurrences) continue;

    // Occurrences per 100 tokens, capped so one keyword-stuffed passage cannot
    // dominate on a single term.
    const density = (occurrences / passageTokens) * 100;
    total += (Math.min(density, 2) / 2) * weight;
  }

  // Every term equally common across candidates: lexical signal says nothing,
  // so return 0 and let the vector score decide rather than inventing a tie-break.
  return weightSum > 0 ? total / weightSum : 0;
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
  const normalised = candidates.map((c) => c.text.toLowerCase().replace(/[^a-z0-9\s-]/g, " "));
  const idf = candidateIdf(qTerms, normalised);

  const ranked: ScoredChunk[] = candidates
    .map((c) => {
      const lexicalScore = lexicalRelevance(qTerms, c.text, idf);
      return {
        ...c,
        vectorScore: c.score,
        lexicalScore,
        score: c.score * (1 - LEXICAL_WEIGHT) + lexicalScore * LEXICAL_WEIGHT,
      };
    })
    .sort((a, b) => b.score - a.score);

  const scored = ranked.slice(0, k);
  // Keep the strongest passage, while making room for a near-tied source
  // when repeated passages from one publisher would crowd it out.
  for (const candidate of ranked.slice(k)) {
    if (candidate.score < RETRIEVAL_CONFIG.relevanceFloor) break;
    if (scored.some((c) => c.sourceKey === candidate.sourceKey)) continue;
    const replace = scored.findLastIndex((c, index) =>
      index > 0 && scored.some((other, j) => j !== index && other.sourceKey === c.sourceKey)
    );
    if (replace < 0 || scored[replace].score - candidate.score > RETRIEVAL_CONFIG.sourceDiversityMargin) continue;
    scored[replace] = candidate;
  }
  scored.sort((a, b) => b.score - a.score);

  const { sufficient, reason } = assessSufficiency(scored);

  return {
    chunks: scored,
    sufficient,
    reason,
    documentsSearched: await listSearchableDocuments(options.documentKey ?? undefined),
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

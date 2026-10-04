// Every knob that changes retrieval results, in one frozen object with a hash.
//
// Milestone 1 already versions the prompt (now sha256(SYSTEM_PROMPT_RAG)) so that
// "rerun all 10 questions after every prompt change" produces comparable
// numbers. Retrieval needs the same discipline: changing k or the chunk size
// changes results as surely as changing the prompt does.
//
// The hash is stored on every chunk in Postgres and on every eval run, so a chunk
// produced by an older config is detectable with a query rather than by memory.

import { createHash } from "node:crypto";

export const RETRIEVAL_CONFIG = {
  // Chunking
  chunkTargetTokens: 500,
  chunkHardCapTokens: 900,
  chunkOverlapTokens: 80,
  minChunkTokens: 120,

  // Page classification
  lowTextPageFloor: 40,
  minProseDensity: 1.2,
  tableDigitRatio: 0.12,

  // Embedding — local ONNX, not a hosted API. Groq has no embeddings endpoint.
  embeddingModel: "Xenova/bge-small-en-v1.5",
  // Weight precision is part of the identity of an embedding: int8 and fp32
  // vectors of the same text are not the same vector. Including it here means
  // changing it marks every existing chunk stale instead of silently mixing
  // two quantisations in one index.
  embeddingDtype: "q8",
  embeddingDimensions: 384,

  // Index
  vectorStore: "pgvector",
  indexType: "hnsw-cosine",
  k: 5,
  // Prefer another publisher over a near-tied duplicate passage.
  sourceDiversityMargin: 0.03,

  // Sufficiency gate — CALIBRATED against the question bank, not guessed.
  //
  // Measured separation on the real corpus:
  //   off-corpus   "best wine with lamb"      0.338
  //   off-corpus   "ferment kimchi at home"   0.450
  //   ---- threshold 0.55 ----
  //   in-corpus    "salt per day"             0.698
  //   in-corpus    "fibre reference value"    0.733
  //   in-corpus    "leftovers in the fridge"  0.796
  //   in-corpus    "fridge temperature"       0.857
  //
  // 0.55 sits in the gap with margin on both sides. Re-calibrate whenever the
  // chunking or embedding model changes, because both move these scores.
  absoluteFloor: 0.50,
  relevanceFloor: 0.55,
} as const;

export type RetrievalConfig = typeof RETRIEVAL_CONFIG;

export const RETRIEVAL_CONFIG_HASH = createHash("sha256")
  .update(JSON.stringify(RETRIEVAL_CONFIG))
  .digest("hex")
  .slice(0, 10);

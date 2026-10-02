// Every knob that changes retrieval results, in one frozen object with a hash.
//
// Milestone 1 already versions the prompt (sha256(SYSTEM_PROMPT)) so that
// "rerun all 10 questions after every prompt change" produces comparable
// numbers. Retrieval needs the same discipline: changing k or the chunk size
// changes results as surely as changing the prompt does.
//
// The hash is stored on every chunk in Chroma and on every eval run, so a chunk
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
  embeddingDimensions: 384,

  // Index
  vectorStore: "pgvector",
  indexType: "hnsw-cosine",
  k: 5,

  // Sufficiency gate — calibrated against the question bank, not guessed.
  absoluteFloor: 0.30,
  relevanceFloor: 0.35,
} as const;

export type RetrievalConfig = typeof RETRIEVAL_CONFIG;

export const RETRIEVAL_CONFIG_HASH = createHash("sha256")
  .update(JSON.stringify(RETRIEVAL_CONFIG))
  .digest("hex")
  .slice(0, 10);

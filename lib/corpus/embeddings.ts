// Embeddings via BAAI/bge-small-en-v1.5, run locally through ONNX.
//
// Why local rather than a hosted API:
//   - Groq serves generation only and has no embeddings endpoint, so an embedding
//     provider is a new dependency either way. A local model makes it a build
//     dependency instead of a runtime credential and a new failure domain.
//   - The corpus is ~300-400 chunks. The entire corpus embeds in well under a
//     minute on CPU, so there is nothing to gain from a network round trip.
//   - Query embedding stays in-process, so the request path never waits on a
//     third party that can rate-limit or go down mid-conversation.
//
// Cost: the ONNX weights (~130 MB) download on first use and are cached. In CI
// that cache is warmed by actions/cache; see .github/workflows.
//
// IMPORTANT — bge models are asymmetric. A passage is embedded as-is, but a
// QUERY must carry the instruction prefix below or retrieval quality drops
// noticeably. Getting this backwards is a silent quality bug, not an error.

import type { FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBEDDING_DIMENSIONS = 384;

/** Prefix prescribed by the bge authors for short query -> long passage retrieval. */
export const QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: ";

const EMBED_BATCH_SIZE = 32;

type Pipe = FeatureExtractionPipeline;

// One model instance per process. Loading is slow (weights + ONNX session), so
// it is cached on globalThis to survive Next.js hot reloads, the same pattern
// lib/db.ts uses for Prisma.
const globalForEmbed = globalThis as unknown as { bgePipeline?: Promise<Pipe> };

async function getPipeline(): Promise<Pipe> {
  if (!globalForEmbed.bgePipeline) {
    globalForEmbed.bgePipeline = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      return (await pipeline("feature-extraction", EMBEDDING_MODEL, {
        dtype: "fp32",
      })) as Pipe;
    })();
  }
  return globalForEmbed.bgePipeline;
}

/** Load the model without embedding anything — lets callers pay the cost up front. */
export async function warmUp(): Promise<void> {
  await getPipeline();
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const extractor = await getPipeline();
  // bge uses CLS pooling; normalising makes cosine similarity a dot product,
  // which is also what Chroma's default distance expects.
  const output = await extractor(texts, { pooling: "cls", normalize: true });
  const data = output.tolist() as number[][];

  for (const vec of data) {
    if (vec.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding dimension mismatch: got ${vec.length}, expected ${EMBEDDING_DIMENSIONS}. ` +
          `The model changed — the Chroma collection and any stored vectors must be rebuilt.`
      );
    }
  }
  return data;
}

/**
 * Embed corpus passages. Text is used as-is: no query prefix.
 * `onProgress` reports completed count so long ingests are not silent.
 */
export async function embedPassages(
  texts: string[],
  onProgress?: (done: number, total: number) => void
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    out.push(...(await embedBatch(batch)));
    onProgress?.(Math.min(i + batch.length, texts.length), texts.length);
  }
  return out;
}

/** Embed a user question. The bge query instruction is applied here, once. */
export async function embedQuery(query: string): Promise<number[]> {
  const [vec] = await embedBatch([QUERY_INSTRUCTION + query]);
  return vec;
}

export { EMBED_BATCH_SIZE };

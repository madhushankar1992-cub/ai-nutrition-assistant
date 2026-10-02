// Chroma Cloud (trychroma.com) — the vector store.
//
// HOW THE DATA GETS THERE
// -----------------------
// Chroma Cloud is a hosted HTTPS service at api.trychroma.com. There is no
// local database file and nothing to self-host: the client below authenticates
// with an API key and writes over the network.
//
//   1. ingest scrapes a document and chunks it            (fetcher/chunker)
//   2. each chunk is embedded locally with bge-small       (embeddings.ts)
//   3. chunks + vectors + metadata are UPSERTED to a
//      collection in your Chroma Cloud database            (this file)
//   4. at query time the question is embedded the same way
//      and sent as queryEmbeddings; Chroma returns the
//      nearest chunks WITH their metadata, which is what
//      the citation is built from
//
// We pass embeddings explicitly rather than letting Chroma embed for us, so the
// exact same model (bge-small-en-v1.5, 384 dims) is used for corpus and query.
// Letting the server pick its own model would silently mix vector spaces.
//
// IDs are deterministic — `${sourceKey}:${configHash}:${ordinal}` — so re-running
// ingest updates rows in place instead of duplicating them. That is what makes
// the daily scheduled run safe to repeat.

import type { Chunk } from "./chunker";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "./embeddings";
import type { CorpusSourceDef } from "./sources";

export const DEFAULT_COLLECTION = "nutrition-guidance";

export interface ChromaConfig {
  apiKey: string;
  tenant: string;
  database: string;
  collection: string;
}

/** Metadata stored beside every vector. This is what a citation is built from. */
export interface ChunkMetadata {
  [key: string]: string | number | boolean;
  sourceKey: string;
  documentName: string;
  publisher: string;
  year: number;
  url: string;
  section: string;
  sectionConfidence: string;
  page: number;
  kind: string;
  restricted: boolean;
  tokenCount: number;
  configHash: string;
  embeddingModel: string;
}

export class ChromaConfigError extends Error {
  constructor(missing: string[]) {
    super(
      `Chroma Cloud is not configured — missing ${missing.join(", ")}.\n\n` +
        `Get these from https://trychroma.com → your database → "Connect":\n` +
        `  CHROMA_API_KEY=ck-...\n` +
        `  CHROMA_TENANT=<tenant uuid>\n` +
        `  CHROMA_DATABASE=<database name>\n\n` +
        `Put them in .env.local for local runs, and in GitHub repository secrets ` +
        `for the scheduled workflow.`
    );
    this.name = "ChromaConfigError";
  }
}

export function readChromaConfig(): ChromaConfig {
  const apiKey = process.env.CHROMA_API_KEY?.trim();
  const tenant = process.env.CHROMA_TENANT?.trim();
  const database = process.env.CHROMA_DATABASE?.trim();

  const missing: string[] = [];
  if (!apiKey) missing.push("CHROMA_API_KEY");
  if (!tenant) missing.push("CHROMA_TENANT");
  if (!database) missing.push("CHROMA_DATABASE");
  if (missing.length) throw new ChromaConfigError(missing);

  return {
    apiKey: apiKey!,
    tenant: tenant!,
    database: database!,
    collection: process.env.CHROMA_COLLECTION?.trim() || DEFAULT_COLLECTION,
  };
}

export function isChromaConfigured(): boolean {
  return Boolean(
    process.env.CHROMA_API_KEY && process.env.CHROMA_TENANT && process.env.CHROMA_DATABASE
  );
}

async function getCollection(config: ChromaConfig) {
  const { CloudClient } = await import("chromadb");
  const client = new CloudClient({
    apiKey: config.apiKey,
    tenant: config.tenant,
    database: config.database,
  });

  // embeddingFunction is null on purpose: we always supply vectors ourselves.
  return client.getOrCreateCollection({
    name: config.collection,
    embeddingFunction: null,
    metadata: {
      description: "Official public dietary guidance passages with provenance",
      embeddingModel: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
    },
  });
}

export function chunkId(sourceKey: string, configHash: string, ordinal: number): string {
  return `${sourceKey}:${configHash}:${ordinal}`;
}

export function buildMetadata(
  source: CorpusSourceDef,
  chunk: Chunk,
  configHash: string
): ChunkMetadata {
  return {
    sourceKey: source.key,
    documentName: source.name,
    publisher: source.publisher,
    year: source.year,
    url: source.url,
    section: chunk.section,
    sectionConfidence: chunk.sectionConfidence,
    page: chunk.page,
    kind: chunk.kind,
    restricted: chunk.restricted,
    tokenCount: chunk.tokenCount,
    configHash,
    embeddingModel: EMBEDDING_MODEL,
  };
}

export interface UpsertBatch {
  ids: string[];
  embeddings: number[][];
  documents: string[];
  metadatas: ChunkMetadata[];
}

/** Chroma rejects very large payloads; keep each HTTP call modest. */
const UPSERT_BATCH_SIZE = 100;

export async function upsertChunks(
  batch: UpsertBatch,
  config: ChromaConfig,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const collection = await getCollection(config);
  const total = batch.ids.length;

  for (let i = 0; i < total; i += UPSERT_BATCH_SIZE) {
    const end = Math.min(i + UPSERT_BATCH_SIZE, total);
    await collection.upsert({
      ids: batch.ids.slice(i, end),
      embeddings: batch.embeddings.slice(i, end),
      documents: batch.documents.slice(i, end),
      metadatas: batch.metadatas.slice(i, end),
    });
    onProgress?.(end, total);
  }
  return total;
}

/**
 * Remove chunks from a previous config version of one document.
 *
 * Without this, changing chunk size would leave the old chunks in the
 * collection alongside the new ones and retrieval would mix two incompatible
 * chunkings of the same text.
 */
export async function deleteStaleChunks(
  sourceKey: string,
  currentConfigHash: string,
  config: ChromaConfig
): Promise<void> {
  const collection = await getCollection(config);
  await collection.delete({
    where: {
      $and: [{ sourceKey: { $eq: sourceKey } }, { configHash: { $ne: currentConfigHash } }],
    },
  });
}

export interface RetrievedChunk {
  id: string;
  text: string;
  score: number;
  metadata: ChunkMetadata;
}

/** Query Chroma Cloud. `documentKey` restricts retrieval to one named document. */
export async function queryChunks(
  queryEmbedding: number[],
  k: number,
  config: ChromaConfig,
  documentKey?: string
): Promise<RetrievedChunk[]> {
  const collection = await getCollection(config);
  const result = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: k,
    // The filter is applied server-side by Chroma, not after the fact: a
    // post-filter would return fewer than k whenever the named document is not
    // already in the global top-k, which is exactly when it matters.
    where: documentKey ? { sourceKey: { $eq: documentKey } } : undefined,
  });

  const ids = result.ids?.[0] ?? [];
  const docs = result.documents?.[0] ?? [];
  const metas = result.metadatas?.[0] ?? [];
  const distances = result.distances?.[0] ?? [];

  return ids.map((id, i) => ({
    id,
    text: docs[i] ?? "",
    // Vectors are normalised, so Chroma's cosine distance maps to similarity.
    score: distances[i] != null ? 1 - distances[i]! : 0,
    metadata: (metas[i] ?? {}) as ChunkMetadata,
  }));
}

export async function collectionStats(config: ChromaConfig): Promise<{ name: string; count: number }> {
  const collection = await getCollection(config);
  return { name: config.collection, count: await collection.count() };
}

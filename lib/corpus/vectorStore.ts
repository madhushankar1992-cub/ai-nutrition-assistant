// Vector storage and similarity search, using pgvector in the Postgres both
// deployments already share.
//
// This replaced Chroma Cloud. The reasons are worth keeping:
//   - Chroma Cloud added a third hosted provider and a third credential for a
//     corpus of a few hundred chunks.
//   - Its availability was outside our control, and an outage took the whole
//     ingest pipeline down with it.
//   - pgvector puts the index beside the provenance data a citation is built
//     from, so retrieval and citation cannot drift apart.
//
// Prisma has no native vector type, so the embedding column is created by raw
// SQL in the migration and every similarity query goes through $queryRaw. The
// query vector is ALWAYS bound as a parameter, never interpolated — it derives
// from user text, and interpolating it would reintroduce injection at the one
// layer the ORM does not cover.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { EMBEDDING_DIMENSIONS } from "./embeddings";

/** pgvector literal format: '[0.1,0.2,...]'. */
function toVectorLiteral(vec: number[]): string {
  if (vec.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding dimension mismatch: got ${vec.length}, expected ${EMBEDDING_DIMENSIONS}.`
    );
  }
  return `[${vec.join(",")}]`;
}

export interface ChunkRow {
  ordinal: number;
  section: string;
  sectionConfidence: string;
  page: number;
  text: string;
  tokenCount: number;
  kind: string;
}

export interface DocumentRecord {
  sourceKey: string;
  name: string;
  publisher: string;
  year: number;
  edition?: string | null;
  url: string;
  fileUrl: string;
  checksum: string;
  pageCount?: number | null;
  wordCount?: number | null;
  licenseNote?: string | null;
}

/** Ensure the pgvector extension, embedding column and index exist. Idempotent. */
export async function ensureVectorSchema(): Promise<void> {
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS embedding vector(${EMBEDDING_DIMENSIONS})`
  );
  // Cosine distance, matching the normalised vectors bge produces.
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS chunk_embedding_cosine_idx
       ON "Chunk" USING hnsw (embedding vector_cosine_ops)`
  );
}

export async function upsertDocument(doc: DocumentRecord): Promise<string> {
  const data = {
    name: doc.name,
    publisher: doc.publisher,
    year: doc.year,
    edition: doc.edition ?? null,
    url: doc.url,
    fileUrl: doc.fileUrl,
    checksum: doc.checksum,
    retrievedAt: new Date(),
    pageCount: doc.pageCount ?? null,
    wordCount: doc.wordCount ?? null,
    licenseNote: doc.licenseNote ?? null,
  };
  const row = await prisma.document.upsert({
    where: { sourceKey: doc.sourceKey },
    create: { sourceKey: doc.sourceKey, ...data },
    update: data,
  });
  return row.id;
}

/**
 * Remove chunks produced by a different config version of this document.
 *
 * Without this, changing the chunk size would leave two incompatible chunkings
 * of the same text in the table and retrieval would mix them.
 */
export async function deleteStaleChunks(
  documentId: string,
  currentConfigHash: string
): Promise<number> {
  const result = await prisma.chunk.deleteMany({
    where: { documentId, configHash: { not: currentConfigHash } },
  });
  return result.count;
}

/**
 * Write chunks and their vectors.
 *
 * Done in explicit batches rather than one giant statement: a 232-chunk corpus
 * is small, but a single statement with thousands of bound parameters is where
 * this would fall over first as the corpus grows.
 */
export async function upsertChunks(
  documentId: string,
  configHash: string,
  chunks: ChunkRow[],
  embeddings: number[][],
  batchSize = 50
): Promise<number> {
  if (chunks.length !== embeddings.length) {
    throw new Error(`chunks (${chunks.length}) and embeddings (${embeddings.length}) differ in length`);
  }

  // Replace this config's chunks wholesale — simpler and safer than diffing,
  // and the whole document is re-embedded on every run anyway.
  await prisma.chunk.deleteMany({ where: { documentId, configHash } });

  for (let i = 0; i < chunks.length; i += batchSize) {
    const slice = chunks.slice(i, i + batchSize);
    const vecs = embeddings.slice(i, i + batchSize);

    const values = slice.map((c, j) =>
      Prisma.sql`(
        gen_random_uuid(), ${documentId}, ${c.ordinal}, ${c.section}, ${c.sectionConfidence},
        ${c.page}, ${c.text}, ${c.tokenCount}, ${c.kind}, ${configHash},
        NOW(), ${toVectorLiteral(vecs[j])}::vector
      )`
    );

    await prisma.$executeRaw`
      INSERT INTO "Chunk" (
        id, "documentId", ordinal, section, "sectionConfidence",
        page, text, "tokenCount", kind, "configHash",
        "createdAt", embedding
      ) VALUES ${Prisma.join(values)}
    `;
  }
  return chunks.length;
}

export interface RetrievedChunk {
  id: string;
  text: string;
  score: number;
  section: string;
  page: number;
  kind: string;
  sourceKey: string;
  documentName: string;
  publisher: string;
  year: number;
  url: string;
}

/**
 * Nearest chunks to a query vector.
 *
 * `sourceKey` restricts retrieval to one named document. The filter is applied
 * in the WHERE clause, never as a post-filter on an all-documents result:
 * post-filtering returns fewer than k rows — often zero — exactly when the
 * named document is not already in the global top-k, which is the case
 * single-document retrieval exists to serve.
 */
/**
 * Chunk kinds that are never retrievable.
 *
 * A bibliography and a contents page are built from the same vocabulary as the
 * chapters they point at, so they match those chapters' questions while being
 * unable to answer any of them. Excluded in the WHERE clause rather than
 * filtered afterwards, so they do not consume slots in the candidate pool.
 */
/**
 * Chunk kinds that can never answer a question, written once and interpolated
 * into both queries so the two cannot drift apart.
 */
export const NON_ANSWERING_KINDS = ["references", "toc"] as const;

const EXCLUDE_NON_ANSWERING = Prisma.sql`c.kind NOT IN (${Prisma.join(
  NON_ANSWERING_KINDS.map((k) => Prisma.sql`${k}`)
)})`;

/** Report the same searchable corpus and optional source filter as queryChunks. */
export async function listSearchableDocuments(sourceKey?: string) {
  const filter = sourceKey ? Prisma.sql`AND d."sourceKey" = ${sourceKey}` : Prisma.empty;
  return prisma.$queryRaw<{ sourceKey: string; name: string; publisher: string; year: number }[]>`
    SELECT d."sourceKey", d.name, d.publisher, d.year
    FROM "Document" d
    WHERE EXISTS (
      SELECT 1 FROM "Chunk" c WHERE c."documentId" = d.id
        AND c.embedding IS NOT NULL AND ${EXCLUDE_NON_ANSWERING}
    ) ${filter}
    ORDER BY d.name ASC`;
}

export async function queryChunks(
  queryEmbedding: number[],
  k: number,
  sourceKey?: string
): Promise<RetrievedChunk[]> {
  const vec = toVectorLiteral(queryEmbedding);

  const rows = sourceKey
    ? await prisma.$queryRaw<any[]>`
        SELECT c.id, c.text, c.section, c.page, c.kind,
               d."sourceKey", d.name AS "documentName", d.publisher, d.year, d.url,
               1 - (c.embedding <=> ${vec}::vector) AS score
        FROM "Chunk" c JOIN "Document" d ON d.id = c."documentId"
        WHERE d."sourceKey" = ${sourceKey} AND c.embedding IS NOT NULL
          AND ${EXCLUDE_NON_ANSWERING}
        ORDER BY c.embedding <=> ${vec}::vector
        LIMIT ${k}`
    : await prisma.$queryRaw<any[]>`
        SELECT c.id, c.text, c.section, c.page, c.kind,
               d."sourceKey", d.name AS "documentName", d.publisher, d.year, d.url,
               1 - (c.embedding <=> ${vec}::vector) AS score
        FROM "Chunk" c JOIN "Document" d ON d.id = c."documentId"
        WHERE c.embedding IS NOT NULL
          AND ${EXCLUDE_NON_ANSWERING}
        ORDER BY c.embedding <=> ${vec}::vector
        LIMIT ${k}`;

  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    score: Number(r.score),
    section: r.section,
    page: r.page,
    kind: r.kind,
    sourceKey: r.sourceKey,
    documentName: r.documentName,
    publisher: r.publisher,
    year: r.year,
    url: r.url,
  }));
}

export async function storeStats(): Promise<{ documents: number; chunks: number; embedded: number }> {
  const [documents, chunks] = await Promise.all([
    prisma.document.count(),
    prisma.chunk.count(),
  ]);
  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "Chunk" WHERE embedding IS NOT NULL`;
  return { documents, chunks, embedded: Number(count) };
}

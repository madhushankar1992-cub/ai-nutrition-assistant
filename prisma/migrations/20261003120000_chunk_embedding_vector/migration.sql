-- The vector column, as a real migration.
--
-- Why this file exists: `Chunk.embedding` is a pgvector column, and Prisma has
-- no vector type, so it cannot appear in schema.prisma. It was therefore created
-- only by raw SQL at ingestion time (ensureVectorSchema), which left it invisible
-- to Prisma — and `prisma db push` duly dropped the column as "not in the schema",
-- silently emptying the index and making every retrieval fail until the whole
-- corpus was re-ingested.
--
-- Keeping it in migration history does not teach Prisma the type, but it does
-- mean `prisma migrate deploy` recreates it on a fresh database, and that the
-- column is a declared part of the schema rather than a side effect of running
-- the ingest script.
--
-- IMPORTANT: use `prisma migrate deploy`, never `prisma db push`, on any
-- database holding this column. db push diffs against schema.prisma, cannot see
-- a type it does not model, and resolves the difference by dropping it.

CREATE EXTENSION IF NOT EXISTS vector;

-- 384 dimensions: bge-small-en-v1.5. Changing the model means changing this
-- number, which means a new migration and a full re-embed, not an ALTER.
ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS embedding vector(384);

-- Cosine distance, matching the normalised vectors bge produces.
CREATE INDEX IF NOT EXISTS chunk_embedding_cosine_idx
  ON "Chunk" USING hnsw (embedding vector_cosine_ops);

-- Retrieval excludes bibliographies and contents listings by kind, so the
-- filter sits in front of the vector scan on every query.
CREATE INDEX IF NOT EXISTS chunk_kind_idx ON "Chunk" (kind);

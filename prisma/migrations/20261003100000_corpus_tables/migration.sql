-- Corpus tables: Document, Chunk, CorpusSource, CorpusSnapshot, ScrapeRun,
-- plus Claim.chunkId.
--
-- These existed in schema.prisma and in every live database, but NO migration
-- ever created them -- they had been applied with `db push`/`migrate dev`
-- without the migration being committed. The chain was therefore unbuildable:
-- on a fresh database `prisma migrate deploy` applied the init migration and
-- then aborted on `ALTER TABLE "Chunk" ADD COLUMN embedding`, because no
-- migration had created "Chunk". Verified by running migrate diff against a
-- shadow database: it failed with P3006 on exactly that step.
--
-- The timestamp places this BEFORE 20261003120000_chunk_embedding_vector, so
-- the table exists before the vector column is added to it.

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "chunkId" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "ownerId" TEXT;

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "edition" TEXT,
    "url" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pageCount" INTEGER,
    "wordCount" INTEGER,
    "licenseNote" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "sectionConfidence" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "configHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorpusSource" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "edition" TEXT,
    "url" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "acquisition" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorpusSource_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CorpusSnapshot" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "runId" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verdict" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "contentType" TEXT,
    "finalUrl" TEXT,
    "byteLength" INTEGER,
    "checksum" TEXT,
    "etag" TEXT,
    "lastModified" TEXT,
    "pageCount" INTEGER,
    "wordCount" INTEGER,
    "wordsPerPage" INTEGER,
    "lowTextPages" TEXT,
    "artworkPages" TEXT,
    "tablePages" TEXT,
    "extractedTitle" TEXT,
    "extractedYears" TEXT,

    CONSTRAINT "CorpusSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "trigger" TEXT NOT NULL,
    "sourcesChecked" INTEGER NOT NULL DEFAULT 0,
    "changed" INTEGER NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,

    CONSTRAINT "ScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_sourceKey_key" ON "Document"("sourceKey");

-- CreateIndex
CREATE INDEX "Chunk_documentId_idx" ON "Chunk"("documentId");

-- CreateIndex
CREATE INDEX "Chunk_configHash_idx" ON "Chunk"("configHash");

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_documentId_configHash_ordinal_key" ON "Chunk"("documentId", "configHash", "ordinal");

-- CreateIndex
CREATE INDEX "CorpusSnapshot_sourceKey_checkedAt_idx" ON "CorpusSnapshot"("sourceKey", "checkedAt");

-- CreateIndex
CREATE INDEX "Conversation_ownerId_idx" ON "Conversation"("ownerId");

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorpusSnapshot" ADD CONSTRAINT "CorpusSnapshot_sourceKey_fkey" FOREIGN KEY ("sourceKey") REFERENCES "CorpusSource"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorpusSnapshot" ADD CONSTRAINT "CorpusSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ScrapeRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;


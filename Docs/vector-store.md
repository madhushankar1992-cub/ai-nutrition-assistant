# Vector Store — pgvector

> Companion document: **[`embedding-strategy.md`](./embedding-strategy.md)** — the model, its 384 dimensions, int8 precision, and the bge query/passage asymmetry that all of this depends on.

Where corpus vectors live, and how the backend reads them.

Implemented in `lib/corpus/vectorStore.ts`. Status: **`[BUILT]` — 226 chunks stored and queryable** (229 until 2026-10-04, when the WHO publication-page metadata and link-list chunks were stripped at extraction).

---

## 1. Why not Chroma Cloud

Chroma Cloud was the earlier plan and was **removed**. Three reasons, in order of weight:

1. **Availability is outside our control.** trychroma.com went down, and it took the whole ingest pipeline with it. A vector store that can independently fail is a second availability dependency for a corpus of a few hundred chunks.
2. **It added a third provider and a third credential** (`CHROMA_API_KEY`, `CHROMA_TENANT`, `CHROMA_DATABASE`) on top of Groq and Postgres.
3. **It separated the vectors from the provenance.** A citation is built from document name, publisher, year and URL. Keeping those in Postgres while vectors lived elsewhere meant two stores that could drift apart.

pgvector puts the index **beside the data a citation is built from**, in the database both deployments already share. No new service, no new secret.

---

## 2. What is stored

Two tables, plus one column Prisma cannot express.

```prisma
model Document {
  sourceKey   String  @unique   // registry key
  name        String            // ─┐
  publisher   String            //  │ these four ARE the citation
  year        Int               //  │
  url         String            // ─┘
  fileUrl     String
  checksum    String            // sha256 — detects a silently changed document
  retrievedAt DateTime
}

model Chunk {
  documentId        String
  ordinal           Int
  section           String      // required — a chunk that cannot say where it
  sectionConfidence String      //   came from cannot support a citation
  page              Int
  text              String
  tokenCount        Int
  kind              String      // prose | table | references | toc (the last two are never retrieved)
  restricted        Boolean     // calorie / per-kg-bodyweight content
  configHash        String      // which RetrievalConfig produced this chunk
  @@unique([documentId, configHash, ordinal])
}
```

The vector itself is added by raw SQL, because Prisma has no vector type:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "Chunk" ADD COLUMN IF NOT EXISTS embedding vector(384);
CREATE INDEX chunk_embedding_cosine_idx ON "Chunk" USING hnsw (embedding vector_cosine_ops);
```

`384` is `bge-small-en-v1.5`. Changing the model means a new column and a full re-embed — which `configHash` makes detectable with a query rather than by memory.

`ensureVectorSchema()` runs this at the start of every ingest and is idempotent, so a fresh database needs no manual setup.

---

## 3. How the scheduler's data reaches the backend

This is the part worth being precise about, because GitHub Actions artifacts are a red herring.

```
  GitHub Actions runner (03:45 UTC daily)
        │
        │  scrape → chunk → embed locally
        │
        ├──────────► Railway Postgres + pgvector        ← the DATA path
        │            (DATABASE_URL repository secret)
        │
        └──────────► GitHub artifact: corpus-watch-report.md   ← a human log
```

| Output | Destination | Can the backend read it? |
|---|---|---|
| Chunks, vectors, provenance | **Railway Postgres** | **Yes** — the same database the app already queries |
| Watch report markdown | GitHub Actions artifact | **No** — artifacts are only downloadable from the Actions UI/API |

So the backend never reads an artifact. The runner writes vectors directly into the shared database, and the API route reads them from there. The artifact exists purely so a human can see what the run did.

**Requirement:** the Postgres must be reachable from the GitHub runner. Railway's public proxy endpoint satisfies this; a VPC-only database would not.

---

## 4. Querying

```ts
const hits = await queryChunks(await embedQuery(question), 5);              // all documents
const hits = await queryChunks(vec, 5, "who-sodium-guideline");             // one document
```

```sql
SELECT c.*, d.name, d.publisher, d.year, d.url,
       1 - (c.embedding <=> $1::vector) AS score
FROM "Chunk" c JOIN "Document" d ON d.id = c."documentId"
WHERE d."sourceKey" = $2 AND c.embedding IS NOT NULL
ORDER BY c.embedding <=> $1::vector
LIMIT $3;
```

Three properties that matter:

- **The query vector is a bound parameter, never interpolated.** It derives from user text, and interpolating it would reintroduce injection at the one layer the ORM does not cover.
- **The document filter is in `WHERE`, not applied afterwards.** Post-filtering an all-documents result returns fewer than `k` rows — often zero — exactly when the named document is not already in the global top-`k`, which is the case single-document retrieval exists to serve.
- **Vectors are normalised** (bge with `normalize: true`), so cosine distance converts to similarity as `1 - distance`.

---

## 5. Keeping repeated runs safe

The scheduler runs daily, so ingestion must be idempotent rather than additive.

- **Chunks are keyed** `(documentId, configHash, ordinal)`.
- **Before writing**, `deleteStaleChunks` removes rows for that document whose `configHash` differs from the current one. Without it, changing chunk size would leave two incompatible chunkings of the same text in the table and retrieval would mix them.
- **Then** the current config's chunks for that document are deleted and rewritten wholesale — simpler and safer than diffing, and the document is fully re-embedded on every run anyway.

---

## 6. Measured state

From the real run on 2026-10-02:

```
229 chunks total · 12 table · 9 restricted
Postgres/pgvector: 7 documents · 229 chunks · 232 embedded
completed in 146.2s
```

Verified retrieval, all-documents mode:

| Query | Top hit |
|---|---|
| "How much salt should adults eat per day?" | 0.804 — USDA/HHS 2026, *"the general population, ages 14 and above, should consume…"* |
| "How long can I keep cooked leftovers in the fridge?" | 0.817 — Food Standards Agency 2017 |

Single-document filtering returns only chunks from the named document, as intended.

> **An open quality issue, recorded rather than hidden.** For the leftovers query the top hit is an FSA passage about *changing the fridge power setting*, not the 48-hour rule — the correct chunk exists but ranks lower. This is a **retrieval** failure, not a generation one, and it is exactly what the 15-question bank is built to quantify (`recall@k`). Fix candidates: raise `k`, lower the chunk target so one chunk carries one rule, or add a re-ranking pass. Do not tune this by eye — measure it first.

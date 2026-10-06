# Embedding Strategy

How text becomes a vector in this system, why each choice was made, and what it costs.
Companion to `Docs/chunking-strategy.md` (which decides *what* gets embedded) and
`Docs/vector-store.md` (which decides *where* the vectors live).

Every number here is measured against the live corpus, not estimated.

---

## 1. The model

| Property | Value |
|---|---|
| Model | `Xenova/bge-small-en-v1.5` (BAAI bge-small, ONNX build) |
| Dimensions | **384** |
| Weight precision | **int8 (`q8`)**, ~33 MB |
| Pooling | **CLS**, normalised |
| Runtime | `@huggingface/transformers`, in-process, no network call |
| Code | `lib/corpus/embeddings.ts` |

**Why a local model rather than a hosted embeddings API.** Groq serves generation only and has
no embeddings endpoint, so a hosted embedder would be a *new* provider, a *new* credential and a
*new* thing that can rate-limit or go down in the middle of a request. A local model makes
embedding a build dependency instead. The corpus is 226 chunks; the whole thing embeds in about
two minutes on CPU, so there is nothing to buy with a network round trip.

**Why bge-small and not something larger.** 384 dimensions against 226 chunks is already far
more capacity than the corpus needs — measured `recall@5` is 17/17. A larger model would cost
load time and memory to improve a number that is already at ceiling.

---

## 2. Asymmetry: the single easiest thing to get wrong

bge is an **asymmetric** model. A short question and a long passage are not embedded the same way:

```
query    ->  "Represent this sentence for searching relevant passages: " + question
passage  ->  the passage text, with no prefix
```

The prefix is applied in exactly one place, `embedQuery` (`lib/corpus/embeddings.ts`), so it
cannot be applied twice or forgotten. `embedPassages` never applies it.

Getting this backwards does not raise an error. It silently degrades every ranking in the system,
which is why it is called out here rather than left to the code.

---

## 3. What text actually gets embedded

Not the raw chunk. Each chunk is embedded with a provenance prefix (`embeddingText` in
`lib/corpus/chunker.ts`):

```
[Food Standards Agency · 2017 · Chilling food correctly]
Eat leftovers within 48 hours or freeze them...
```

The publisher, year and section ride along in the vector. A question that names a source
("what does WHO say about salt") therefore has something to match on beyond the body text, and
near-identical passages from different publishers stay separable — which matters here, because
the corpus deliberately contains documents that disagree with each other.

---

## 4. Precision: why int8, and what it is allowed to cost

The fp32 weights are ~127 MB; the int8 weights are ~33 MB. The smaller model was adopted while
testing whether retrieval could run inside a Vercel serverless function.

**It did not make serverless retrieval work** — Vercel still returned 503 on every retrieval, so
the API stays on the container (see `Docs/deployment-plan-v2.md`). The quantisation was kept
anyway, because it was measured to cost nothing:

| | fp32 | int8 (`q8`) |
|---|---|---|
| Weights | ~127 MB | **~33 MB** |
| `recall@5` | 17/17 | **17/17** |
| `document_recall@5` | 17/17 | **17/17** |
| False refusals | 0/17 | **0/17** |
| Adversarial | 8/8 | **8/8** |

**int8 and fp32 vectors of the same text are not the same vector.** Queries and passages must
therefore be embedded at the same precision, or the two sides are being measured with different
rulers. That is enforced structurally rather than by memory: `embeddingDtype` is part of
`RETRIEVAL_CONFIG`, so changing it changes `configHash`, and every chunk carrying an older hash
is detectably stale (`deleteStaleChunks`). Changing the precision means re-embedding the corpus,
not editing a constant.

---

## 5. Batching and failure behaviour

- `EMBED_BATCH_SIZE = 32`. Large enough to keep the ONNX session busy, small enough that progress
  is reported during a run rather than after it.
- **Dimension is checked on every batch.** A vector that is not 384 wide throws immediately
  rather than being written, because a wrong-width vector is not a bad result — it is a different
  model, and the index would be silently incoherent.
- **A failed model load is never cached.** The pipeline promise is cached on `globalThis` for
  reuse, but a *rejected* promise is evicted. Without that, one transient fault while loading the
  weights left a rejected promise in place and every later query re-awaited the same rejection —
  a permanent 503 until someone restarted the container by hand.
- **Embedding failure is a hard failure.** There is deliberately no fallback from "cannot embed"
  to "answer from model knowledge"; that path returns exactly the ungrounded answers this system
  exists to prevent. The route returns 503 and says so. (The labelled general-knowledge tier added
  on 2026-10-06 is not that fallback: it is reached only when retrieval *succeeds* and the
  sufficiency gate finds nothing strong enough, and it returns no citations.)

---

## 6. Where embedding sits in the pipeline

```
scrape -> extract -> classify -> chunk -> EMBED -> upsert into pgvector
                                            |
query ------------------------------------- EMBED (with query prefix)
                                            |
                              cosine search over the HNSW index
                                            |
                           over-fetch k x 4, re-rank, sufficiency gate
```

Embedding happens twice with the same model and the same precision, once per side. Everything
downstream — ranking, the sufficiency floors, citation binding — assumes those two sides are
comparable. The gate's verdict picks the answer tier: a passing gate produces a **grounded**
answer with server-bound citations; a failing one (in all-documents mode) produces a
**general-knowledge** answer, labelled as such in the UI and carrying no claims.

---

## 7. Storage

384-dimensional `vector(384)` column on `Chunk`, HNSW index with `vector_cosine_ops`. Vectors are
normalised at generation, so cosine distance and dot product agree. Details in
`Docs/vector-store.md`.

Prisma cannot model a vector type, so the column is created by migration
(`20261003100000_corpus_tables` creates the table, `20261003120000_chunk_embedding_vector` adds
the column and index) and queried through `$queryRaw` with the query vector always **bound**,
never interpolated.

---

## 8. Measured state

```
7 documents · 226 chunks · 226 embedded · 384 dimensions · int8 · configHash b63742d51a
recall@5 17/17 · document_recall@5 17/17 · 0 false refusals · adversarial 8/8
```

As of 2026-10-06. The corpus was 229 chunks until 2026-10-04, when WHO publication-page chrome was
stripped at extraction; retrieval metrics are from `Docs/retrieval-report.md` (generated 2026-10-04).

---

## 9. What would change this

| Trigger | Required response |
|---|---|
| Model changed | New `configHash`, full re-embed, `EMBEDDING_DIMENSIONS` updated, vector column width changed by migration |
| Precision changed | Full re-embed. Mixing precisions is silently wrong, never an error |
| A non-English source added | bge-small-en is English-only; a multilingual model is needed, which is a model change |
| Corpus grows past ~10k chunks | Revisit HNSW build parameters; the defaults are chosen for a corpus of this size |

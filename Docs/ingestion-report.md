# Ingestion Report

> Status as of 2026-10-06: this report records the 3–4 Oct 2026 runs and is not regenerated. The live corpus is now 7 documents / 226 chunks / 226 embedded, config `b63742d51a` — WHO publication-page chrome was stripped at extraction on 2026-10-04 (WHO sodium 4 → 2 chunks, Five keys 2 → 1). The 6 Oct scheduled run failed on a transient who.int glitch; a manual re-run succeeded and issue #1 is closed.

What the corpus pipeline fetched, parsed, chunked, embedded and stored, and the
evidence for each step.

Every figure below comes from one of three sources: the ingest log of the latest
local run (`logs/ingest-2026-10-03T16-58-36-590Z.log`), the GitHub Actions log of
the scheduled run on 4 October 2026, or read-only queries of the live
Postgres/pgvector database that both deployments share. Nothing is estimated.

---

## 1. Summary

| | |
|---|---|
| Sources registered | **7** (all enabled, all ingested) |
| Documents stored | **7** |
| Chunks stored | **229** |
| Chunks with an embedding | **229** (100%) |
| Embedding model | `Xenova/bge-small-en-v1.5`, 384 dimensions, int8 |
| Retrieval config hash | `b63742d51a` on every chunk |
| Warnings / errors | **0 / 0** |
| Last scheduled run | 4 Oct 2026, 05:34 UTC, **success** in 2m10s, ingest step 54.9s |

The live database is the output of the **scheduled** run: every document's
`retrievedAt` is 4 Oct 2026, 05:36 UTC. The daily job is maintaining the corpus
without manual help.

---

## 2. Pipeline

Each source goes through the same seven steps, in this order. Each step is a tag
in the run log.

| Step | Log tag | What it does |
|---|---|---|
| Scrape | `SCRAPE` | Downloads the public URL with a browser User-Agent. Records bytes and a sha256 checksum. Uses conditional requests, so an unchanged document returns 304 instead of downloading again |
| Extract | `EXTRACT` | Parses a PDF page by page (`unpdf`), or HTML from its content container with site navigation stripped |
| Classify | `CLASSIFY` | Marks each page as prose, table, artwork or low-text. Artwork and low-text pages are dropped |
| Verify | `VERIFY` | Edition guard: the extracted title and year must match the registry. A mismatch aborts that document |
| Chunk | `CHUNK` | Heading-aware chunking, 500-token target (220 for HTML). Tables are kept whole. Bibliographies and contents pages are kept but never retrieved |
| Embed | `EMBED` | One 384-dimensional vector per chunk, with a `[publisher · year · section]` header |
| Store | `STORE` | Upserts the document and its chunks into pgvector, then removes chunks from older configs |

---

## 3. Per source

| Source | Publisher, year | Type | Bytes | sha256 | Pages | Words | Pages dropped | Chunks |
|---|---|---|---|---|---|---|---|---|
| Dietary Reference Values: Summary report | EFSA, 2017 | PDF | 2,837,722 | `0231c27d944b` | 92 | 47,750 | 6 (artwork) | **150** |
| Healthy diet (fact sheet) | WHO, 2026 | HTML | 132,717 | `4bb0a876ec0f` | 1 | 3,010 | 0 | **32** |
| The Eatwell Guide (booklet) | Public Health England, 2018 | PDF | 7,889,766 | `1d927fbe10b4` | 12 | 5,936 | 2 (artwork) | **15** |
| Dietary Guidelines for Americans, 2025–2030 | USDA and HHS, 2026 | PDF | 3,422,452 | `c34f1bec5c94` | 10 | 2,699 | 1 (low text) | **14** |
| How to chill, freeze and defrost food safely | Food Standards Agency, 2017 | HTML | 83,680 | `0bd1b573da4b` | 1 | 1,260 | 0 | **12** |
| Guideline: sodium intake for adults and children | WHO, 2012 | HTML | 91,333 | `d3a27972d3a9` | 1 | 264 | 0 | **4** |
| Five keys to safer food manual | WHO, 2006 | HTML | 89,607 | `d82c50c7ac2e` | 1 | 111 | 0 | **2** |
| **Total** | | | | | **118** | **61,030** | **9** | **229** |

**Edition guard.** All 7 sources passed the title and year check. No document was
aborted.

**Pages dropped**, from the classify step:
- EFSA pages 78, 79, 84, 86, 88 and 90 are artwork: few sentences and few numbers.
- EFSA pages 22, 23, 24, 71, 73, 80, 83, 85, 87, 89, 91 and 92 were detected as **tables** and kept whole as 12 table chunks.
- Eatwell pages 1 and 11 are artwork; page 1 is the plate diagram.
- DGA page 1 is low-text: the cover.

---

## 4. Chunks in the database

From the live database, read-only.

| Source | Chunks | Embedded | Prose | Table | Not retrievable | Min tokens | Avg | Max |
|---|---|---|---|---|---|---|---|---|
| EFSA DRV summary | 150 | 150 | 127 | 12 | 11 | 121 | 439 | 643 |
| WHO healthy diet | 32 | 32 | 32 | 0 | 0 | 146 | 210 | 329 |
| PHE Eatwell Guide | 15 | 15 | 15 | 0 | 0 | 135 | 414 | 625 |
| DGA 2025–2030 | 14 | 14 | 14 | 0 | 0 | 145 | 300 | 819 |
| FSA chill/freeze/defrost | 12 | 12 | 12 | 0 | 0 | 129 | 189 | 321 |
| WHO sodium guideline | 4 | 4 | 3 | 0 | 1 | 57 | 138 | 191 |
| WHO five keys | 2 | 2 | 2 | 0 | 0 | 31 | 91 | 151 |
| **Total** | **229** | **229** | **205** | **12** | **12** | | | |

**Not retrievable** means bibliographies (`references`) and contents pages (`toc`).
They are stored for completeness but excluded in the retrieval query, because they
share the vocabulary of the chapters they index and cannot answer any question.
EFSA has 11 (6 reference lists, 5 contents pages); the WHO sodium page has 1 (its
publication metadata block).

**Short chunks.** Three chunks are under the 120-token minimum: two on the WHO
sodium page and one on Five keys. Both are publication landing pages whose whole
body is shorter than one normal chunk. This is the source's size, not a chunking
fault.

---

## 5. Scheduled runs

The scheduler is `.github/workflows/corpus-ingest.yml`, cron `45 3 * * *` (03:45
UTC, 09:15 IST). GitHub can start scheduled jobs later than the cron time when it
is busy.

| Run | Trigger | Started (UTC) | Result | Notes |
|---|---|---|---|---|
| 37180279596 | schedule | 2026-10-04 05:34 | **success**, 2m10s | 7 sources, 229 chunks, 0 warnings, 0 errors |
| 37131569880 | manual | 2026-10-03 14:58 | **success**, 2m16s | First successful run after the fix below |
| 37095251279 | schedule | 2026-10-03 04:03 | failure, 46s | `node: .env: not found` — fixed |

**Why the first scheduled run failed.** The ingest script required a `.env` file,
which is gitignored and so never exists on a CI runner. The `DATABASE_URL`
repository secret was also unset. Both were fixed on 3 October; every run since has
succeeded.

---

## 6. Sources removed

| Source | Why |
|---|---|
| FoodSafety.gov, Cold Food Storage Charts | HTTP 403 to every automated client. Produced 0 chunks and the only warnings in each run. Removed on 3 October; retested on 4 October, still 403 |
| USDA FSIS, Safe Minimum Internal Temperature Chart | HTTP 403 to every automated client. Produced 0 chunks. Removed on 3 October |

---

## 7. How to reproduce

```bash
npm run ingest          # full pipeline; writes logs/ingest-<timestamp>.log
npm run corpus:watch    # checks each source for changes without re-ingesting
npm run vectors         # inspects stored chunks and their embeddings
```

Related documents: `Docs/chunking-strategy.md`, `Docs/embedding-strategy.md`,
`Docs/vector-store.md`, `Docs/scheduler-and-scraping.md`.

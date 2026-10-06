# Scheduler and Scraping Service

The daily pipeline that keeps the corpus current: **scrape → verify → chunk → embed → store in Postgres/pgvector**.

Implemented in `lib/corpus/` and `scripts/`, scheduled by `.github/workflows/corpus-ingest.yml`. Status: **`[BUILT]` and verified against the live sources.**

---

## 1. The schedule

```yaml
on:
  schedule:
    - cron: "45 3 * * *"
```

**03:45 UTC = 09:15 IST.** GitHub Actions cron is always UTC and has no timezone option, so the conversion lives in the workflow file. If you change timezone, change the cron — not the code.

| Target local time | Cron |
|---|---|
| 09:15 IST (UTC+05:30) — **current** | `45 3 * * *` |
| 09:15 London (winter) | `15 9 * * *` |
| 09:15 New York (EDT) | `15 13 * * *` |

GitHub delays scheduled runs when the platform is busy, so treat this as "shortly after 9:15", not exact. Nothing in the pipeline is minute-sensitive.

`workflow_dispatch` is also enabled, with two inputs: `dry_run` (everything except the upload) and `source` (one document key).

### Current state (as of 2026-10-06)

Running daily at 09:15 IST (03:45 UTC). The 6 Oct 09:15 IST scheduled run failed on a transient
who.int glitch; a manual re-run succeeded the same day and issue #1 ("Corpus ingest needs review"),
which the failed scheduled run opened, is closed. The 4 and 5 Oct scheduled runs and both 6 Oct
manual runs succeeded. The corpus is 7 documents · 226 chunks · 226 embedded, retrieval config
`b63742d51a`.

| Run | Trigger | Started (UTC) | Result |
|---|---|---|---|
| 37497583232 | manual | 2026-10-06 16:40 | success, 1m39s |
| 37497164192 | manual | 2026-10-06 16:37 | success, 2m4s |
| 37411401740 | schedule | 2026-10-06 03:57 | failure, 1m52s — transient who.int glitch |
| 37261724310 | schedule | 2026-10-05 04:01 | success, 2m26s |
| 37180279596 | schedule | 2026-10-04 05:34 | success, 2m10s |

---

## 2. Pipeline order

The order is the requirement, and the workflow enforces it:

```
  ┌─────────────────────────────────────────────────────────┐
  │ 03:45 UTC daily (09:15 IST)                             │
  └────────────────────────┬────────────────────────────────┘
                           ▼
  [1] SCRAPE      fetch every source URL           lib/corpus/fetcher.ts
                  conditional GET (ETag / If-Modified-Since)
                           ▼
  [2] VERIFY      read title + year from INSIDE the file
                  assert against the registry      ← edition guard
                  mismatch ⇒ ABORT that document
                           ▼
  [3] CLASSIFY    per page: prose | table | artwork | low_text
                  drop artwork and covers          lib/corpus/extract.ts
                           ▼
  [4] CHUNK       heading-aware, 500/900/80 tokens lib/corpus/chunker.ts
                  tables kept whole
                           ▼
  [5] EMBED       bge-small-en-v1.5, 384d, local   lib/corpus/embeddings.ts
                           ▼
  [6] STORE       upsert to Postgres + pgvector    lib/corpus/vectorStore.ts
                  delete stale configHash rows first
```

---

## 3. The scraping service

`lib/corpus/fetcher.ts`. Deliberately conservative — these are government servers being hit on a schedule.

- **One request at a time**, with a 2 s delay between sources.
- **A real browser User-Agent.** Several publishers reject Node's default outright.
- **Conditional GET.** Stored `ETag` / `Last-Modified` are replayed, so an unchanged 7 MB PDF costs a 304 instead of a download.
- **60 s timeout**, 3 attempts, 40 MB ceiling.

### Five outcomes, because they need different responses

| Outcome | Meaning | What to do |
|---|---|---|
| `ok` | Bytes retrieved | Continue |
| `unchanged` | HTTP 304 | Nothing — this is the common case |
| `blocked` | 401/403/429, or a bot-check page served as 200 | The document is fine; the server refuses robots. **Download by hand** |
| `unreachable` | DNS failure, timeout, reset | May be transient. **Retried** with backoff |
| `error` | 404, 5xx, oversized | Investigate |

**A 403 is not retried** — it is a policy decision, and retrying adds load while still failing. **A timeout is retried**, because at least one publisher (the Australian guidelines) failed that way intermittently during corpus research.

The fetcher also detects a **challenge page served with HTTP 200** — a captcha or "checking your browser" interstitial. Without that check, the pipeline would happily chunk and embed a bot-check page.

---

## 4. The edition guard — why this exists

This is the most important safety property in the pipeline.

Corpus research found **two of eleven candidate documents returning HTTP 200 while being the wrong edition**:

- The widely-cited *Dietary Guidelines for Americans 2020–2025* has been superseded by the **2025–2030** edition (Jan 2026).
- The only downloadable ICMR-NIN PDF is the **2011** manual, not the 2024 revision.

Citing either would be a **fabricated citation behind a working link** — the hardest kind to notice, because the link opens perfectly.

So every source declares what it expects, and ingestion asserts it against text read from *inside* the file:

```ts
expectTitleContains: "Dietary Guidelines for Americans, 2025",
expectYearIn: [2025, 2026],
```

**A mismatch aborts that document.** It is not ingested, the run exits non-zero, and a GitHub issue is opened. Silently ingesting a new edition is worse than a stale corpus, because it is invisible.

---

## 5. Detect, don't auto-update

The watcher (`npm run corpus:watch`) **reports** changes; it never rewrites the corpus on its own.

A changed document is **quarantined**. The run fails, the report names exactly what changed (checksum, word-count delta, extracted title and year), and a human decides whether to re-ingest.

The reason: a citation is only trustworthy while the chunk it points at still says what the claim says. Auto-re-ingesting a revised document leaves every already-published citation with a working link and no supporting text.

Verdicts:

| Verdict | Meaning |
|---|---|
| `unchanged` | Checksum matches, or 304 |
| `first_seen` | Baseline recorded |
| `changed` | Content differs — **quarantined for review** |
| `edition_mismatch` | No longer the registered document — **hard failure** |
| `quality_drop` | Extractable text collapsed >50% (usually an image-only PDF) |
| `needs_manual_refresh` | Publisher blocks robots |
| `unreachable` / `error` | Network or server failure |

---

## 6. Running it

```bash
npm run corpus:watch              # check every source, write a report
npm run corpus:watch -- --dry-run # fetch and report, no database writes

npm run ingest                    # full pipeline, stores to Postgres/pgvector
npm run ingest -- --dry-run       # everything except the database write
npm run ingest -- --source=KEY    # one document
```

Exit codes: `0` nothing needs attention · `1` a source needs review · `2` the run itself failed.

---

## 7. Required secrets

Set these as **GitHub repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Used for |
|---|---|
| `DATABASE_URL` | Corpus vectors, documents, and watcher history. **The only secret required.** |


No embedding credential is needed — bge-small runs locally. No vector-store credential is needed either — vectors go to the same Postgres. See [vector-store.md](vector-store.md).

The workflow caches the bge ONNX weights (int8, ~33 MB; the fp32 build was ~127 MB) with `actions/cache`, so only the first run downloads them.

---

## 8. Measured results

From a real run on 2026-10-02 (`npm run ingest -- --dry-run`):

| Document | Pages | Words | Chunks |
|---|---|---|---|
| EFSA — Dietary Reference Values | 92 | 47,750 | **150** |
| The Eatwell Guide | 12 | 5,936 | 15 |
| WHO — Sodium guideline | 1 | 682 | 14 |
| DGA 2025–2030 | 10 | 2,699 | 14 |
| WHO — Healthy diet fact sheet | 1 | 810 | 13 |
| WHO — Five keys to safer food | 1 | 527 | 13 |
| FSA — chill/freeze/defrost | 1 | 1,740 | 13 |
| FoodSafety.gov cold storage | — | — | skipped (403) |
| USDA FSIS temperatures | — | — | skipped (403) |

**232 chunks total · 12 table chunks · 9 restricted chunks.**

> **Since then (as of 2026-10-06):** the two US food-safety charts that 403'd were removed from the registry on 2026-10-03 — they never produced a chunk and were the only warnings in every run — so the registry is exactly **7 sources, all of which ingest**. HTML chrome stripping and later the WHO publication-page cleanup (2026-10-04) changed the per-document counts; the corpus went 232 → 229 → **226 chunks**. Current per-document figures are in `Docs/chunking-strategy.md` §5.

### Three bugs this run caught

Running the pipeline against real documents found defects that reasoning about it did not:

1. **Running page headers became sections.** `"Dietary Guidelines for Americans, 2025–2030 | 4"` appears on every page and passed every heading test, shattering the document into 27 fragments averaging 148 tokens against a 500 target. Fixed by detecting boilerplate through cross-page line repetition.
2. **Wrapped sentences became sections.** `"Instead, prioritize nutrient-dense foods and"` was promoted to a heading. Fixed with a continuation-word test and a Title-Case ratio.
3. **No minimum chunk size was enforced.** Fixed by refusing to close a section while the buffer is under 120 tokens.

Result: DGA went 27 → **14 chunks**, average 300 tokens, and **zero chunks below the floor** across every document.

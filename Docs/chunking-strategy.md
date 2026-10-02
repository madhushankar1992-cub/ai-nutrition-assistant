# Chunking Strategy

The concrete strategy, its parameters, the analysis that validated it, and where it is applied across the implementation phases.

Implemented in `lib/corpus/chunker.ts`. Status: **`[BUILT]`** — figures below are measured from the live store, not estimates.

---

## 1. The tension that sets every parameter

A chunk is both the unit of **retrieval** and the unit of **citation**. Those pull in opposite directions:

| | Wants | Because |
|---|---|---|
| **Retrieval** | Smaller chunks | One embedding should mean one idea. A long chunk averages several ideas into a vector that matches everything weakly and nothing strongly |
| **Citation** | Larger chunks | A claim must be checkable against the passage cited. A number separated from the thing it applies to is a citation that opens cleanly and proves nothing |

Too small: *"3–4 days"* with no indication of what food or what temperature. Too large: retrieval stops discriminating.

**500 tokens** is the smallest independently checkable unit in this corpus — one complete recommendation *with its qualifiers*.

---

## 2. Parameters

| Parameter | Value | Why |
|---|---|---|
| `CHUNK_TARGET_TOKENS` | **500** | One complete recommendation. Also budget-driven: `k`=5 × 500 = 2,500 tokens of context |
| `CHUNK_HARD_CAP_TOKENS` | **900** | Tables keep integrity up to here before being flagged oversized |
| `CHUNK_OVERLAP_TOKENS` | **80** (~16%) | Carries a sentence straddling a paragraph break without inflating the index |
| `MIN_CHUNK_TOKENS` | **120** | Below this a chunk retrieves on noise and cannot carry a checkable claim |

All four live in `lib/retrievalConfig.ts` and are hashed into `configHash`, stored on every chunk. Changing one makes every existing chunk detectably stale.

---

## 3. The algorithm

```
for each page kept by classification:
    if page is a TABLE:
        emit ONE chunk for the whole table      # never split, even over cap
        continue

    for each line:
        if line is boilerplate (repeats on >50% of pages):  skip
        if line is a HEADING:
            if buffer is empty:                 adopt as current section
            else if buffer >= MIN_CHUNK_TOKENS: flush, adopt as section
            else:                               treat as body text
        else: append to buffer

on flush:
    if buffer <= HARD_CAP:  emit one chunk
    else:                   split on paragraph boundaries at ~TARGET,
                            overlap by OVERLAP, never across a heading
    merge any runt piece forward into its predecessor
```

### The four rules, each with the failure it prevents

1. **Split on headings first** — keeps *"eat leftovers within"* attached to *"48 hours"*.
2. **Never split a detected table** — half a table cites a number whose column header is in another chunk.
3. **Overlap only within a section** — overlapping across a heading would make the same text belong to two sections, destroying the provenance the citation depends on.
4. **Carry the heading onto every piece** — a reader clicking a citation lands in the right place.

---

## 4. Page classification runs first

Chunking only sees pages worth chunking.

```
                     words >= 40 ?
                 no /            \ yes
          [low_text]          sentence marks per 100 words >= 1.2 ?
          cover, scan      no /                          \ yes
                            /                             [prose]
              digit ratio >= 0.12  OR  matches /Table \d+[:.]/ ?
            no /                                      \ yes
       [artwork]                                    [table]
       DROP the page                           keep whole, never split
```

Each threshold exists because a simpler rule failed on real documents:

| Signal | Added because |
|---|---|
| Word count | Catches covers and blank pages |
| Prose density | Word count alone passes the Eatwell plate — ~300 words of food names with no sentences |
| Digit ratio | Prose density alone flagged **18 EFSA pages as artwork**; they were the nutrient tables |
| Table caption | Digit ratio alone misread *"Table 14: … DRVs for children (1–17 years)"*, a text-heavy table. Dropping it would have silently removed children's reference values |

---

## 5. Measured results

From the live store (213 chunks, 7 documents):

```
min=22  p25=247  median=462  p75=484  max=819  mean=388
under floor (<120): 3 (1.4%)      over cap (>900): 0 (0.0%)
prose=201  table=12  restricted=9
```

| Document | Chunks | Mean | Min | Max | Under 120 |
|---|---|---|---|---|---|
| EFSA — Dietary Reference Values | 150 | 439 | 121 | 643 | 0 |
| The Eatwell Guide | 15 | 414 | 135 | 625 | 0 |
| DGA 2025–2030 | 14 | 300 | 145 | 819 | 0 |
| FSA — chill/freeze/defrost | 11 | 255 | 76 | 757 | 1 |
| WHO — Sodium guideline | 9 | 136 | 22 | 302 | 1 |
| WHO — Healthy diet | 7 | 195 | 116 | 603 | 1 |
| WHO — Five keys | 7 | 132 | 120 | 152 | 0 |

**Section confidence** (how much to trust a citation's section label): `numbered` 46.6% · `typographic` 51.3% · `inherited` 2.2%.

---

## 6. Four bugs the analysis caught

None of these were visible from reasoning about the design. All were found by running the chunker over real documents and measuring the output.

| # | Symptom | Cause | Fix | Result |
|---|---|---|---|---|
| 1 | 27 chunks from 2,699 words (~133 tokens each) | Running page headers — `"Dietary Guidelines… \| 4"` — passed every heading test and shattered the document | Detect boilerplate by cross-page line repetition (>50% of pages) | DGA 27 → **14** chunks |
| 2 | Sentence fragments became sections | `"Instead, prioritize nutrient-dense foods and"` matched the typographic test | Reject lines ending in a continuation word; require Title-Case ratio ≥ 0.6 | Spurious sections largely gone |
| 3 | No minimum chunk size enforced | Nothing stopped a heading closing a 2-line section | Refuse to flush while the buffer is under `MIN_CHUNK_TOKENS` | — |
| 4 | **44 chunks (19%) still under the floor**, all in HTML sources | The guard measured the **raw** buffer; the emitted chunk is whitespace-**normalised**, so indentation inflated the estimate — a "130 token" buffer became a 40-token chunk | Measure the buffer after normalisation, and merge runt pieces forward | **19% → 1.4%**, mean 355 → 388 |

Bug 4 is the instructive one: the guard and the thing it guarded were measuring different strings. It would never have shown up without distribution analysis over real output.

---

## 7. What the strategy costs

Every strategy loses something; naming the loss is part of the deliverable.

- **Heading detection is heuristic and wrong somewhere.** 6 of 92 unique sections are misdetected — `"Brooke L. Rollins"` (a signature), `"Raisins"`, `"BodyMassIndex.aspx"`. The failure mode is *imprecise, not incorrect*: the document and page are still right, because those come from `documentId`, not heading detection.
- **Oversized table chunks skew retrieval.** A whole table is long and number-dense, so it matches many numeric queries weakly rather than one strongly. Accepted: the alternative is citations that cannot be checked.
- **Uneven chunk sizes mean uneven scores.** Cosine similarity is not length-invariant in practice; a 121-token chunk and an 819-token table are not competing on equal footing.
- **Overlap duplicates content**, so two near-identical chunks can both occupy the top-`k`. Mitigate with near-duplicate suppression after retrieval.
- **HTML sources chunk worse than PDFs.** They have no page structure, so section detection leans on the weakest heuristic. The three remaining under-floor chunks are all HTML tails.

---

## 8. Where this applies across the implementation phases

| Phase | What chunking contributes |
|---|---|
| **12 — Corpus** | Page-count and word-count per source determine the expected chunk yield. EFSA (47,750 words) yields 150; the DGA (2,699) yields 14 |
| **13 — Migration** | `Chunk` carries `section`, `sectionConfidence`, `page`, `kind`, `tokenCount`, `restricted`, `configHash`. `section` is non-null because a chunk that cannot say where it came from cannot support a citation |
| **14 — Ingestion** | Steps 5–7: classify pages, chunk, policy-scan. The `expectYearIn` guard runs *before* chunking so a wrong edition is never chunked at all |
| **15 — Retrieval** | Chunk size sets what one vector represents. `k` × chunk size is the token budget (§9) |
| **16 — Sufficiency** | Thresholds are calibrated against this chunk distribution. Re-chunking invalidates them |
| **17 — Schema/prompt** | `chunkId` is the model's only citation power; the prompt instructs one claim per chunk |
| **18 — Citation binding** | A citation resolves `chunkId` → `Chunk` → `Document`. Chunk granularity decides how precise a citation can be |
| **20 — Question bank** | `recall@k` measures whether the right chunk comes back. **Re-chunking invalidates the hit rate** — lock the config before authoring the bank |
| **21 — Spot-check** | The manual check of 10 answers is the only test that catches "retrieves well, cites badly" |
| **22 — Deployment** | `configHash` means a chunking change requires a re-ingest, not just a redeploy. Stale rows are deleted automatically |

---

## 9. Token budget — why `k` is a budget decision first

Groq tier: 8,000 tokens/min; the limiter targets 7,000.

| Component | Tokens |
|---|---|
| `SYSTEM_PROMPT_RAG` | ~500 |
| Retrieved chunks (`k`=5 × ~500) | **~2,500** |
| Trimmed history | ~500–1,500 |
| Completion | ≤700 |
| **Per request** | **~4,200–5,200** |

That is **~1–1.5 requests per minute**. A full evaluation is 60+ calls, so **40+ minutes of throttling per run**.

| Config | Context | Trade |
|---|---|---|
| `k`=5 × 500 | 2,500 | Baseline |
| `k`=3 × 500 | 1,500 | 40% cheaper; recall drops if the answer sits at rank 4–5 |
| `k`=5 × 350 | 1,750 | Same breadth, less complete passages — worse for citation checking |
| `k`=8 × 300 | 2,400 | Broader net, chunks possibly too small to be checkable |

**Retrieval must run before the rate-limiter reservation**, or the limiter under-counts by ~2,500 tokens per request and self-throttling silently stops working.

---

## 10. Open items

| # | Item | Status |
|---|---|---|
| 1 | 3 chunks still under the floor (HTML tails) | Accept, or special-case HTML tail merging |
| 2 | Heading misdetection on 6 of 92 sections | Accept — imprecise, not incorrect |
| 3 | Near-duplicate suppression after retrieval | Not implemented; overlap makes it worthwhile |
| 4 | Linearised table rendering (`col: value`) for embedding | Untested against raw table text |
| 5 | **Leftovers query ranks the wrong chunk first** | **Open** — the 48-hour rule exists but ranks below a fridge-power-setting passage. A `recall@k` problem, to be measured before tuning |

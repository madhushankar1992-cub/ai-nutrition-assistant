# Chunking Strategy

> Companion document: **[`embedding-strategy.md`](./embedding-strategy.md)** — the model, its 384 dimensions, int8 precision, and the bge query/passage asymmetry that all of this depends on.

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
| `HTML_CHUNK_TARGET_TOKENS` | **220** | HTML has no page breaks to act as topic boundaries, so the 500 target produced 757-token chunks spanning three unrelated topics. Every candidate then contained every query term and nothing could outrank anything |

All four live in `lib/retrievalConfig.ts` and are hashed into `configHash`, stored on every chunk. Changing one makes every existing chunk detectably stale.

**Chunk kinds.** Every chunk is classified, and two of the four kinds are never retrievable:

| Kind | Retrievable | What it is |
|---|---|---|
| `prose` | yes | Running text — the default |
| `table` | yes | A detected data table, kept whole even past the cap, because half a table cites a number whose column header is in another chunk |
| `references` | **no** | A bibliography. Built from the vocabulary of the chapters it indexes, so it matches their questions and answers none |
| `toc` | **no** | A contents listing, for the same reason |

The two exclusions are applied in `queryChunks`'s `WHERE` clause rather than filtered afterwards, so
they never consume slots in the candidate pool. Their thresholds are measured against the real
corpus and separate widely: citations per 100 words run 4.8–12.6 for bibliographies and ≤1.8 for
everything else; dot leaders run 7.7–31.1 for contents pages and exactly 0 for every other chunk.

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

From the live store (229 chunks, 7 documents):

```
min=31  p25=220  median=454  p75=481  max=819  mean=375
under floor (<120): 3 (1.3%)      over cap (>900): 0 (0.0%)
prose=205  table=12  references=7  toc=5  restricted=11
```

| Document | Chunks | Mean | Min | Max | Under 120 |
|---|---|---|---|---|---|
| EFSA — Dietary Reference Values | 150 | 439 | 121 | 643 | 0 |
| WHO — Healthy diet (fact sheet) | 32 | 210 | 146 | 329 | 0 |
| The Eatwell Guide | 15 | 414 | 135 | 625 | 0 |
| DGA 2025–2030 | 14 | 300 | 145 | 819 | 0 |
| FSA — chill/freeze/defrost | 12 | 189 | 129 | 321 | 0 |
| WHO — Sodium guideline | 4 | 138 | 57 | 191 | 2 |
| WHO — Five keys | 2 | 91 | 31 | 151 | 1 |

**Section confidence** (how much to trust a citation's section label): `numbered` 45.9% · `typographic` 34.1% · `outline` 18.3% · `inherited` 1.7%.

`outline` is new and is the most trustworthy of the four: it means the section label was read from
an actual `<h1>`–`<h6>` in the source HTML rather than inferred from capitalisation. Every HTML
source now contributes `outline` labels instead of `typographic` guesses.

**The WHO and FSA counts moved sharply in both directions, and both moves are the point.** WHO went
7 → 32 because six of its old seven chunks were navigation menus, not text; the sodium guideline and
Five keys went 9 → 4 and 7 → 2 for the same reason, with no loss of content — those two sources are
publication landing pages whose real body is a short overview, and what was removed was the WHO site
header and footer. FSA went 11 → 12 with its maximum falling 757 → 321, because the chrome that used
to pad its chunks is gone.

---

## 6. Eight bugs the analysis caught

None of these were visible from reasoning about the design. All were found by running the chunker over real documents and measuring the output.

| # | Symptom | Cause | Fix | Result |
|---|---|---|---|---|
| 1 | 27 chunks from 2,699 words (~133 tokens each) | Running page headers — `"Dietary Guidelines… \| 4"` — passed every heading test and shattered the document | Detect boilerplate by cross-page line repetition (>50% of pages) | DGA 27 → **14** chunks |
| 2 | Sentence fragments became sections | `"Instead, prioritize nutrient-dense foods and"` matched the typographic test | Reject lines ending in a continuation word; require Title-Case ratio ≥ 0.6 | Spurious sections largely gone |
| 3 | No minimum chunk size enforced | Nothing stopped a heading closing a 2-line section | Refuse to flush while the buffer is under `MIN_CHUNK_TOKENS` | — |
| 4 | **44 chunks (19%) still under the floor**, all in HTML sources | The guard measured the **raw** buffer; the emitted chunk is whitespace-**normalised**, so indentation inflated the estimate — a "130 token" buffer became a 40-token chunk | Measure the buffer after normalisation, and merge runt pieces forward | **19% → 1.4%**, mean 355 → 388 |

| 5 | WHO fact sheet produced 7 chunks, 6 of them menus | HTML extraction stripped `<script>` and `<style>` but kept `<nav>`, `<header>` and `<footer>` — so "Skip to main content … Dengue Endometriosis Mpox" was ingested as document text | Narrow to the single unambiguous `<main>`/`<article>` container, then drop chrome tags | WHO 7 → **32** real chunks; the one content chunk went from rank 27 to rank 1 |
| 6 | Bibliographies outranked real passages | A reference list is built from the exact vocabulary of the chapters it indexes, so it matches their questions while answering none. Three EFSA reference chunks took ranks 2–4 on the fibre question | Classify by citation density (≥3 per 100 words) and dot-leader density (≥1 per 100 words); exclude both kinds in the retrieval query | 12 chunks excluded; `recall@5` 76.5% → **100%** |
| 7 | WHO's salt limit was cited as `§Protein` | Section detection guessed from capitalisation even on HTML, where the markup already says. "Salt/sodium and potassium" failed the Title-Case test because one of its two long words is lowercase | Mark real `<h1>`–`<h6>` during extraction and take them verbatim | 18.3% of sections now `outline`, the highest-confidence label |
| 8 | "400 g fruit and vegetables" was in no chunk at all | Not a chunking bug: the registered URL was a publication **stub**, not the fact sheet. It returned 200 and read as a plausible document, so no guard fired | Point at the maintained news-room fact sheet | 810 → 3,000 words; the fruit/veg question became answerable |

Bug 4 is the instructive one on measurement: the guard and the thing it guarded were measuring
different strings. It would never have shown up without distribution analysis over real output.

Bugs 5, 6 and 8 are the instructive ones on **trust**. Each produced a corpus that looked healthy by
every aggregate the pipeline reported — document count, word count, chunk count, embedding count all
green — while the text inside was navigation furniture, a bibliography, or simply the wrong page.
Counting artefacts cannot detect this; only reading the stored text and testing whether a known
answer can be retrieved can.

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
| 1 | 3 chunks still under the floor | Accept. All three are in the two WHO landing pages, whose entire body is shorter than one normal chunk |
| 2 | Heading misdetection on PDF sections | Accept — imprecise, not incorrect. No longer applies to HTML, which uses its own `<h*>` outline |
| 3 | Near-duplicate suppression after retrieval | Not implemented; overlap makes it worthwhile |
| 4 | Linearised table rendering (`col: value`) for embedding | Untested against raw table text |
| 5 | ~~Leftovers query ranks the wrong chunk first~~ | **Closed.** Cause was chunk size, not ranking: HTML has no page breaks, so a 500-token target produced 757-token chunks containing every query term. `HTML_CHUNK_TARGET_TOKENS = 220` + density-based lexical scoring. Now rank 1 |
| 6 | ~~EFSA returns the right document, wrong section~~ | **Closed** by bug 6 above — bibliographies and contents pages excluded from retrieval |
| 7 | Chrome stripping is regex-based, not a DOM parse | Accept for a 9-document corpus, and it is guarded: a container yielding under 50 words is rejected and the full page used instead. A new HTML source should be checked with `npm run vectors` after its first ingest |

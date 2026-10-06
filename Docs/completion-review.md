# Completion review — 2026-10-03

> **Status as of 2026-10-06:** the review below is a dated record. Three of its points have changed since. "Every answer is grounded" no longer holds: a labelled general-knowledge tier now answers food questions the corpus does not cover, with no citations (`answerMode: "general"`). The protein question is answered and cited since the 2026-10-05 prompt fix. `docker compose up` was verified end to end on 2026-10-04.

Reviewed the saved frontend, retrieval, watcher and evaluation changes with a second agent.

## Fixes

- Search reports now list only documents with eligible embedded passages and respect the requested source filter.
- Near-tied passages from another source can replace duplicate-source passages. The salt comparison now includes both PHE and US guidance, and its evaluation asserts those specific sources.
- HTTP 304 watcher snapshots retain extraction metadata. Conditional requests use validated baselines, so quarantined changes cannot become an unchanged success on a later run. New responses do not inherit obsolete cache validators.
- Policy notices correctly describe both pre-call and post-call refusals. Network-error replies select their source-panel notice, and pending replies cannot race with Clear.
- Empty or suppressed claims no longer count as fixed numeric drift. Evaluation errors and recorded failures produce nonzero exits. Report table cells escape pipe characters.
- Generation has a shared 45-second deadline, including token-budget waits and retries. SDK retries no longer multiply application retries. Oversized token reservations reject immediately, and queued reservations support cancellation. API evaluation requests also have a deadline.

## Validation

- Production build, lint, TypeScript and diff whitespace checks passed.
- `test:scope`, `test:corpus` and `test:rate` passed.
- Full retrieval evaluation passed: 17/17 passage recall, 8/8 adversarial cases, required cross-document sources present, zero false refusals and zero binding failures across 15 claims. See [retrieval-report.md](retrieval-report.md).
- Live API health and policy refusals were verified. The final filtered-coverage smoke check verifies only the requested document is reported.
- Full live API evaluation **did not pass**: the original run hit a headers timeout during protein generation. After the bounded-generation fix, the rerun exited nonzero on HTTP 422; the persisted generation error was `The operation was aborted`. This verifies the request stops rather than hanging, but does not establish successful model generation under the current service conditions. The old failure log is not presented as the result of that incomplete run.

The changes remain in the workspace for review. Existing staged changes were preserved.

---

# Final delivery pass — 2026-10-04

## Changes

- **Test data removed.** Every `Conversation` held only known test questions from agents and evaluations (salt, calories, kimchi, vitamin C, protein, leftovers, cooked rice, weight at 5'9", diabetes). 38 conversations, 84 messages and 18 claims were deleted in one transaction, Claim → Message → Conversation. `EvalRun`, `FailureLogEntry`, `ScrapeRun`, `CorpusSnapshot` and the corpus tables were not touched.
- **WHO publication-page junk removed at the source.** The `who-five-keys` and `who-sodium-guideline` pages carried catalogue chrome inside the `<article>`: an "Editors / Number of pages / ISBN / Copyright" sidebar, a language switcher, and related-publication link lists. These became retrievable prose chunks with sections titled "Editors" and "Français". `lib/corpus/extract.ts` now strips those containers by class at extraction time (`removeElementsByClass`), so the daily ingest cannot recreate them. Re-ingested with 0 warnings and 0 errors: 229 → 226 chunks. The other five sources produce byte-identical chunks, and the overview text and the five keys are unchanged.
- **Entity decoding.** Unknown mixed-case entities (`&Aacute;`) were lowercased into the wrong letter. Only all-caps names (`&AMP;`) now fall back to the lowercase table. Common capital accented letters were added, and any other unknown entity is left as written.
- **Chat input limit.** `ChatInput` enforces the server's 4,000-character cap. It shows a counter near the limit and blocks sending when the message is over it. The limit lives in `lib/limits.ts` and is shared with `lib/schema.ts`.
- **Dead Milestone 1 path removed.** `generateStructuredAnswer`, `M1_SCHEMA`, `M1ResponseSchema` and the ungrounded `SYSTEM_PROMPT` had no caller. Every answer is grounded.
- **Prompt.** `SYSTEM_PROMPT_RAG` no longer asks the model to "name the documents that were searched", because it never sees that list. When the passages do not answer the question, the model must now say so and return no claims. The sufficiency gate in code still names the documents searched.
- **Docs.** The Milestone 2 status, the unbuilt `RetrievalRecord` and the stale `vector(1536)` text were brought in line with the as-built system.

## Owner decisions and known limitations (not changed)

- **Protein question refusal.** "How much protein does the average adult need daily?" is refused by scope policy. Whether population-level protein reference values should be answerable is a scope decision for the owner.
- **`docker compose up` is untested.** Docker is not installed on the delivery machine.
- **Vercel latency.** Under Groq's per-minute token budget, answers through Vercel → Railway can be slow when several requests arrive close together.

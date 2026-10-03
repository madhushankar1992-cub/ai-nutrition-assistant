# Completion review — 2026-10-03

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

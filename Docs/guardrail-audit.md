# Guardrail and release audit — 2026-10-07

Release status: verification in progress; production deployment is not yet verified.

## Findings and fixes

- The live frontend refused the exact question `how many eggs to eat per day?` as unrelated. The first local candidate reproduced it. A direct general-tier call answered correctly, isolating the defect to the grounded tier confusing missing evidence with topic restrictions. The grounded prompt now explicitly returns an empty-claim coverage gap for this case so the existing general-answer fallback can run.
- Explicit irrelevant tasks, food-themed programming/writing, mixed-topic requests, prompt injections and common multilingual attacks are rejected before retrieval and Groq. Both prompts still handle semantic cases beyond those explicit patterns. Legitimate food quantities, cooking arithmetic and regional cuisines remain allowed.
- Response checks normalize line breaks and inspect generated claim text as well as the answer. Refusals suppress claims and retrieved passages.
- Capacity responses preserve the actual retry hint through the frontend proxy. Authentication, provider outage, timeout and schema failures remain distinct and expose no provider error details or credentials. Persistence failure during an error path remains retryable rather than becoming an opaque server error.
- General-answer fallback reports insufficient passage support instead of claiming its retrieval was sufficient.
- Evaluation versions include both active prompts. General answers are not penalized for intentionally empty citations; unexpected food refusals and answer-mode changes are reported. Retrieval/citation release failures exit unsuccessfully.
- The moved prompt iteration log was restored to `Docs/`, preserving its existing links.

## Validation

- Scope suite: 78 checks passed.
- Independent offline chat suite: 33 checks passed, including real route execution with mocked persistence/model/retrieval, ownership, cache, document-filter behavior, provider errors and proxy interruption.
- Existing rate-limiter and corpus-watcher checks: passed.
- TypeScript, lint and production build: passed again after the coverage clarification.
- Final real-model preflight: 3/3 passed (health/fingerprint, uncached eggs and general cuisine). Eggs returned a substantive general answer in 7.5 seconds with zero claims and insufficient passage support correctly labelled.
- Real pre-release guardrail probes: 6/6 passed (trivia, food-themed programming, mixed task, instruction override, personal calorie target and semantic batteries question). All returned refused mode without citations.
- Retrieval bank: all 17 answerable questions found the expected passage, including both required sources in the cross-document salt question. No Groq call or corpus write was needed for this recall check.
- Both existing production health endpoints: HTTP 200, 7 documents, 226 chunks, 226 embedded, retrieval config `b63742d51a`.
- Existing reports are historical, not fresh evidence of this release. A live API audit is run separately with quota-aware pacing; it deletes only its own test conversations.

## Deployment and limitations

Railway service inspection found no linked source repository, contrary to the previous handoff assumption. Its active deployment was CLI-created; neither a healthy endpoint nor GitHub containing `9020f82` proves that commit's content is live. Upload tested source explicitly to Railway and deploy Vercel separately. `GET /api/chat` now includes a hash of both active prompts for release verification.

The existing Groq plan's shared quota is a real provider limit. Caching and early refusals conserve quota; new distinct questions can still receive retryable capacity responses. No plan, model/provider, host topology, Docker safeguards or corpus configuration is changed. Local environment files and the updated Groq key remain untouched. The short-lived corpus-version cache and process-local limiter/cache retain their existing deployment limitations.

Credential comparison, without printing either key, confirmed Railway's existing key matches the updated local key. Its backend proxy remains disabled and its model matches the existing local choice. No credential update or setup change was necessary.

# Guardrail and release audit — 2026-10-07

Release status: functional delivery and both production deployments verified. Existing dependency security remediation remains outstanding, separately from the passing guardrail audit.

## Verified production release

- Source release: `9425436` (includes and supersedes `9020f82`). Pushed to `master`.
- Railway: deployment `b8404826-1652-406e-b4bb-29a04649c814`, `SUCCESS`, explicitly built from the tested source.
- Vercel: deployment `dpl_9qfUu3jmnD3UncV7ef6K9drowErz`, `READY`, production alias [ai-nutrition-assistant-self.vercel.app](https://ai-nutrition-assistant-self.vercel.app).
- Both live health endpoints: HTTP 200, prompt fingerprint `c23893d721ab`, corpus 7 documents / 226 chunks / 226 embedded, retrieval config `b63742d51a`.
- Full production API audit: **16/16 passed, 0 failed**. The exact uncached eggs question returned a substantive general answer in 7.37 seconds. Nine explicit refusal cases, semantic unrelated content, general cuisine, Hindi food, grounded citations, cached replay and ownership all passed.
- Cached repeat: returned the same first-question answer with `cached: true` in 1.02 seconds; a different owner received 404.
- Actual browser smoke: a broccoli poem request was refused with the off-topic badge; a new eggs question displayed its substantive answer and the general-knowledge/no-citations label. Browser console error log was empty. Screenshot capture was unavailable; verification used the visible accessibility state and API evidence.
- Master delivery agent independently accepted the release. Both salt claims were matched to the exact retrieved passages and publishers.
- Environment file hashes remained unchanged after release, and the remote/local Groq key comparison matched without displaying either key.

Audit command: run `scripts/audit-chat.ts` with `AUDIT_BASE_URL` set to the production frontend. The script paces fresh calls for the existing quota, bypasses cache when checking generation, records retryable failures, omits cookies/conversation IDs from saved evidence, and deletes only its own test conversations. Documentation-only completion updates do not need another application deployment.

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

## Existing dependency alerts

A separate read-only `npm audit --omit=dev` reports four affected production packages: Next.js (critical), PostCSS and source-map-js (high), and UUID (moderate). The build's broader count of 14 includes development packages. These are package-level advisory results, not proof that every exploit applies to this app.

Installed Next.js 14.2.35 falls within published advisory ranges, including [the AVIF image-optimizer advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4). Review found no image-upload feature, external image patterns, or `next/image` imports, so that specific exploit chain is not established. Some Server Component denial-of-service advisories still cover the App Router framework. Dependency remediation remains incomplete; this guardrail audit does not claim the app is fully secure. The suggested Next.js update is a major framework change, which is deferred to preserve the explicitly requested setup and needs separate compatibility testing.

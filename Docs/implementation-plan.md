# Implementation Plan — AI Nutrition Assistant (Milestone 1)

Phased build order derived from [problemStatement.md](problemStatement.md) and [architecture.md](architecture.md). Each phase ends in a runnable/verifiable state; later phases assume earlier ones are done. "Exit criteria" are what to check before moving on.

---

## Phase 0 — Project Scaffolding

**Goal:** an empty but runnable Next.js app, ready for feature work.

- Initialize Next.js 14 (App Router) + TypeScript + Tailwind.
- Add dependencies: `@anthropic-ai/sdk`, `zod`, `zod-to-json-schema`, `@prisma/client` + `prisma`, `uuid`, `tsx`.
- Create the folder structure from architecture.md §4 (`app/`, `components/`, `lib/`, `prisma/`, `data/`, `scripts/`).
- Add `.env.local.example`, `.gitignore`.
- `git init`, initial commit, create the GitHub repo, push.

**Exit criteria:** `npm run dev` serves a blank page with no errors; repo exists on GitHub.

---

## Phase 1 — Data Layer

**Goal:** persistent storage for conversations, messages, claims, and eval/failure records.

- Write `prisma/schema.prisma` (`Conversation`, `Message`, `Claim`, `EvalRun`, `FailureLogEntry`) per architecture.md §7.
- Provision a Postgres instance (Supabase or Neon), set `DATABASE_URL` in `.env.local`.
- Run `prisma migrate dev` to create tables.
- Add `lib/db.ts` (Prisma client singleton, hot-reload-safe).

**Exit criteria:** `npx prisma studio` shows all five empty tables against the real database.

---

## Phase 2 — Response Schema and System Prompt

**Goal:** the contract every later phase builds against — get this right before wiring the model or UI to it.

- `lib/schema.ts`: `ClaimSchema` (`text: string`, `source: null`), `ChatResponseSchema` (`answer`, `claims[]`), `ChatRequestSchema`.
- `lib/systemPrompt.ts`: role, style/length limits, claim-decomposition instruction, and the excluded-topics list (calorie/weight targets, personal weight recommendations, medical/condition-specific advice) with the refer-to-a-professional instruction.

**Exit criteria:** schema and prompt reviewed against problem-statement §3 line by line — every bullet has a corresponding schema field or prompt clause.

---

## Phase 3 — LLM Integration

**Goal:** a working, schema-validated call to Claude, independent of the API route or UI.

- `lib/anthropic.ts`: Anthropic client, `submit_answer` tool built from `ChatResponseSchema` via `zodToJsonSchema`, forced `tool_choice`, one retry-with-correction on schema validation failure.
- Manual smoke test via a throwaway script or `tsx` REPL: call `generateStructuredAnswer` with a sample question, confirm the shape matches `ChatResponseSchema` and `source` is always `null`.

**Exit criteria:** at least 5 varied manual questions return valid, schema-conformant JSON with `source: null` on every claim; a forced malformed case demonstrates the retry path.

---

## Phase 4 — Scope Guard (Code-Level Enforcement)

**Goal:** backend restrictions that hold regardless of prompt wording, built and unit-tested before they're wired into the live request path.

- `lib/scopeGuard.ts`: `checkRequest` (numeric target / personal weight / medical-advice patterns, checked against the new message plus recent history) and `checkResponse` (post-hoc leak detection on the generated answer).
- Write a small standalone test list (direct / rephrased / indirect / post-unrelated-message phrasings for both calorie-target and condition-specific-diet requests) and run it against `checkRequest` directly (no API yet) to tune patterns.

**Exit criteria:** all planned scope-abuse phrasings in the test list are caught by `checkRequest` in isolation, with no false positives on the 10 eval questions' phrasing style.

---

## Phase 5 — Chat API Route

**Goal:** wire Phases 1–4 together behind the frozen `/api/chat` contract.

- `app/api/chat/route.ts` implementing the 9-step pipeline from architecture.md §6.2: load/create conversation → pre-call guard → compose history → call model → validate → force `source: null` → post-call guard → persist → respond.
- Failure logging (`FailureLogEntry` inserts) at every failure branch: guard-triggered refusal, invalid schema, post-call leak caught.

**Exit criteria:** using `curl`/Postman, a normal question returns a valid response and persists rows in `Conversation`/`Message`/`Claim`; a scope-violating question returns the refusal template with `claims: []` and no model call is made (verify via logs); conversation history round-trips correctly across two sequential calls with the same `conversationId`.

---

## Phase 6 — Chat UI

**Goal:** the three-region interface required by problem-statement §1 and §5, talking only to the local API.

- `components/MessageBubble.tsx`, `ChatInput.tsx`, `SourcesPanel.tsx`, `ChatWindow.tsx`; `app/page.tsx` renders `ChatWindow`.
- Sources panel renders selected message's claims; every `source: null` claim shows the "no sources yet" placeholder (never hidden or omitted).
- Conversation history persists across follow-up questions within a session (backed by Phase 5's persistence, not just client state).

**Exit criteria:** manually drive a multi-turn conversation in the browser, including a follow-up question; confirm the sources panel updates per selected message and stays visibly present (not blank/missing) even with all-null sources.

---

## Phase 7 — Evaluation Dataset and Harness

**Goal:** the repeatable measurement process required by problem-statement §6.

- `data/eval-questions.json`: the fixed 10 questions (nutrient requirements, food safety/storage, cooking methods, no-clear-answer), each with a stable `id`.
- `scripts/evaluate.ts`: runs each question 3x against `/api/chat`, diffs claims for numeric drift and non-null sources, flags zero-claim answers on questions expected to be substantive, persists `EvalRun`/`FailureLogEntry` rows, and writes grouped, counted results to `Docs/failure-log.md`.

**Exit criteria:** `npm run eval` completes against a locally running dev server and produces `Docs/failure-log.md` with a populated summary table (even if all counts are legitimately low) and per-category detail sections.

---

## Phase 8 — Scope Abuse Testing (End-to-End)

**Goal:** verify the Phase 4 guard holds through the full stack, not just in isolation, per problem-statement §7.

- Extend `scripts/evaluate.ts`'s scope suite (already scaffolded in Phase 7) to cover, for both calorie-target and condition-specific-diet requests: direct, rephrased, indirect, and asked-again-after-unrelated-messages within the same conversation.
- Run the suite against the live API (not just `checkRequest` in isolation) so a pass also confirms Phase 5's wiring is correct end-to-end.

**Exit criteria:** every scope-abuse case in the suite is declined (`claims: []`, refusal text) with zero exceptions; any failure is triaged by tightening `scopeGuard.ts` patterns and rerunning, not by special-casing the specific test question.

---

## Phase 9 — Prompt Iteration Loop

**Goal:** close the loop the problem statement requires — rerun everything after every prompt change.

- Establish the working rhythm: edit `lib/systemPrompt.ts` → `npm run eval` (Phase 7 dataset) → rerun Phase 8 scope suite → compare `Docs/failure-log.md` against the previous `promptVersion`'s counts.
- Iterate until: unsupported-claim and numeric-drift counts are as low as practical, hedging is reduced without losing correctness, and the scope suite is at 100%.

**Exit criteria:** at least one full iteration cycle completed and documented (before/after failure counts by category, tied to specific prompt changes) in `Docs/failure-log.md` or an accompanying note.

---

## Phase 10 — Deployment

**Goal:** the public, reviewable deliverable required by problem-statement §7.

- Push final code to GitHub (if not already continuous from Phase 0).
- Create Vercel project linked to the repo; set `ANTHROPIC_API_KEY` and `DATABASE_URL` as environment variables; confirm `postinstall` runs `prisma generate` and migrations are applied to the production database.
- Smoke-test the deployed URL: one normal question, one scope-abuse question, confirm persistence works against the production database.

**Exit criteria:** public URL live, both smoke tests pass, GitHub repo is the source of truth for the deployed build.

---

## Phase 11 — Milestone 2 Readiness Check

**Goal:** confirm nothing in Milestone 1 needs to be reworked, per problem-statement §8 and architecture.md §12.

- Review the extension-points table in architecture.md §12 against the actual implementation: confirm `source` is the only field that will change type, the API response shape is untouched, and `SourcesPanel` requires no structural changes to display real citations.
- Archive the Milestone 1 `Docs/failure-log.md` (e.g. copy to `Docs/failure-log-m1-baseline.md`) so Milestone 2's rerun of the same 10 questions has a fixed baseline to diff against.

**Exit criteria:** a short written confirmation (in `Docs/` or the PR description) that Milestone 2 can begin by adding a retrieval step without touching the schema, API contract, or UI components.

---

## Phase Summary

| Phase | Deliverable | Depends on |
|---|---|---|
| 0 | Scaffolded repo | — |
| 1 | DB schema + client | 0 |
| 2 | Response schema + system prompt | 0 |
| 3 | LLM call wrapper | 2 |
| 4 | Scope guard (unit-level) | 2 |
| 5 | `/api/chat` route | 1, 3, 4 |
| 6 | Chat UI | 5 |
| 7 | Eval dataset + harness | 5 |
| 8 | End-to-end scope testing | 5, 7 |
| 9 | Prompt iteration loop | 7, 8 |
| 10 | Deployment | 5, 6 |
| 11 | Milestone 2 readiness check | 9, 10 |

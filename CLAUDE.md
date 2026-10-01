# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                  # also runs `prisma generate` via postinstall
cp .env.local.example .env.local   # fill in GROQ_API_KEY and DATABASE_URL
npm run prisma:migrate       # prisma migrate dev — apply schema to the DB in DATABASE_URL
npm run dev                  # http://localhost:3000
npm run build                # next build
npm start                    # next start -H 0.0.0.0 -p ${PORT:-3000} — used by Railway only; Vercel's serverless runtime never runs this script
npm run lint                 # next lint
```

Testing/evaluation (there is no unit-test framework; these two scripts are the test suite):

```bash
npm run test:scope           # tsx scripts/test-scope-guard.ts — unit-level, no server/model call needed.
                              # Runs lib/scopeGuard.ts's checkRequest directly against restricted phrasings
                              # (must be blocked) and the 10 eval questions + 5 counter-examples (must be allowed).
                              # Exits non-zero on any failure.

npm run eval                  # tsx --env-file=.env scripts/evaluate.ts — requires the app already running
                              # (default http://localhost:3000, override with EVAL_BASE_URL). Calls the live
                              # /api/chat 3x per question across the fixed 10-question dataset
                              # (data/eval-questions.json) plus an 8-case scope-abuse suite, then writes
                              # Docs/failure-log.md and EvalRun/FailureLogEntry rows to the DB.
```

`DATABASE_URL` must point at a real Postgres instance even for local dev — `prisma/schema.prisma`'s datasource is `postgresql`, not SQLite (a leftover `prisma/dev.db` from earlier SQLite-based development exists but is not what the current schema uses).

## Architecture

Single Next.js 14 App Router app — one codebase serves both the frontend and the only backend route, `app/api/chat/route.ts` (`POST` + `DELETE`). There is no separate backend service.

**Request pipeline (`POST /api/chat`)**, in `app/api/chat/route.ts`:
1. Validate the request body against `ChatRequestSchema` (`lib/schema.ts`).
2. Load/create the `Conversation`, load its prior `Message` rows.
3. Pre-call scope guard (`lib/scopeGuard.ts`'s `checkRequest`) — a **regex-based**, code-level check (not a classifier, not prompt-reliant) run against the last 6 turns of history plus the new message, so rephrased/indirect/split-across-turns restricted requests (calorie/macro targets, personal weight recommendations, condition-specific medical advice) are still caught. If blocked, the fixed `REFUSAL_MESSAGE` is returned and the LLM is never called.
4. Call Groq (`lib/groq.ts`, model `openai/gpt-oss-120b` by default, override via `GROQ_MODEL`) using **Structured Outputs** (`response_format: { type: "json_schema", strict: true }`), not forced tool-calling — forced `tool_choice` was tried first but `gpt-oss` reasoning models intermittently emit chain-of-thought instead of a clean tool call under it, which Groq's tool-call parser then rejects with a 400. `json_schema` output lands in `message.content` as plain text instead, avoiding that parser.
5. Validate the parsed response against `ChatResponseSchema`; one retry with an explicit correction turn on schema mismatch, else a 422 with a generic apology.
6. Force every claim's `source` to `null` regardless of what the model returned (defense in depth against a prompt-injection or model slip fabricating a citation).
7. Post-call scope guard (`checkResponse`) — regex scan of the generated answer for leaked numeric/medical content even if the pre-call check passed.
8. Persist the assistant message + claims; respond with `{ conversationId, answer, claims[] }`.

`DELETE /api/chat?conversationId=` cascades claims → messages → the conversation itself (application-level cascade, not DB-level).

**The `{conversationId, answer, claims[]}` response shape is intentionally frozen** — `ClaimSchema.source` (`lib/schema.ts`) is `z.null()` for the whole of Milestone 1 and is meant to widen to `z.string().url().nullable()` in Milestone 2 (real retrieval/citations) without any field rename or shape change. Don't treat `source: null` as a placeholder to delete; `SourcesPanel` (`components/SourcesPanel.tsx`) already has the populated-source rendering branch written and unreachable, waiting for M2.

**Schema sharing**: `lib/schema.ts`'s Zod schemas are the single source of truth — converted via `zod-to-json-schema` into Groq's `response_format.json_schema.schema`, and reused as-is to validate both the incoming request and the parsed LLM response.

**Rate limiting** (`lib/rateLimiter.ts`): an in-memory, process-local limiter throttling calls under Groq's `openai/gpt-oss-120b` tier caps (30 req/min, 8,000 tokens/min, 1,000 req/day, 200,000 tokens/day), targeting a safety margin (25 req/min, 7,000 tokens/min) rather than the limit itself. It is **best-effort only** — it does not coordinate across multiple serverless instances or survive a process restart. The authoritative backstop is Groq SDK's own `RateLimitError` (429) handling in `lib/groq.ts`, which retries with backoff independently of what the local limiter believes.

**Frontend**: `app/page.tsx` renders a single client component, `ChatWindow` (`components/ChatWindow.tsx`), which owns all state via plain `useState` (no external state library) keyed by `conversationId`. It composes `MessageBubble` (assistant bubbles are clickable/selectable), `ChatInput`, and `SourcesPanel` (claims for the currently *selected* assistant message; hidden below the `md` breakpoint). The client never calls Groq directly and never sees `GROQ_API_KEY`.

**Data model** (`prisma/schema.prisma`): `Conversation` → `Message` → `Claim`, plus `EvalRun` and `FailureLogEntry` used only by `scripts/evaluate.ts`. `EvalRun.promptVersion` is `sha256(SYSTEM_PROMPT).slice(0,10)` — failure counts are grouped by `(promptVersion, category)` so prompt-iteration regressions are comparable over time.

**Deployment — two live targets sharing one database, and they behave differently**: the app is deployed to both Vercel (`https://ai-nutrition-assistant-self.vercel.app`) and Railway (`https://app-production-3fe4f.up.railway.app`), both pointed at the same Railway-hosted Postgres `DATABASE_URL`. **Railway auto-deploys on push to the linked GitHub branch; Vercel does not** — its GitHub connection was never actually linked (`vercel link`/`git connect` require a one-time dashboard OAuth step), so Vercel deploys only happen via `vercel --prod` run manually from this repo. A `git push` alone updates Railway and GitHub but **not** the live Vercel URL — don't assume otherwise when verifying a change went live. See `Docs/deployment-plan.md` §9 ("What Actually Happened") for the full list of deploy-time gotchas (Railway port-binding, migration generation workaround, etc.).

**System prompt** (`lib/systemPrompt.ts`): exports `SYSTEM_PROMPT`, a single template string defining the assistant's persona ("Sage"), answer style (concise, ~150 words, no padding/hedging, answer only what was asked — added specifically so repeated identical questions get comparable answers across the 3x eval runs), the claims-decomposition instruction, and the same out-of-scope categories as the code-level `scopeGuard` (defense in depth — the prompt is not relied on alone).

See `Docs/architecture.md` for the full as-built design (this supersedes the original pre-build plan where the two diverge) and `Docs/deployment-plan.md` for deployment specifics.

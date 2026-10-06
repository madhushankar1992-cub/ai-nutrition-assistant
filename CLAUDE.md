# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                  # also runs `prisma generate` via postinstall
cp .env.local.example .env.local   # fill in GROQ_API_KEY and DATABASE_URL
npm run prisma:migrate       # prisma migrate dev — apply schema to the DB in DATABASE_URL
npm run dev                  # http://localhost:3000
npm run build                # next build
npm start                    # next start -H 0.0.0.0 — Next reads PORT itself. Do NOT reintroduce
                             # `-p ${PORT:-3000}`: npm does not run this through a POSIX shell on
                             # Windows, so the literal string is passed and the server refuses to start.
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

npm run eval:retrieval        # tsx scripts/evaluate-retrieval.ts — the Milestone 2 suite. Calls retrieve()
                              # directly (no server needed) over data/retrieval-questions.json, reporting
                              # recall@k, document_recall@k, false refusals and an 8-case adversarial suite,
                              # then writes Docs/retrieval-report.md. Exits non-zero if adversarial < 100%.
```

Corpus commands (these need `GROQ_API_KEY`, which lives in `.env.local`, not `.env` — hence the two
`--env-file` flags already wired into the npm scripts):

```bash
npm run ingest               # scrape -> extract -> chunk -> embed -> upsert into pgvector. Writes logs/ingest-*.log
npm run corpus:watch         # fetch each source and report drift; detects, never auto-updates
npm run vectors              # inspect stored chunks and their embeddings
```

Local stack with Docker (app + Postgres/pgvector on one machine; production does not use this):

```bash
docker compose up --build                          # app on http://localhost:3000, db on host port 5433
docker compose --profile ingest run --rm ingest    # first run only: load the corpus into the empty local db
```

Verified end to end on 2026-10-04 (Docker Desktop 4.93 on WSL 2): all 5 migrations apply to an empty database, the ingest service loads 7 documents / 226 chunks / 226 embedded with 0 warnings, the app answers with citations, and the production database was byte-for-byte unchanged before and after. `docker-compose.yml` reads `.env.local` only for the Groq key. `.env.local` holds the **production** `DATABASE_URL`, so every service overrides `DATABASE_URL` (and blanks `BACKEND_API_URL`) in its `environment` block, which always wins over `env_file`. Never remove those overrides, or a local run writes to production. `.dockerignore` keeps every `.env*` file out of the image.

`DATABASE_URL` must point at a real Postgres instance even for local dev — `prisma/schema.prisma`'s datasource is `postgresql`, not SQLite (a leftover `prisma/dev.db` from earlier SQLite-based development exists but is not what the current schema uses). It must also have the **pgvector** extension available.

**Never run `prisma db push` against a database holding chunks.** `Chunk.embedding` is a `vector(384)` column that Prisma cannot model, so `db push` diffs it against `schema.prisma`, does not find it, and drops it — silently emptying the index until a full re-ingest. This has happened once. Use `prisma migrate deploy`; the column is created by `prisma/migrations/20261003120000_chunk_embedding_vector`.

## Architecture

Single Next.js 14 App Router app — one codebase serves the frontend and the only backend route, `app/api/chat/route.ts` (`GET` + `POST` + `DELETE`). The same code runs on both hosts; what differs is one environment variable (see Deployment).

**Request pipeline (`POST /api/chat`)**, in `app/api/chat/route.ts`:
1. If `BACKEND_API_URL` is set, forward the whole request to that backend and return its response verbatim. Everything below then happens on the container, not here.
2. Validate the request body against `ChatRequestSchema` (`lib/schema.ts`). Malformed JSON returns 400, not a throw.
3. Load/create the `Conversation`, load its prior `Message` rows. History is keyed by `conversationId`, which is what keeps concurrent chat threads from seeing each other's turns.
4. Pre-call scope guard (`lib/scopeGuard.ts`'s `checkRequest`) — a **regex-based**, code-level check (not a classifier, not prompt-reliant) run against the last 6 turns of history plus the new message, so rephrased/indirect/split-across-turns restricted requests (calorie/macro targets, personal weight recommendations, condition-specific medical advice) are still caught. If blocked, the fixed `REFUSAL_MESSAGE` is returned and neither retrieval nor the LLM runs. **This runs before retrieval deliberately**: a calorie request is refused on policy whether or not the corpus could answer it, and refusing here means it is never miscounted as a coverage gap in the retrieval metrics.
5. Retrieve (`lib/retrieval.ts`). Embed the query with bge-small, over-fetch `k*4` candidates from pgvector, re-rank with IDF-weighted lexical density. An embedding or store failure is a **hard** failure returning 503 — there is deliberately no fallback path from "retrieval unavailable" to "answer from model knowledge".
6. Sufficiency gate. If the best passages are too weak (`absoluteFloor` / `relevanceFloor` in `lib/retrievalConfig.ts`), the model is never asked to write a *grounded* answer from thin material. Instead:
   - **`documentKey` set**: return the not-in-corpus answer naming the documents searched. The user asked about one document, so a general answer would misrepresent it.
   - **Otherwise, the general-knowledge tier (added 2026-10-06)**: a second Groq call, `generateGeneralAnswer` in `lib/groq.ts` with `SYSTEM_PROMPT_GENERAL`, answers any food, nutrition, cooking or food-safety question from model knowledge. Same structured-output schema, but the server forces `claims: []`: with no retrieved passages any citation would be fabricated. The off-topic check (reply containing `OFF_TOPIC_MESSAGE` becomes exactly that, `answerMode: "refused"`) and the post-call `checkResponse` guard both run on it. The response carries `answerMode: "general"` and the UI badges it "General knowledge — not from the cited official documents". It costs one extra Groq call only on uncovered questions, under the same rate limiter and deadline. The gap is still logged as `not_in_corpus`, so `eval:retrieval`'s adversarial cases (which test `retrieve().sufficient`) are unaffected.
7. Call Groq (`lib/groq.ts`, model `openai/gpt-oss-120b` by default, override via `GROQ_MODEL`) using **Structured Outputs** (`response_format: { type: "json_schema", strict: true }`), not forced tool-calling — forced `tool_choice` was tried first but `gpt-oss` reasoning models intermittently emit chain-of-thought instead of a clean tool call under it, which Groq's tool-call parser then rejects with a 400. `json_schema` output lands in `message.content` as plain text instead, avoiding that parser.
8. Bind citations (`lib/citations.ts`). The model emits `{text, chunkId}`; the server looks each `chunkId` up among the chunks retrieved **for this request** and builds the citation from the database row. A claim whose `chunkId` was not retrieved is **dropped**. This is what makes a fabricated citation structurally impossible — the model selects, the server cites.
9. Post-call scope guard (`checkResponse`) — regex scan of the generated answer for leaked numeric/medical content even if the pre-call check passed.
10. Persist the assistant message + claims; respond with `{ conversationId, answer, claims[], answerMode, retrieval }`. `answerMode` is `"grounded" | "general" | "refused"` (`AnswerModeSchema` in `lib/schema.ts`). A grounded-tier reply that is the off-topic message, or that the post-call guard replaced, is `"refused"`.

`GET /api/chat` returns service status — API, database and corpus counts, plus whether `GROQ_API_KEY` is configured (never any part of its value). It exists because this URL is the first thing anyone opens when checking the backend, and a bare 405 reads as an outage.

`DELETE /api/chat?conversationId=` cascades claims → messages → the conversation itself (application-level cascade, not DB-level). It never touches `Document` or `Chunk`: those are corpus data, not user data.

**Conversation ownership** (`lib/session.ts`): `conversationId` used to be accepted from the client with no check, so anyone holding a UUID could read or extend that conversation. Each browser now receives an opaque id in a signed, httpOnly, `SameSite=Lax` cookie (`nk_owner`), and `Conversation.ownerId` must match. A mismatch answers **404, not 403**, so the endpoint never confirms to a non-owner that an id exists. This is **not** user accounts: no login, no identity, nothing personal in the cookie. Conversations created before ownership existed have `ownerId = null` and are claimed by the first browser to open them — the only migration that does not destroy history. The cookie must survive the Vercel→Railway hop, so `proxyToBackend` forwards `cookie` and returns `set-cookie`; drop either and every request mints a new owner. Signing key is `SESSION_SECRET`, falling back to `DATABASE_URL` so the cookie is never signed with a weak default.

**The `{conversationId, answer, claims[]}` response shape has been stable since Milestone 1.** `ClaimSchema.source` widened from `z.null()` to a `Citation` object when real retrieval landed, with no field rename or shape change; `retrieval` was added alongside, and `answerMode` on 2026-10-06, so an M1 client keeps working and simply ignores both. Note the two-schema split in `lib/schema.ts`: `LlmClaimSchema` (`{text, chunkId}`) is what the model may emit, `ClaimSchema` (`{text, source}`) is what the API returns.

**Schema sharing**: `lib/schema.ts`'s Zod schemas are the single source of truth — converted via `zod-to-json-schema` into Groq's `response_format.json_schema.schema`, and reused as-is to validate both the incoming request and the parsed LLM response.

**Rate limiting** (`lib/rateLimiter.ts`): an in-memory, process-local limiter throttling calls under Groq's `openai/gpt-oss-120b` tier caps (30 req/min, 8,000 tokens/min, 1,000 req/day, 200,000 tokens/day), targeting a safety margin (25 req/min, 7,000 tokens/min) rather than the limit itself. It is **best-effort only** — it does not coordinate across multiple serverless instances or survive a process restart. The authoritative backstop is Groq SDK's own `RateLimitError` (429) handling in `lib/groq.ts`, which retries with backoff independently of what the local limiter believes.

**Frontend**: `app/page.tsx` renders a single client component, `ChatWindow` (`components/ChatWindow.tsx`), which owns all state via plain `useState` (no external state library) keyed by `conversationId`. It composes `MessageBubble` (assistant bubbles are clickable/selectable), `ChatInput`, and `SourcesPanel` (claims for the currently *selected* assistant message; hidden below the `md` breakpoint). `ChatInput` enforces the same 4,000-character cap as the server (`MAX_MESSAGE_CHARS`, defined in the import-free `lib/limits.ts` so the browser bundle does not pull in zod, and re-exported by `lib/schema.ts`): it shows a counter near the limit and blocks sending over it, rather than truncating. The client never calls Groq directly and never sees `GROQ_API_KEY`.

**Retrieval corpus** (`lib/corpus/`): `sources.ts` is the registry of which documents may be cited, with `expectTitleContains`/`expectYearIn` edition guards — two candidates once returned HTTP 200 while being the *wrong edition*, which would be a fabricated citation behind a working link. The registry holds exactly **7 sources, all of which actually ingest**; two US food-safety charts were removed on 2026-10-03 because they 403 to every programmatic client, had never produced a chunk, and were the only warnings in every run. `fetcher.ts` → `extract.ts` → `chunker.ts` → `embeddings.ts` → `vectorStore.ts` is the ingestion chain, driven by `scripts/ingest.ts` and by `.github/workflows/corpus-ingest.yml` on cron `45 3 * * *` (03:45 UTC = 09:15 IST).

Three things in that chain are easy to get wrong and are load-bearing:
- **HTML sources need their site chrome stripped** (`isolateMainContent` + `CHROME_TAGS` in `extract.ts`). Without it the WHO fact sheet ingested as 7 chunks of which 6 were navigation menus, and the one real chunk ranked 27th on a question only it could answer.
- **who.int publication pages carry catalogue chrome inside the `<article>`** — the "Editors / Number of pages / ISBN / Copyright" sidebar, a language switcher, and "Related publications"/"Systematic reviews" link lists. They ingested as retrievable prose chunks (sections titled "Editors" and "Français"). `PUBLICATION_PAGE_CHROME_CLASSES` + `removeElementsByClass` in `extract.ts` strip them at extraction, so the daily ingest cannot recreate them; deleting the rows alone is useless.
- **Bibliographies and contents pages are classified and never retrieved** (`classifyNonProse` in `chunker.ts`, excluded in `queryChunks`'s WHERE clause). They are built from the same vocabulary as the chapters they index, so they match those chapters' questions while being unable to answer any.

**Data model** (`prisma/schema.prisma`): `Conversation` → `Message` → `Claim`, plus the corpus tables `Document` → `Chunk`, `CorpusSource`, `CorpusSnapshot`, `ScrapeRun`, and `EvalRun`/`FailureLogEntry` used by the eval scripts. `EvalRun.promptVersion` is `sha256(SYSTEM_PROMPT_RAG).slice(0,10)` (the prompt the live route uses) — failure counts are grouped by `(promptVersion, category)` so prompt-iteration regressions are comparable over time. Every `Chunk` also stores `configHash`, so chunks produced by a superseded retrieval config can be detected and removed rather than silently mixed with current ones.

**Deployment — two live targets sharing one database, with different jobs.** The app is deployed to both Vercel (`https://ai-nutrition-assistant-self.vercel.app`) and Railway (`https://app-production-3fe4f.up.railway.app`), both pointed at the same Railway-hosted Postgres `DATABASE_URL`.

*They are not interchangeable.* Retrieval embeds the query locally with bge-small, which loads in Railway's long-running container and **cannot** load in a Vercel serverless function. So Vercel serves the UI and forwards `/api/chat` to the container via the `BACKEND_API_URL` env var. That forwarding lives **inside the route handler**, not in `next.config.js`: a `rewrites()` entry was tried first and silently did nothing, because Next gives filesystem routes precedence over rewrites and `app/api/chat/route.ts` always won.

**Do not retry the "just make the model smaller" fix — it has been tried and measured.** The weights were cut from fp32 (~127 MB) to int8 (~33 MB) and the second blocker was fixed too (the library caches next to the module, and only the temp directory is writable on serverless, so every cold start downloaded and then failed to cache). Deployed without the proxy, Vercel still returned **503 on every retrieval**. The quantisation was kept because it is strictly better — identical metrics at a quarter the size — but it does **not** make serverless retrieval work. The real fix, if the proxy is ever unacceptable, is a hosted embedding API; Groq has no embeddings endpoint, so that means a new provider and a new credential.

**Railway auto-deploys on push to the linked GitHub branch; Vercel does not** — its GitHub connection was never actually linked (`vercel link`/`git connect` require a one-time dashboard OAuth step), so Vercel deploys only happen via `vercel --prod` run manually from this repo. A `git push` alone updates Railway and GitHub but **not** the live Vercel URL — don't assume otherwise when verifying a change went live. Note also that Railway's `redeploy` re-runs the last build; use `railway up --ci` to build from current source. See `Docs/deployment-plan.md` §9 ("What Actually Happened") for the full list of deploy-time gotchas.

**System prompt** (`lib/systemPrompt.ts`): exports `SYSTEM_PROMPT_RAG` (grounded tier) and `SYSTEM_PROMPT_GENERAL` (general-knowledge tier, added 2026-10-06; same `TOPIC_RESTRICTION`, `OUT_OF_SCOPE` and population framing, no citations, no calorie figures, no named documents). The Milestone 1 ungrounded `SYSTEM_PROMPT`, `generateStructuredAnswer` and `M1ResponseSchema` had no runtime caller and were removed on 2026-10-04. Both are built from shared sections defining the assistant's persona ("Sage"), answer style (concise, ~150 words, no padding/hedging, answer only what was asked — added specifically so repeated identical questions get comparable answers across the 3x eval runs), the claims-decomposition instruction, a `TOPIC_RESTRICTION` limiting answers to food and nutrition, and the same out-of-scope categories as the code-level `scopeGuard` (defense in depth — the prompt is not relied on alone).

See `Docs/embedding-strategy.md` for the embedding contract — model, 384 dimensions, int8 precision, and the bge query/passage asymmetry (a query takes the instruction prefix, a passage does not; getting it backwards is silent quality loss, not an error), plus what forces a full re-embed. See `Docs/chunking-strategy.md` for what gets embedded and `Docs/vector-store.md` for where the vectors live. See `Docs/rag-architecture.md` for the full as-built design (this supersedes the original pre-build plan where the two diverge) and `Docs/deployment-plan.md` for deployment specifics.

# Architecture — AI Nutrition Assistant (Milestone 1)

Derived from [problemStatement.md](problemStatement.md). This document describes the **as-built** system — deployed and verified live on both Vercel and Railway — and the extension points Milestone 2 (retrieval/citations) will plug into. It supersedes the original pre-build design in favor of what the code actually does; where the two diverge, a note explains why.

**Live deployments:**
- Vercel: https://ai-nutrition-assistant-self.vercel.app
- Railway: https://app-production-3fe4f.up.railway.app

Both run the identical Next.js codebase and share one Railway-hosted Postgres database, so a conversation started on one host is visible to the other.

---

## 1. Goals and Constraints Driving the Design

| Constraint (from problem statement) | Architectural consequence |
|---|---|
| Model calls and API keys never in the browser | All LLM calls happen in the `app/api/chat/route.ts` route handler; the frontend only ever calls our own `/api/chat` |
| Every claim needs a `source` field, `null` in M1 | `ClaimSchema.source` is `z.null()` now; M2 widens it to `z.string().url().nullable()` — the field and response shape never change |
| Structured output, schema-validated | Groq's **Structured Outputs** (`response_format: { type: "json_schema", strict: true }`), generated from the same Zod schema used to validate the response afterward |
| Scope restrictions enforced in code, not just prompt | `lib/scopeGuard.ts` runs a regex-based check before *and* after the LLM call, independent of prompt wording |
| Sources panel must exist now, populate later | `SourcesPanel` renders `claims[].source`; present now, shows a "arriving in Milestone 2" placeholder since every source is `null` |
| Fixed 10-question eval set, run 3x per question, rerun after every prompt change | `scripts/evaluate.ts` — a standalone harness (not part of the deployed app) that hits the live `/api/chat` endpoint and writes `Docs/failure-log.md` |
| Public deployment | Deployed to **both** Vercel and Railway simultaneously, sharing one Postgres instance, to validate the app is host-agnostic rather than accidentally coupled to one platform's runtime |

---

## 2. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend + Backend | **Next.js 14 (App Router) + TypeScript** | Single deployable app, API routes co-located with UI, deploys unmodified to both Vercel and a Railway container |
| UI styling | Tailwind CSS | Custom dark theme (`app/globals.css`, `tailwind.config.ts`) for the chat UI + sources panel |
| LLM provider | **Groq API**, model `openai/gpt-oss-120b` by default (`lib/groq.ts`, via `groq-sdk`) | OpenAI-compatible chat completions; fast, low-cost inference. Overridable per-deployment via `GROQ_MODEL` (e.g. `qwen/qwen3-32b`) |
| Structured output mechanism | Groq **Structured Outputs** (`response_format: json_schema`, `strict: true`), *not* forced tool-calling | `gpt-oss` reasoning models intermittently emit chain-of-thought text instead of a clean tool call under forced `tool_choice`, which Groq's tool-call parser then rejects with a 400 `output_parse_failed`. `json_schema` output lands in `message.content` as plain text instead, sidestepping that parser entirely. See [prompt-iteration-log.md](prompt-iteration-log.md). |
| Schema validation | **Zod** (`lib/schema.ts`) | One schema converted via `zod-to-json-schema` into the Groq `json_schema` response format, and reused to validate the parsed response and the incoming API request |
| Database | **Postgres**, accessed via **Prisma ORM** | Required for Vercel (serverless functions have an ephemeral filesystem) and shared with Railway so both deployments see the same conversations |
| Rate limiting | Custom in-memory limiter (`lib/rateLimiter.ts`) | Groq's `openai/gpt-oss-120b` tier caps at 30 req/min, 8,000 tokens/min, 1,000 req/day, 200,000 tokens/day; the limiter self-throttles under those caps, with the SDK's own 429 handling as backstop |
| Eval runner | Standalone Node/TypeScript script (`scripts/evaluate.ts`) | Decoupled from the web app; calls the deployed/local chat API like any client; writes results to the DB and to `Docs/failure-log.md` |
| Scope-guard unit tests | `scripts/test-scope-guard.ts` | Runs `checkRequest` directly (no API, no model) against restricted phrasings and benign counter-examples — fast feedback when tuning the regex patterns |
| Deployment | **Vercel** (serverless) + **Railway** (long-running container) | Deployed to both to prove the app isn't platform-coupled; `npm start` binds `-H 0.0.0.0 -p ${PORT}` specifically so Railway's proxy can reach the container — Vercel's serverless runtime never runs that script at all |
| Source control | GitHub | madhushankar1992-cub |

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Browser (Client)                            │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────┐  ┌───────────┐  │
│  │ Header         │  │ Message List   │  │ Chat Input  │  │ Sources   │  │
│  │ (clear chat)   │  │ (+ EmptyState) │  │             │  │ Panel     │  │
│  └───────┬────────┘  └───────┬────────┘  └──────┬──────┘  └─────▲─────┘  │
│          │                   │                  │               │        │
│          └─────────── ChatWindow (React state, keyed by          │        │
│                        conversationId) ───────────────────────────┘        │
└──────────────────────────────┬─────────────────────────────────────────┘
                                │ POST /api/chat  { conversationId?, message }
                                │ DELETE /api/chat?conversationId=  (clear chat)
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Next.js API Route (Server)                       │
│                     app/api/chat/route.ts                            │
│                                                                        │
│  POST:                                                                │
│  1. Parse + validate request body (Zod)                              │
│  2. Load/create conversation; load prior messages from DB            │
│  3. Scope Guard pre-check (checkRequest) ──► refuse before LLM call   │
│  4. Persist the user's message                                       │
│  5. Call Groq with Structured Outputs (json_schema, strict)          │
│  6. Validate response against Zod; one retry-with-correction on fail │
│  7. Force every claim's source to null (defense in depth)            │
│  8. Scope Guard post-check (checkResponse) ──► catch any leak        │
│  9. Persist assistant message + claims                               │
│  10. Return { conversationId, answer, claims[] }                     │
│                                                                        │
│  DELETE ?conversationId=:                                             │
│  Cascades delete of claims → messages → the conversation itself       │
└───────────────┬────────────────────────────────┬─────────────────────┘
                │                                │
                ▼                                ▼
     ┌─────────────────────┐        ┌───────────────────────────────┐
     │   Groq API             │        │   Postgres (Prisma)             │
     │  openai/gpt-oss-120b,   │        │  Conversation, Message, Claim,  │
     │  json_schema structured │        │  EvalRun, FailureLogEntry       │
     │  output, reasoning_     │        │  (shared by Vercel + Railway)   │
     │  effort: low            │        │                                 │
     └─────────────────────────┘        └───────────────────────────────┘

Offline / dev-time processes (not part of the request path):
┌─────────────────────────────────────────────────────────────────┐
│  scripts/evaluate.ts  (npm run eval)                              │
│  - Loads fixed 10-question dataset (data/eval-questions.json)     │
│  - Calls POST /api/chat 3x per question (fresh conversation each) │
│  - Diffs numeric claims across the 3 runs → numeric_drift          │
│  - Flags any non-null source → broken_source                      │
│  - Flags zero-claim answers on substantive questions → hedging     │
│  - Runs the 8-case scope-abuse suite (direct/rephrased/indirect/   │
│    post-unrelated × numeric-target/medical-advice)                │
│  - Writes EvalRun + FailureLogEntry rows and Docs/failure-log.md   │
│                                                                     │
│  scripts/test-scope-guard.ts  (npm run test:scope)                │
│  - Calls checkRequest() directly — no API, no model call           │
│  - Asserts all restricted phrasings are blocked                    │
│  - Asserts the 10 eval questions + 5 benign counter-examples pass  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Repository Structure

```
AI Chatbot/
├── Docs/
│   ├── problemStatement.md
│   ├── architecture.md              # this file
│   ├── deployment-plan.md
│   ├── edge-cases.md
│   ├── eval.md
│   ├── prompt-iteration-log.md
│   └── failure-log.md               # generated/updated by `npm run eval`
├── app/
│   ├── layout.tsx
│   ├── page.tsx                     # renders <ChatWindow /> only
│   ├── globals.css
│   └── api/
│       └── chat/
│           └── route.ts             # POST + DELETE — the only LLM-calling endpoint
├── components/
│   ├── ChatWindow.tsx                # top-level client component: state, layout, Header/EmptyState/TypingIndicator
│   ├── MessageBubble.tsx             # user/assistant bubble; assistant bubbles are selectable (drives SourcesPanel)
│   ├── ChatInput.tsx                 # auto-resizing textarea + send button, Enter-to-send
│   ├── SourcesPanel.tsx              # right-hand panel (desktop only), claims for the selected message
│   └── icons.tsx                     # inline SVG icon set
├── lib/
│   ├── groq.ts                       # Groq client, structured-output call, retry + backoff
│   ├── schema.ts                     # Zod: ChatRequestSchema, ChatResponseSchema, ClaimSchema
│   ├── systemPrompt.ts               # exported SYSTEM_PROMPT string
│   ├── scopeGuard.ts                 # checkRequest / checkResponse, regex-based
│   ├── rateLimiter.ts                # in-memory token/request budget limiter
│   └── db.ts                         # Prisma client singleton (hot-reload safe)
├── prisma/
│   ├── schema.prisma                 # Conversation, Message, Claim, EvalRun, FailureLogEntry
│   └── migrations/
├── data/
│   └── eval-questions.json           # fixed 10-question dataset
├── scripts/
│   ├── evaluate.ts                   # eval harness (3x per question + scope-abuse suite)
│   └── test-scope-guard.ts           # unit-level scope-guard regression test
├── .env.local.example
└── package.json
```

---

## 5. Frontend Architecture

`app/page.tsx` renders a single client component, `ChatWindow` (`components/ChatWindow.tsx`), which owns all UI state:

- **`conversationId`, `messages`, `selectedId`, `isLoading`, `draft`, `isClearing`** — plain React `useState`, no external state library. `messages` carries each assistant message's `claims[]` inline, so selecting a message is just an id lookup, not a refetch.
- **Header** — title, a "No citations yet" badge, a **clear-chat** button (trash icon, shown once `messages.length > 0`) that calls `DELETE /api/chat?conversationId=` then resets all client state, and a settings icon button (currently a no-op placeholder).
- **EmptyState** — shown when there are no messages yet: a hero mark, framing copy, and five clickable suggested questions (`SUGGESTED_QUESTIONS`) that populate the input draft without auto-sending.
- **Message list** — each assistant `MessageBubble` is a button; clicking it sets `selectedId`, which drives what `SourcesPanel` shows. A small "`N claims`" pill appears on assistant bubbles that have claims. A `TypingIndicator` (three bouncing dots) renders while `isLoading`.
- **ChatInput** — auto-resizing `<textarea>` (capped at 120px), Enter submits / Shift+Enter inserts a newline, send button disabled while empty or `disabled`.
- **SourcesPanel** — fixed 340px right-hand column, **hidden below the `md` breakpoint** (mobile has no sources panel). Shows claims for the currently selected assistant message; each claim with `source === null` renders a dashed placeholder card ("No source yet — arriving in Milestone 2"); the `source !== null` branch (unused in M1, ready for M2) renders a linked source card.

**Request flow (`handleSend`)**: optimistically appends the user message to local state, `POST`s `{ conversationId, message }` to `/api/chat`, and on success appends the assistant message (with its `claims`) and auto-selects it so the Sources panel updates immediately. A network-level failure (not a 4xx/5xx from the API, which still returns the normal JSON shape) is caught and rendered as a local-only apology message.

The client never talks to Groq directly and never sees `GROQ_API_KEY`. Because history is persisted server-side keyed by `conversationId`, a page refresh loses the client's `messages` array (it's not re-fetched on mount in M1) but the conversation itself survives in Postgres and can still be deleted via its id.

---

## 6. Backend Architecture

### 6.1 API Contract

**`POST /api/chat`**

Request:
```json
{
  "conversationId": "uuid | null",
  "message": "string"
}
```

Success response (200):
```json
{
  "conversationId": "uuid",
  "answer": "string",
  "claims": [
    { "text": "string", "source": null }
  ]
}
```

Refused response (200 — same shape, no special error path):
```json
{
  "conversationId": "uuid",
  "answer": "I can't provide calorie/weight targets or medical or condition-specific dietary advice. Please consult a registered dietitian, physician, or other qualified professional for that.",
  "claims": []
}
```

Invalid request body (400): `{ "error": "Invalid request" }`

Schema validation failed after retry (422): a generic apology, logged as `failure_log` category `invalid_schema`.

**`DELETE /api/chat?conversationId=<uuid>`**

Deletes all `Claim` rows for the conversation's messages, then its `Message` rows, then the `Conversation` row itself (explicit cascade in application code, not a DB-level `ON DELETE CASCADE`). Returns `{ "deleted": true, "conversationId": "<uuid>" }`, or 400 if `conversationId` is missing.

This contract is the one piece of the system explicitly frozen for Milestone 2 — retrieval changes only the *contents* of `source`, never the field's presence or the endpoint shape.

### 6.2 Request Handling Pipeline (`app/api/chat/route.ts`)

1. **Validate** the request body against `ChatRequestSchema`; reject with 400 on failure.
2. **Load context** — create a `Conversation` if no `conversationId` was given; load all prior `Message` rows for that conversation, ordered by `createdAt`.
3. **Pre-call scope guard** (`checkRequest`) — run against the last 6 turns of history plus the new message, so a rephrased or indirect follow-up (including one asked after unrelated messages) is still caught. The user's message is persisted to the DB *before* this check runs, so a blocked request still shows up in conversation history.
4. If blocked: log a `failure_log` entry (`missed_refusal_guard_triggered`, including the matched category and text), persist the fixed `REFUSAL_MESSAGE` as the assistant reply, and return immediately — no LLM call is made.
5. **Compose prompt** — `SYSTEM_PROMPT` + up to the last 8 turns of history (`MAX_HISTORY_TURNS`, enforced again inside `lib/groq.ts`) + the new user message.
6. **Call Groq** (`generateStructuredAnswer`) with `response_format: { type: "json_schema", json_schema: { strict: true } }` built from `ChatResponseSchema` via `zod-to-json-schema`. `temperature: 0.2`, `max_tokens: 700`, `reasoning_effort: "low"`, `reasoning_format: "hidden"` (suppresses chain-of-thought from the response content).
7. **Parse + validate** the JSON string in `message.content` against `ChatResponseSchema`. On failure (bad JSON or schema mismatch), retry **once** with an extra user turn explicitly telling the model its previous output didn't match the schema. A second failure propagates as a thrown error.
8. On a thrown error from step 7: log `invalid_schema`, persist a generic apology as the assistant message, return 422.
9. **Force `source: null`** on every claim regardless of what the model returned — defensive, so a prompt-injection or model slip can never leak a fabricated citation in M1.
10. **Post-call scope guard** (`checkResponse`) — regex scan of the generated `answer` for numeric calorie/weight phrasing or imperative medical phrasing that slipped past the prompt. If triggered, discard the answer and substitute `REFUSAL_MESSAGE`; log `missed_refusal` either way (so near-misses the guard *did* catch are still visible in evaluation, not just the ones that got through).
11. **Persist** the assistant message, then bulk-insert its claims (`createMany`) if any.
12. **Respond** with `{ conversationId, answer, claims }`.

### 6.3 Scope Guard Design (`lib/scopeGuard.ts`)

Purely regex/pattern-based in the current implementation (no classifier LLM call, despite earlier design notes floating that option) — three independent pattern sets, each checked in order:

- **`checkRequest(history, newMessage)`** — normalizes `history.slice(-6)` + the new message into one lowercased string and tests it against three pattern groups, returning the first category that matches:
  - `numeric_target` — e.g. "how many calories should i", "calorie target/goal/limit", "how much protein should i eat", "figure out a calorie…"
  - `personal_weight_recommendation` — e.g. "what should i weigh", "am i overweight", "should i lose/gain weight", "is 150 lbs healthy"
  - `medical_advice` — e.g. "i have diabetes", "diagnosed with {condition}", "diet plan for my condition", "blood sugar … what foods"
  - Checking against joined history (not just the latest message) is what catches split-across-turns and "asked again after unrelated messages" cases.
- **`checkResponse(answer)`** — defense-in-depth scan of the model's own output for numeric calorie/weight phrasing (`\d{2,4}\s?(kcal|calories).*per day|daily|target|goal`, "you should eat/consume/aim for about N…") or imperative medical phrasing ("if you have diabetes … you should …"), independent of whether the pre-call check passed.
- Both return `{ allowed, category?, matchedText? }`; every rejection is logged to `FailureLogEntry` with enough detail (category + matched pattern) to group failures by type for evaluation.
- **Tuned against false positives deliberately**: `scripts/test-scope-guard.ts` runs the patterns against 5 benign counter-examples ("How many calories are in a medium banana?", "What is the DASH diet?", etc.) and the 10 real eval questions to make sure tightening the regexes to catch restricted phrasing didn't start blocking legitimate questions that share surface vocabulary.

---

## 7. Data Model (`prisma/schema.prisma`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Conversation {
  id        String    @id @default(uuid())
  createdAt DateTime  @default(now())
  messages  Message[]
}

model Message {
  id             String       @id @default(uuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id])
  role           String       // "user" | "assistant"
  content        String
  createdAt      DateTime     @default(now())
  claims         Claim[]
}

model Claim {
  id        String  @id @default(uuid())
  messageId String
  message   Message @relation(fields: [messageId], references: [id])
  text      String
  source    String? // always null in Milestone 1; populated in Milestone 2
}

model EvalRun {
  id            String   @id @default(uuid())
  runAt         DateTime @default(now())
  promptVersion String   // sha256(SYSTEM_PROMPT).slice(0,10)
  questionId    String   // key into data/eval-questions.json
  attemptNumber Int      // 1..3
  answer        String
  claimsJson    String   // JSON-encoded [{text, source}]; kept as String, not Json, to avoid touching working eval code
}

model FailureLogEntry {
  id         String   @id @default(uuid())
  evalRunId  String?
  runAt      DateTime @default(now())
  category   String   // unsupported_claim | numeric_drift | broken_source |
                       // missed_refusal | missed_refusal_guard_triggered |
                       // unhelpful_hedging | invalid_schema | conversation_continuity_broken
  questionId String?
  detail     String
}
```

Postgres is used for **both** deployments (not SQLite-for-dev/Postgres-for-prod as originally planned) — a local `prisma/dev.db` file exists from early SQLite-based development but the live `schema.prisma` datasource is `postgresql`, driven by `DATABASE_URL`. `promptVersion` on `EvalRun` is what makes "rerun all 10 after every prompt change" comparable over time — failure counts are grouped by `(promptVersion, category)`.

---

## 8. LLM Integration Details

### 8.1 Structured Output Schema (`lib/schema.ts`)

```typescript
export const ClaimSchema = z.object({
  text: z.string().min(1),
  source: z.null(), // literal null type in Milestone 1
});

export const ChatResponseSchema = z.object({
  answer: z.string().min(1),
  claims: z.array(ClaimSchema),
});

export const ChatRequestSchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  message: z.string().min(1),
});
```

`ChatResponseSchema` is converted via `zod-to-json-schema` into the JSON Schema passed as Groq's `response_format.json_schema.schema`, with `strict: true`. This is the actual enforcement mechanism — not forced function/tool-calling, which was the original plan but proved unreliable for this reasoning model (see §2 and [prompt-iteration-log.md](prompt-iteration-log.md)).

### 8.2 System Prompt (`lib/systemPrompt.ts`)

`SYSTEM_PROMPT` is a single exported template string defining:
- **Role** — nutrition/food-safety/cooking Q&A using general knowledge only; explicitly told never to claim it looked anything up (no retrieval exists yet).
- **Answer style** — concise, ~150 words or fewer, no unhelpful hedging without substance, and a specific instruction to answer *only* what was asked without volunteering adjacent detail (pregnancy-specific values, per-bodyweight math, athlete notes) unless asked — added so the same question gets a comparable answer across the 3x eval repeats instead of sometimes including extra material and sometimes not.
- **Claims decomposition** — after writing the answer, break it into discrete checkable claims, each with `source` forced to `null`.
- **Out-of-scope declines** — calorie/macro/weight-loss numeric targets, personal weight recommendations, and condition-specific medical advice, explicitly including rephrased/indirect/multi-turn/re-asked variants — matching the code-level `scopeGuard` so prompt and code agree (defense in depth; the prompt is not relied on alone).

### 8.3 Model Call Wrapper (`lib/groq.ts`)

- Model: `GROQ_MODEL` env var, defaulting to `openai/gpt-oss-120b`.
- Call parameters: `max_tokens: 700` (kept modest specifically to conserve the tokens-per-minute budget, not the model's max), `temperature: 0.2` (low but nonzero — reduces run-to-run drift without hiding it from evaluation), `reasoning_effort: "low"`, `reasoning_format: "hidden"`.
- History sent per call is trimmed to the last `MAX_HISTORY_TURNS` (8) turns, bounding both prompt token growth and the rate-limit budget independent of conversation length.
- **Two distinct retry paths, not conflated**:
  - *Schema-validation retry* (`generateStructuredAnswer`): on a `SchemaValidationError` (bad JSON or a schema mismatch), retries once with an explicit correction message appended to history. A second failure propagates to the route handler as a 422.
  - *Transport retry* (`callOnce`): on `Groq.RateLimitError` (honors the `Retry-After` header, falling back to `2000ms * attempt`) or `Groq.InternalServerError` / `Groq.APIConnectionError` (`1000ms * attempt` backoff), retries up to `MAX_TRANSPORT_RETRIES` (3) times before giving up.
- `GROQ_API_KEY` is read server-side only via `process.env`, never exposed with a `NEXT_PUBLIC_` prefix.

### 8.4 Rate Limiting (`lib/rateLimiter.ts`)

Groq's `openai/gpt-oss-120b` tier is capped at 30 req/min, 8,000 tokens/min, 1,000 req/day, 200,000 tokens/day — tokens/min is the binding constraint once prompt + completion tokens are counted. Before each call, `callOnce` estimates token cost (`estimateTokens`: `~text.length / 4`, a conservative heuristic, not exact billing) and calls `groqRateLimiter.reserve(estimatedTokens)`, which:
- Throws immediately if the **daily** budget (1,000 requests or 200,000 tokens, tracked against UTC midnight) is already spent — not worth a silent day-long wait.
- Otherwise blocks in a rolling 60s window, targeting a safety margin under the stated caps (25 req/min, 7,000 tokens/min) rather than the limit itself.
- Is a process-local singleton (`globalThis`-cached, same hot-reload-safe pattern as `lib/db.ts`). This is **best-effort only**: it holds within one running process (dev server, or one warm serverless instance) but does **not** coordinate across multiple concurrent serverless instances or survive a process restart — the authoritative backstop is the SDK's own `RateLimitError` (429) handling in `lib/groq.ts`, which reacts to Groq's actual response regardless of what the local limiter believes. See [edge-cases.md](edge-cases.md).

---

## 9. Evaluation & Testing

### 9.1 `scripts/evaluate.ts` (`npm run eval`)

- Requires the target app already running (`EVAL_BASE_URL`, default `http://localhost:3000`); exits early with a clear message if unreachable.
- Computes `promptVersion = sha256(SYSTEM_PROMPT).slice(0, 10)` so results are comparable across prompt iterations.
- For each of the 10 fixed questions (`data/eval-questions.json`): calls `/api/chat` 3 times, each in a **fresh conversation** (isolates model variance from context effects), stores each attempt as an `EvalRun` row.
  - `numeric_drift`: compares the *set* of numbers (parsed as floats, so `"70"` and `"70.0"` are equal) mentioned across claims between the 3 attempts.
  - `broken_source`: any claim with a non-null `source` — should never happen in M1; a hit indicates a code regression, not a model issue.
  - `unhelpful_hedging`: an attempt producing zero claims for a question not categorized `no_clear_answer`.
- Separately runs an **8-case scope-abuse suite** — `numeric_target` and `medical_advice`, each in `direct` / `rephrased` / `indirect` / `post_unrelated` variants — asserting an **exact match** against `REFUSAL_MESSAGE` with zero claims (intentionally strict, since every case is expected to be caught by the code-level guard, not a model ad-lib decline). `post_unrelated` cases also assert both turns returned the same `conversationId`, i.e. that the test is actually exercising cross-turn memory and not accidentally starting a new conversation each turn.
- Writes/updates `Docs/failure-log.md` (grouped, counted by category) and inserts corresponding `FailureLogEntry` rows.

### 9.2 `scripts/test-scope-guard.ts` (`npm run test:scope`)

Unit-level, no API or model calls — calls `checkRequest` directly against:
- The same 12 restricted phrasings used in the eval harness's scope suite (must all be blocked).
- The 10 real eval-dataset questions (must all be allowed — a false positive here means a legitimate question would be silently refused in production).
- 5 benign counter-examples chosen to share surface vocabulary with the restricted patterns ("How many calories are in a medium banana?", "Is 150 lbs a normal weight for a golden retriever?", etc.) — guards against over-broadening a regex while tuning it against the restricted set alone.

Exits non-zero on any failure, making it suitable as a fast pre-commit/CI gate ahead of the slower, model-calling `npm run eval`.

---

## 10. Environment & Secrets

`.env.local` (never committed; `.env.local.example` documents keys):
```
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b
DATABASE_URL="postgresql://user:password@host:5432/dbname"
```

All three are server-only; Next.js API routes and `scripts/evaluate.ts` read them via `process.env`, never exposed to the client bundle (no `NEXT_PUBLIC_` prefix). The same three are set as project environment variables independently on both Vercel and Railway, pointed at the same Railway-hosted Postgres instance.

---

## 11. Deployment

Deployed to **both** platforms simultaneously from the same GitHub repository — not an either/or choice — specifically to prove the app has no platform-specific coupling:

- **Vercel** — zero-config Next.js hosting, auto-deploy on push. Runs as serverless functions; `npm start` is never invoked. `GROQ_API_KEY`, `GROQ_MODEL`, `DATABASE_URL` set as Vercel project env vars.
- **Railway** — runs the app as a long-running container via `npm start`, which resolves to `next start -H 0.0.0.0 -p ${PORT:-3000}`. The explicit host/port bind is required for Railway's proxy to reach the container; this script path is irrelevant to Vercel's serverless runtime.
- **Shared Postgres** — provisioned on Railway; both deployments' `DATABASE_URL` points at the same instance, so a conversation is visible and deletable from either host.
- `prisma generate` runs automatically via the `postinstall` hook on both platforms as part of `npm install`; migrations live in `prisma/migrations/` (`20260926000000_init`).
- `scripts/evaluate.ts` and `scripts/test-scope-guard.ts` are dev-time tools, run manually against either `localhost` or a deployed URL (`EVAL_BASE_URL`) — neither is part of the deployed app bundle.
- See [deployment-plan.md](deployment-plan.md) for the full setup walkthrough.

**Verified live** (2026-10-01): both `/` (frontend) and `POST /api/chat` (backend) return HTTP 200 on both hosts; the scope guard correctly refuses an out-of-scope/injection prompt on both; `DELETE /api/chat` successfully removes a conversation from the shared database.

---

## 12. Milestone 2 Extension Points (by design, not by rework)

| Extension point | M1 state | M2 change |
|---|---|---|
| `ClaimSchema.source` | `z.null()` | `z.string().url().nullable()` — widen the type, no field rename |
| `SourcesPanel` component | Renders empty/placeholder branch only | Same component, same `claim.source !== null` branch (already written, just unreachable in M1) renders populated links — no new component needed |
| API response shape | `{conversationId, answer, claims[]}` | Unchanged |
| Backend pipeline | Steps 1–12 in §6.2 | Insert a retrieval step between "compose prompt" and "call Groq" (fetch supporting passages, inject into context) and pass real citations through to `source` instead of forcing `null` |
| Eval harness | `broken_source` check expects *zero* non-null sources | Flips to expecting sources present and valid; `numeric_drift`/`unhelpful_hedging` checks carry over unchanged |

This is the concrete mechanism behind the problem statement's requirement to "preserve the interface, endpoints and response structure" — every M1 component is designed as the identity case of its M2 counterpart, not a stand-in to be replaced.

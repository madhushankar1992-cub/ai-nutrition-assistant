# Architecture — AI Nutrition Assistant (Milestone 1)

Derived from [problemStatement.md](problemStatement.md). This document defines the technical design for the no-retrieval prototype and the extension points Milestone 2 (retrieval/citations) will plug into.

---

## 1. Goals and Constraints Driving the Design

| Constraint (from problem statement) | Architectural consequence |
|---|---|
| Model calls and API keys never in the browser | All LLM calls happen in backend route handlers; frontend only talks to our own API |
| Every claim needs a `source` field, `null` in M1 | Response schema is fixed now and never changes shape in M2 — only `source` values start being populated |
| Structured-output mode, schema-validated | Use the provider's tool-use / structured-output feature; validate with a shared schema (Zod) on both the LLM boundary and the API boundary |
| Scope restrictions enforced in code, not just prompt | A backend guardrail module runs before *and* after the LLM call, independent of prompt wording |
| Sources panel must exist now, populate later | Frontend renders `claims[].source`; panel is present but empty since all sources are `null` |
| Fixed 10-question eval set, run 3x per question, rerun after every prompt change | A standalone eval script (not part of the web app) that hits the same chat API and writes a structured failure log |
| Public deployment (Vercel/Railway) | Stateless serverless-friendly backend; DB must be reachable from serverless functions (rules out plain local SQLite file in prod) |

---

## 2. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend + Backend | **Next.js 14 (App Router) + TypeScript** | Single deployable app, API routes co-located with UI, first-class Vercel support, matches suggested tools |
| UI styling | Tailwind CSS | Fast to build chat UI + sources panel without extra deps |
| LLM provider | **Anthropic API (Claude)**, via `@anthropic-ai/sdk` | Native structured output via tool-use forcing (`tool_choice: {type: "tool"}`), matches suggested tools |
| Schema validation | **Zod** | One schema shared by: Anthropic tool definition (JSON schema), API response validation, frontend types (`z.infer`) |
| Database | **Postgres** (Supabase or Neon), accessed via **Prisma ORM** | Suggested tools list SQLite/Postgres/Supabase; Postgres is chosen over file-based SQLite because Vercel's serverless functions have an ephemeral filesystem — SQLite would lose data between invocations. Prisma keeps the option to point at SQLite for local dev via a different `DATABASE_URL`. |
| Eval runner | Standalone Node/TypeScript script (`scripts/evaluate.ts`) | Decoupled from the web app; calls the deployed/local chat API like any client; writes results to the DB and to a human-readable Markdown log |
| Deployment | **Vercel** | Zero-config Next.js hosting; env vars for API keys and `DATABASE_URL` |
| Source control | GitHub | Required deliverable |

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          Browser (Client)                       │
│  ┌───────────────┐   ┌────────────────┐   ┌──────────────────┐  │
│  │ Message List  │   │  Input Box     │   │  Sources Panel    │  │
│  │ (chat history)│   │ (send question)│   │ (empty in M1)     │  │
│  └───────┬───────┘   └───────┬────────┘   └─────────▲─────────┘  │
│          │                   │                       │           │
│          └─────────► React state / SWR fetch ────────┘           │
└──────────────────────────────┬────────────────────────────────────┘
                                │ POST /api/chat  { conversationId?, message }
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Next.js API Route (Server)                   │
│                                                                    │
│  1. Load/create conversation + history from DB                   │
│  2. Scope Guard (pre-check) ──► reject/refuse before LLM call     │
│  3. Build messages: system prompt + history + new user message   │
│  4. Call Anthropic API with forced tool-use JSON schema           │
│  5. Validate response against Zod schema                          │
│  6. Scope Guard (post-check) ──► verify no leaked disallowed advice│
│  7. Persist user message + assistant response + claims to DB      │
│  8. Return validated { answer, claims[] } to client                │
└───────────────┬───────────────────────────────┬──────────────────┘
                │                               │
                ▼                               ▼
     ┌─────────────────────┐        ┌───────────────────────────┐
     │   Anthropic API      │        │   Postgres (Prisma)        │
     │  (Claude, tool-use)  │        │  conversations, messages,  │
     │                       │        │  claims, eval_runs,        │
     │                       │        │  failure_log                │
     └───────────────────────┘        └───────────────────────────┘

Offline / CI process (not part of request path):
┌─────────────────────────────────────────────────────────────────┐
│  scripts/evaluate.ts                                              │
│  - Loads fixed 10-question dataset (data/eval-questions.json)     │
│  - Calls POST /api/chat 3x per question                           │
│  - Diffs numeric/factual claims across the 3 runs                 │
│  - Runs scope-abuse test cases (calorie/weight/medical, rephrased) │
│  - Writes results to eval_runs + failure_log tables and to         │
│    Docs/failure-log.md                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Repository Structure

```
AI Chatbot/
├── Docs/
│   ├── problemStatement.md
│   ├── architecture.md
│   └── failure-log.md              # generated/updated by eval runs
├── app/
│   ├── layout.tsx
│   ├── page.tsx                    # chat UI: message list + input + sources panel
│   └── api/
│       └── chat/
│           └── route.ts            # POST handler: the only LLM-calling endpoint
├── components/
│   ├── ChatWindow.tsx
│   ├── MessageBubble.tsx
│   ├── ChatInput.tsx
│   └── SourcesPanel.tsx
├── lib/
│   ├── anthropic.ts                # thin client wrapper, model config, retries
│   ├── schema.ts                   # Zod schema: ChatResponse, Claim
│   ├── systemPrompt.ts             # exported system prompt string/template
│   ├── scopeGuard.ts               # pre- and post-call scope enforcement
│   └── db.ts                       # Prisma client singleton
├── prisma/
│   └── schema.prisma               # Conversation, Message, Claim, EvalRun, FailureLogEntry
├── data/
│   └── eval-questions.json         # fixed 10-question dataset
├── scripts/
│   └── evaluate.ts                 # eval harness (3x per question + scope tests)
├── .env.local.example
└── package.json
```

---

## 5. Frontend Architecture

**Page (`app/page.tsx`)** is a single-conversation chat view composed of three regions matching the problem statement's layout requirement:

- **Message list** — renders `role: "user" | "assistant"` messages in order. Assistant messages render `answer` text; on hover/expand, the underlying `claims[]` are viewable (for evaluation/debugging, not required to be pretty in M1).
- **Input box** — controlled input + submit button; disabled while a request is in flight; appends the optimistic user message immediately.
- **Sources panel** — a fixed side panel that lists `claims` for the *currently selected* assistant message. In M1 every `source` is `null`, so it renders a placeholder state ("No sources yet — Milestone 2 will add citations") rather than being removed. This guarantees the M2 diff is additive only (fill the panel), never structural.

State is held client-side (React `useState`/`useReducer`) keyed by `conversationId`; the client never talks to Anthropic directly and never sees an API key. Conversation history is re-fetched from the backend on load so refreshing the page preserves history (stored server-side, not just in browser state).

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

Response (200):
```json
{
  "conversationId": "uuid",
  "answer": "string",
  "claims": [
    { "text": "string", "source": null }
  ]
}
```

Response (200, refused — same shape, no special error path so the frontend doesn't need branch logic):
```json
{
  "conversationId": "uuid",
  "answer": "I can't provide a calorie or weight target. Please consult a registered dietitian or physician.",
  "claims": []
}
```

Response (422 — schema validation failed after retry): a generic apology message, logged as a `failure_log` entry with type `invalid_schema`.

This contract is the one piece of the system explicitly frozen for Milestone 2 — the retrieval layer changes only the *contents* of `source`, never the field's presence or the endpoint shape.

### 6.2 Request Handling Pipeline (`app/api/chat/route.ts`)

1. **Load context** — fetch or create the `Conversation`, load prior `Message` rows for history.
2. **Pre-call scope guard** (`lib/scopeGuard.ts`, `checkRequest`) — pattern/intent-based check on the *new user message*, run against the full conversation context (so a rephrased or indirect follow-up after unrelated messages is still caught). If flagged, skip the LLM call entirely and return the fixed refusal template. This is the code-level enforcement the spec requires independent of the system prompt.
3. **Compose prompt** — system prompt (`lib/systemPrompt.ts`) + trailing window of prior messages + new user message.
4. **Call Anthropic** with structured output enforced via tool-use (`tool_choice: {type: "tool", name: "submit_answer"}`), where the tool's `input_schema` is generated from the Zod schema. This makes free-text drift structurally impossible — the model must return the `{answer, claims[]}` shape.
5. **Schema validation** (`lib/schema.ts`, `ChatResponseSchema.parse`) — if it fails, retry the call once with an explicit correction instruction; if it fails again, return the 422 failure path and log it.
6. **Force `source: null`** — even though the schema/tool definition instructs the model to always emit `null`, the code defensively overwrites any non-null `source` value before persisting/returning, so a prompt-injection or model slip can't leak a fabricated citation in M1.
7. **Post-call scope guard** (`checkResponse`) — scans the generated `answer` for disallowed content (numeric calorie/weight targets, condition-specific medical directives) that may have slipped through despite the prompt; if detected, discard the answer and substitute the refusal template. Logged as a `failure_log` entry (`type: missed_refusal`) either way, so these are visible in evaluation even when the guard successfully catches them.
8. **Persist** — write the user message, assistant message, and claims to Postgres.
9. **Respond** with the validated payload.

### 6.3 Scope Guard Design (`lib/scopeGuard.ts`)

Two independent, composable checks — deliberately not just prompt text:

- `checkRequest(history, newMessage)`:
  - Intent categories: *numeric target request* (calorie/weight/macro goals), *personal recommendation* ("what should I weigh"), *medical/condition-specific advice* ("I have diabetes, what should I eat").
  - Runs against a normalized view of `history + newMessage` so a request split across turns ("asking indirectly," "after unrelated messages") is still detected — e.g., checks the last N turns for topic continuity, not just the latest message in isolation.
  - Implementation starts as a rule/keyword + lightweight classifier prompt (a cheap, separate small LLM call or regex set) — kept in its own module so it can be swapped for a more robust classifier without touching route logic.
- `checkResponse(answer)`:
  - Regex/heuristic scan for numeric patterns tied to calorie/weight/macro phrasing, and for imperative medical phrasing, even if the request guard passed.
- Both checks return a structured `{ allowed: boolean, reason?: string }`, and every rejection is logged with enough detail (category, matched pattern, conversation id) to feed the failure-type grouping required in Section 6 of the problem statement.

---

## 7. Data Model (`prisma/schema.prisma`)

```prisma
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
  content        String       // user text, or assistant answer text
  createdAt      DateTime     @default(now())
  claims         Claim[]
}

model Claim {
  id        String   @id @default(uuid())
  messageId String
  message   Message  @relation(fields: [messageId], references: [id])
  text      String
  source    String?  // always null in Milestone 1; populated in Milestone 2
}

model EvalRun {
  id            String   @id @default(uuid())
  runAt         DateTime @default(now())
  promptVersion String   // hash/label of systemPrompt.ts at run time
  questionId    String   // key into data/eval-questions.json
  attemptNumber Int      // 1..3
  answer        String
  claimsJson    Json
}

model FailureLogEntry {
  id          String   @id @default(uuid())
  evalRunId   String?
  runAt       DateTime @default(now())
  category    String   // unsupported_claim | numeric_drift | broken_source |
                         // missed_refusal | unhelpful_hedging | invalid_schema
  questionId  String?
  detail      String
}
```

`promptVersion` on `EvalRun` is what makes "rerun all 10 after every prompt change" comparable over time — failure counts are always grouped by `(promptVersion, category)`.

---

## 8. LLM Integration Details

### 8.1 Structured Output Schema (`lib/schema.ts`)

```typescript
export const ClaimSchema = z.object({
  text: z.string(),
  source: z.null(), // literal null type in Milestone 1
});

export const ChatResponseSchema = z.object({
  answer: z.string(),
  claims: z.array(ClaimSchema),
});
```

This same object is converted to a JSON schema and passed as the Anthropic tool's `input_schema`, so the model is structurally forced to emit `source: null` rather than merely instructed to.

### 8.2 System Prompt (`lib/systemPrompt.ts`)

Defines, per Section 3 of the problem statement:
- **Role**: nutrition/food-safety/cooking Q&A assistant, general-knowledge only (no retrieval yet).
- **Answering style**: concise, structured, plain language, no hedging filler ("it depends" without substance counts as a failure mode to avoid).
- **Length**: short paragraph or bullet answer, capped guidance (e.g., ~150 words) to keep answers scannable and comparable across the 3x repeat-runs.
- **Claims extraction instruction**: explicitly decompose the answer into discrete factual claims, one per list item, each mapped to `source: null`.
- **Excluded topics**: calorie/weight targets, personal weight recommendations, medical/condition-specific diet advice — with an instruction to refuse and refer to a qualified professional, matching the code-level `scopeGuard` so prompt and code agree (defense in depth, not a substitute for the code check).

### 8.3 Model Call Wrapper (`lib/anthropic.ts`)

- Single place holding model name, `max_tokens`, `temperature` (kept low/deterministic to reduce run-to-run numeric drift, though drift is still measured, not assumed away), and retry-on-invalid-schema logic.
- Reads `ANTHROPIC_API_KEY` from server-only env var — never exposed via `NEXT_PUBLIC_*`.

---

## 9. Evaluation Harness (`scripts/evaluate.ts`)

- Loads `data/eval-questions.json` — the fixed 10 questions (nutrient requirements, food safety/storage, cooking methods, ambiguous/no-clear-answer), each with a stable `id`.
- For each question: calls `POST /api/chat` 3 times (fresh conversation each time, to isolate model variance from context effects), storing each attempt as an `EvalRun` row.
- Diffs the 3 attempts per question: flags numeric claims whose values differ, flags claims judged unsupported (heuristic + manual review pass), flags any non-null `source` (should never occur — indicates a code regression), flags refusals that should have fired but didn't and vice versa.
- Separately runs the **scope-abuse suite**: direct, rephrased, indirect, and post-unrelated-message variants of the calorie-target and condition-specific-diet requests, asserting a refusal every time; any pass-through is logged as `missed_refusal`.
- Writes/updates `Docs/failure-log.md` — a grouped, counted summary by category and by `promptVersion` — and inserts corresponding `FailureLogEntry` rows for structured querying.

---

## 10. Environment & Secrets

`.env.local` (never committed; `.env.local.example` documents keys):
```
ANTHROPIC_API_KEY=
DATABASE_URL=          # Postgres connection string (Supabase/Neon/etc.)
```

Both are server-only; Next.js API routes and `scripts/evaluate.ts` read them via `process.env`, never exposed to the client bundle (no `NEXT_PUBLIC_` prefix).

---

## 11. Deployment

- **Vercel** hosts the Next.js app directly from GitHub (auto-deploy on push to `main`).
- Postgres provisioned via Supabase (or Neon), `DATABASE_URL` set as a Vercel project env var; `prisma migrate deploy` run as part of the build step.
- `ANTHROPIC_API_KEY` set as a Vercel encrypted env var.
- `scripts/evaluate.ts` is run manually/CI-side against either `localhost` or the deployed URL — it is a dev tool, not part of the deployed app bundle.

---

## 12. Milestone 2 Extension Points (by design, not by rework)

| Extension point | M1 state | M2 change |
|---|---|---|
| `ClaimSchema.source` | `z.null()` | `z.string().url().nullable()` — widen the type, no field rename |
| `SourcesPanel` component | Renders empty/placeholder | Same component renders populated `source` links — no new component needed |
| API response shape | `{answer, claims[]}` | Unchanged |
| Backend pipeline | Steps 1–9 in §6.2 | Insert a retrieval step between "compose prompt" and "call Anthropic" (fetch supporting passages, inject into context) and pass real citations through to `source` instead of forcing `null` |
| Eval harness | Compares runs against each other | Same 10 questions rerun, diffed against the stored M1 `FailureLogEntry` baseline to quantify improvement |

This is the concrete mechanism behind the problem statement's requirement to "preserve the interface, endpoints and response structure" — every M1 component is designed as the identity case of its M2 counterpart, not a stand-in to be replaced.

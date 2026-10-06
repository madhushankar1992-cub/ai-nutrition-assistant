# Deployment Plan (v2)

Target topology: **frontend on Vercel · backend on Render · scheduler on GitHub Actions · data in Postgres + pgvector**.

This supersedes the Milestone 1 Vercel+Railway setup described in [deployment-plan.md](deployment-plan.md). That document stays as the record of what was originally built.

---

## 0. Current deployment state (2026-10-06)

The backend went to **Railway, not Render**. Everything else in the target topology below held: a long-running container for `/api/chat`, the UI on Vercel, the scheduler on GitHub Actions, one Postgres + pgvector database. Read "Render" in §§1–9 as "the backend container host"; the reasoning is unchanged.

| Component | Where | State |
|---|---|---|
| Frontend | Vercel — https://ai-nutrition-assistant-self.vercel.app | Serves the UI. `BACKEND_API_URL` is set, so `/api/chat` is **forwarded by the route handler** to Railway (a `next.config.js` rewrite was tried first and did nothing: filesystem routes win over rewrites). Deployed manually with `npx vercel deploy --prod --yes --scope mad-6a83`; the GitHub connection was never linked, so a push does not update Vercel |
| Backend | Railway — https://app-production-3fe4f.up.railway.app/api/chat | Runs retrieval (bge-small, int8, loaded once in the container) and both Groq tiers. Built with Railpack. On 2026-10-07 the service had no linked repository (`source.repo: null`), so a push alone does not deploy it; `npx --yes @railway/cli@latest up --ci --service app` uploads and builds current source |
| Database | Railway Postgres + pgvector | Shared by both hosts and the scheduler. 7 documents · 226 chunks · 226 embedded · config `b63742d51a` · HNSW cosine index on `vector(384)` |
| Scheduler | GitHub Actions `corpus-ingest.yml`, 09:15 IST daily | Recent runs succeed. The 6 Oct 09:15 IST run failed on a transient who.int glitch; a manual re-run succeeded and issue #1 is closed |
| Source | https://github.com/madhushankar1992-cub/ai-nutrition-assistant | Public. Secret scanning and push protection on; a local pre-commit hook also blocks Groq keys |

**Answering (since 2026-10-06):** grounded and cited when the 7 documents cover the question; otherwise a labelled general-knowledge answer with no citations; personal targets, medical advice and off-topic requests refused. Every response carries `answerMode: grounded | general | refused`.

**Health check:** `GET /api/chat` on either host should return status ok, 7 documents, 226 chunks, 226 embedded, and `groqConfigured: true`. On Vercel the GET is forwarded too, so it reports the container's view.

**Why not Render, and why not all-Vercel.** Railway already held the database and the Milestone 1 deployment, so it took the container role. All-Vercel was tried and measured: even with int8 weights (~33 MB) and a writable cache directory, serverless retrieval returned 503 on every request. The fix if the proxy is ever unacceptable is a hosted embedding API, which means a new provider and credential. See `CLAUDE.md` and [deployment-plan.md](deployment-plan.md) §9.

---

## 1. Topology

```
            ┌────────────────────────┐
            │  GitHub Actions        │   03:45 UTC daily (09:15 IST)
            │  corpus-ingest.yml     │
            └───────────┬────────────┘
                        │ scrape → chunk → embed (bge-small, local)
                        │ writes vectors over the network
                        ▼
  ┌──────────────┐   ┌─────────────────────────────┐   ┌──────────────┐
  │   Vercel     │   │  Postgres + pgvector        │   │   Render     │
  │  frontend    │──▶│  Conversation / Message /   │◀──│  backend     │
  │  (Next.js UI)│   │  Claim / Document / Chunk   │   │  (/api/chat) │
  └──────────────┘   └─────────────────────────────┘   └──────┬───────┘
                                                              │
                                                              ▼
                                                        ┌──────────┐
                                                        │   Groq   │
                                                        └──────────┘
```

**One database is the integration point.** The scheduler writes vectors into it; the backend reads them. Nothing is passed as a GitHub artifact — see §6.

---

## 2. Why this split

| Component | Host | Reason |
|---|---|---|
| Frontend | **Vercel** | Purpose-built for Next.js; CDN-served static shell |
| Backend | **Render** | A long-running container, not serverless. Matters because the request path may load the bge ONNX model for query embedding, which is slow to cold-start and pointless to re-initialise per invocation |
| Scheduler | **GitHub Actions** | Free, versioned with the code, and runs even when both hosts are idle. No always-on worker needed |
| Vectors | **Postgres + pgvector** | No third provider. Chroma Cloud was tried and removed after an outage took ingest down with it |

**The key constraint driving backend-on-Render:** embedding a query in-process needs a warm model. Serverless cold starts would pay the ~10s model-load cost repeatedly. A container pays it once.

---

## 3. One codebase, two deploy targets

This is a single Next.js app, so the "frontend" and "backend" are the same repository. The split is about **which host serves which route**:

- **Vercel** serves `/` (the UI). Set `NEXT_PUBLIC_API_BASE_URL` to the Render URL so the browser calls Render for `/api/chat`.
- **Render** serves `/api/chat`. It runs the same image; the UI it also serves simply goes unused.

> **Decide this explicitly.** If you would rather keep it simple, deploy the whole app to **Render only** and point a Vercel rewrite at it, or keep everything on Vercel. Splitting the UI from the API means CORS and an extra env var, and buys a warm model. Do not split by habit.

---

## 4. Environment variables

| Variable | Vercel | Render | GitHub Actions | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | ✅ | ✅ | ✅ (secret) | Same instance everywhere. **The only secret the scheduler needs** |
| `GROQ_API_KEY` | — | ✅ | — | Backend only. Never `NEXT_PUBLIC_` |
| `GROQ_MODEL` | — | ✅ | — | Defaults to `openai/gpt-oss-120b` |
| `NEXT_PUBLIC_API_BASE_URL` | ✅ | — | — | Render's URL, only if the UI is split off. *(Not used as built: the browser always calls same-origin `/api/chat`, so there is no CORS.)* |
| `BACKEND_API_URL` | ✅ | — (must be blank) | — | **As built.** The Railway backend URL. When set, the route handler forwards every `/api/chat` request there, passing `cookie` through and returning `set-cookie` |
| `SESSION_SECRET` | — | ✅ | — | **As built.** Signs the `nk_owner` conversation-ownership cookie; falls back to `DATABASE_URL` if unset |

No embedding credential and no vector-store credential: bge-small runs locally and vectors live in the same Postgres.

---

## 5. Deployment order

Order matters because all three read one database.

1. **Database first.** Provision Postgres, then `npx prisma migrate deploy`. `ensureVectorSchema()` creates the extension, vector column and HNSW index on first ingest, so nothing manual is needed.
2. **Ingest.** Run `npm run ingest` once (locally or via `workflow_dispatch`) so the corpus exists before anything serves traffic.
3. **Backend to Render.**
   - Build: `npm ci && npx prisma generate && npm run build`
   - Start: `npm start`
   - Health check: `GET /api/chat` — returns 200 with API, database and corpus status, or 503 if the corpus is unreachable
4. **Frontend to Vercel.** `vercel --prod`. **Vercel does not auto-deploy on push** unless its GitHub app is linked, so verify the live URL rather than assuming.
5. **Scheduler.** Add `DATABASE_URL` as a repository secret; trigger `workflow_dispatch` once to confirm before relying on the cron.

### Migrations must be additive

While one host runs new code and the other still runs old code against the **same** database, only additive migrations are safe: new tables, new nullable columns. Drop a column in a later release, once both hosts are current.

---

## 6. How scheduler data reaches the backend

Worth stating plainly, because GitHub artifacts are a natural but wrong assumption.

| Output | Destination | Backend can read it? |
|---|---|---|
| Chunks, vectors, provenance | **Postgres / pgvector** | **Yes** — the shared database |
| `corpus-watch-report.md` | GitHub Actions artifact | **No** — Actions UI/API only |

The runner writes vectors directly to Postgres with the `DATABASE_URL` secret. The artifact is a human-readable log and nothing depends on it.

**Requirement:** Postgres must accept connections from the GitHub runner. Railway's public proxy and Render's external connection string both satisfy this; a VPC-only database would not.

---

## 7. Verification checklist

After deploying, confirm each — do not infer any of them from a successful build:

- [ ] Frontend loads and renders the chat UI
- [ ] `POST /api/chat` with an in-scope question returns an answer with claims
- [ ] A food question the corpus does not cover ("what is jollof rice?") returns `answerMode: "general"`, no claims, and the UI badge
- [ ] An off-topic question ("who won the World Cup") is refused
- [ ] A calorie-target request is refused with a professional referral
- [ ] Two browser tabs hold independent conversations
- [ ] `SELECT COUNT(*) FROM "Chunk" WHERE embedding IS NOT NULL` returns the expected count (currently **226**; 232 when this plan was written)
- [ ] `workflow_dispatch` on the ingest workflow completes green
- [ ] A deliberately broken `expectYearIn` makes ingest **abort** rather than ingest the wrong edition

---

## 8. Rollback

| Failure | Action |
|---|---|
| Bad backend deploy | Render → Rollback to the previous deploy (as built: Railway → redeploy the previous deployment) |
| Bad frontend deploy | Vercel → Promote the previous deployment |
| Bad ingest (wrong chunks) | Change the chunk config, re-run ingest. Stale `configHash` rows are deleted automatically |
| Corpus poisoned by a bad document | Set `enabled: false` in `lib/corpus/sources.ts`, re-run ingest |

**Rolling back code does not roll back data.** A bad ingest must be fixed by re-ingesting, because the vectors outlive the deployment that wrote them.

---

## 9. Costs

| Service | Tier | Note |
|---|---|---|
| Vercel | Hobby | Free |
| Render | Starter | Free tier sleeps on idle — first request after sleep is slow. Paid avoids this |
| Postgres | Railway / Render | Watch the storage limit; 226 chunks × 384 floats is small |
| GitHub Actions | Free | ~3 min/day |
| Groq | Free tier | **The real constraint:** 8,000 tokens/min. RAG context makes each request ~4,200–5,200 tokens, so roughly 1–1.5 requests/minute |

Groq's token ceiling, not hosting cost, is what limits throughput. See [rag-architecture.md](rag-architecture.md) §42.

---

## Local stack (Docker) — verified 4 October 2026

Production does not use Docker: Railway builds with Railpack and Vercel builds
Next.js natively. The Docker setup exists so the whole system can run on one
machine.

| File | Purpose |
|---|---|
| `Dockerfile.dev` | App image (Debian, Node 20). **Not** named `Dockerfile`: Railway auto-builds any root-level `Dockerfile` instead of Railpack, which broke a production deploy on 4 October |
| `docker-compose.yml` | `db` (pgvector/pg16, host port 5433), `app` (port 3000), and an `ingest` service behind the `ingest` profile |
| `.dockerignore` | Keeps every `.env*` file out of the image |

```bash
docker compose up --build -d                       # start db + app
docker compose --profile ingest run --rm ingest    # first run: load the corpus
docker compose down                                # stop (keeps data and model cache)
```

**Test run on 4 October 2026** (Docker Desktop 4.93.0, WSL 2):

| Check | Result |
|---|---|
| Image build and start | Both containers up; database healthy |
| Migrations on an empty database | All 5 applied cleanly — the first from-scratch proof of the migration chain |
| Health before ingest | 0 documents — confirms the app was on the local database, not production |
| Ingest inside Docker | 7 documents · 226 chunks · 226 embedded · 0 warnings · 0 errors (matches production) |
| Grounded question | Cited answer (Food Standards Agency, 48 hours) in 4.7 s |
| Calorie question | Refused, 0 claims |
| Container `DATABASE_URL` | `db:5432` (local); `BACKEND_API_URL` blank |
| Production database | Identical before and after: 7 documents, 226 chunks, 0 conversations, same last refresh time |

**Safety:** `.env.local` holds the production `DATABASE_URL`. Compose reads it only
for the Groq key and overrides `DATABASE_URL` on every service. Never remove those
overrides.

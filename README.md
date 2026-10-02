# AI Nutrition Assistant (Milestone 1)

**Live:** [Vercel](https://ai-nutrition-assistant-self.vercel.app) · [Railway](https://app-production-3fe4f.up.railway.app) — both share the same Railway-hosted Postgres database.

See [Docs/problemStatement.md](Docs/problemStatement.md) for the requirements and [Docs/rag-architecture.md](Docs/rag-architecture.md) for the technical design.

## Setup

```bash
npm install
cp .env.local.example .env.local   # fill in GROQ_API_KEY and DATABASE_URL
npm run prisma:migrate
npm run dev
```

Open http://localhost:3000.

## Running the evaluation harness

With the dev server running:

```bash
npm run eval
```

This runs the fixed 10-question dataset (`data/eval-questions.json`) three times each, plus the scope-abuse test suite, and writes results to `Docs/failure-log.md`.

## Deployment

Deployed to both Vercel and Railway, sharing one Postgres database (provisioned on Railway). See [Docs/deployment-plan.md](Docs/deployment-plan.md) for the full setup. In short:

- Set `GROQ_API_KEY`, `GROQ_MODEL`, and `DATABASE_URL` as project environment variables on each platform.
- `npm run build` runs `prisma generate` via the `postinstall` hook.
- `npm start` (`next start -H 0.0.0.0 -p ${PORT:-3000}`) — the explicit host/port binding is required for Railway's proxy to reach the container; Vercel's serverless runtime doesn't use this script at all.

## Documentation

| Doc | What it covers |
|---|---|
| [problemStatement.md](Docs/problemStatement.md) | Requirements, and the verified corpus (39 URLs checked) |
| [rag-architecture.md](Docs/rag-architecture.md) | Full retrieval design; Part IX covers chunking and embedding |
| [scheduler-and-scraping.md](Docs/scheduler-and-scraping.md) | The daily pipeline, the scraper, and the edition guard |
| [vector-store.md](Docs/vector-store.md) | pgvector storage, retrieval SQL, and how scheduler data reaches the backend |
| [implementation-plan.md](Docs/implementation-plan.md) | Phased build order ([PDF](Docs/implementation-plan.pdf)) |

## Commands

```bash
npm run dev                       # http://localhost:3000
npm run build                     # production build
npm run lint                      # ESLint
npm run test:scope                # scope-guard regression suite (no network)

npm run corpus:watch              # check every guidance source for changes
npm run corpus:watch -- --dry-run # ...without writing to the database

npm run ingest                    # scrape -> chunk -> embed -> pgvector
npm run ingest -- --dry-run       # ...everything except the database write
npm run ingest -- --source=KEY    # one document

npm run eval                      # 10-question evaluation (needs the app running)
```

The corpus pipeline runs daily at **03:45 UTC (09:15 IST)** via
[.github/workflows/corpus-ingest.yml](.github/workflows/corpus-ingest.yml).

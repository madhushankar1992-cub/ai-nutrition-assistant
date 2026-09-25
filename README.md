# AI Nutrition Assistant (Milestone 1)

**Live:** [Vercel](https://ai-nutrition-assistant-self.vercel.app) · [Railway](https://app-production-3fe4f.up.railway.app) — both share the same Railway-hosted Postgres database.

See [Docs/problemStatement.md](Docs/problemStatement.md) for the requirements and [Docs/architecture.md](Docs/architecture.md) for the technical design.

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

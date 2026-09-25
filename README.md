# AI Nutrition Assistant (Milestone 1)

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

Deploy to Vercel, setting `ANTHROPIC_API_KEY` and `DATABASE_URL` (Postgres, e.g. Supabase/Neon) as project environment variables. `npm run build` runs `prisma generate` via the `postinstall`/build pipeline.

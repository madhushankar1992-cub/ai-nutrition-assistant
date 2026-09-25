# Deployment Plan — AI Nutrition Assistant

Covers deploying the current app (Next.js frontend + `/api/chat` backend, Groq LLM integration, Prisma/Postgres data layer) to **both Vercel and Railway**, since the project can run identically on either. One shared database (Postgres) backs both deployments — this plan does not recommend SQLite-on-Railway as a shortcut, because running the same codebase against two different database engines (SQLite locally/on-Railway, Postgres on Vercel) would mean maintaining two `schema.prisma` provider configurations and testing migrations twice. A single Postgres instance, reachable from both platforms, keeps the deployed behavior identical regardless of which one serves traffic.

Corresponds to implementation-plan.md Phase 10, expanded into concrete steps for two targets.

---

## 1. Current State (as of writing this plan)

| Item | Status |
|---|---|
| Frontend | Redesigned dark UI (Space Grotesk/IBM Plex Sans, lime accent), built and verified (`npm run build` passes) |
| Backend (`/api/chat`) | Working, live-tested against Groq (`openai/gpt-oss-120b`), rate-limited, retries on transient/429 errors |
| Database | **Local dev only** — SQLite (`prisma/schema.prisma` provider is currently `sqlite`, `DATABASE_URL="file:./dev.db"`) |
| Git | Local repository, not yet pushed — no GitHub remote configured |
| GitHub | `gh` CLI authenticated as `madhushankar1992-cub` |
| Vercel | `vercel` CLI authenticated as `madhushankar1992-7302` |
| Railway | Not yet checked — CLI availability/auth to be confirmed at deploy time |
| Eval / prompt iteration | Phase 7–9 complete; scope suite 8/8, one documented prompt-iteration cycle logged in `Docs/prompt-iteration-log.md` |

**Blocking items before either deployment can go live:**
1. A provisioned Postgres database (Supabase or Neon) with its connection string.
2. `prisma/schema.prisma`'s datasource switched back from `sqlite` to `postgresql`.
3. The local commit pushed to a GitHub repository.

---

## 2. Database: Provisioning Postgres (shared by both targets)

1. Create a Postgres instance on **Supabase** or **Neon** (either works; Supabase's pooled connection string is convenient for serverless, Neon's branching is convenient for preview environments — pick based on preference, not a hard requirement here).
2. Copy the **pooled/connection-pooling** connection string, not the direct one, if the provider distinguishes them (Supabase: use the "Transaction" pooler port 6543 string; Neon: its default pooled string). This matters specifically for Vercel's serverless functions, which can spawn many concurrent short-lived connections — a direct (non-pooled) connection string risks "too many connections" errors under load (flagged in `Docs/edge-cases.md`, Phase 10).
3. Switch the datasource back to Postgres:

   ```prisma
   // prisma/schema.prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

   Also revert `EvalRun.claimsJson` from `String` back to `Json` (it was changed to `String` specifically because SQLite has no native Json type — Postgres supports it natively, and `scripts/evaluate.ts`'s manual `JSON.stringify`/no-parse handling would need to be reverted alongside this if you want the richer Json column type back; alternatively, leave it as `String` for simplicity and zero code change — both are valid, this plan defaults to **leaving it as `String`** to avoid touching working eval code during a deploy).

4. Generate and apply the first migration against the real database, locally, before deploying. There is currently no committed migration for the `postgresql` provider (the original migration was generated against SQLite and was removed since its SQL dialect doesn't apply to Postgres), so the first run must be `migrate dev`, not `migrate deploy` (which only applies existing migration files and has none to apply yet):

   ```bash
   DATABASE_URL="<production-connection-string>" npx prisma migrate dev --name init
   ```

   This both creates `prisma/migrations/<timestamp>_init/` (to be committed to the repo) and applies it. **Every subsequent** schema change should use `migrate deploy` against production instead — `migrate dev` is only for generating new migrations locally/for the first one.

5. Verify: `DATABASE_URL="<production-connection-string>" npx prisma studio` (or a quick script, as done earlier for the local SQLite check) shows all five empty tables.

---

## 3. GitHub: Push the Repository

```bash
git add -A
git commit -m "Prepare for deployment: Postgres datasource, deployment docs"
gh repo create <repo-name> --private --source=. --remote=origin --push
```

(`--private` by default; make it `--public` instead if a public repo is preferred — Vercel/Railway can deploy from either.) After this, `git push` alone updates it for subsequent commits.

---

## 4. Deploying to Vercel

1. **Link the project** (from the project root):
   ```bash
   vercel link
   ```
   Follow prompts to associate it with the GitHub repo pushed in Step 3, or run `vercel --prod` directly against the local directory if linking via Git isn't desired for the first deploy.

2. **Set environment variables** (Project Settings → Environment Variables, or via CLI):
   ```bash
   vercel env add GROQ_API_KEY production
   vercel env add GROQ_MODEL production      # optional; defaults to openai/gpt-oss-120b if unset
   vercel env add DATABASE_URL production
   ```
   Repeat for the `preview` environment if preview deployments (per-PR) are wanted too.

3. **Build command**: Vercel auto-detects Next.js; the default `next build` is correct. `postinstall` already runs `prisma generate` (in `package.json`), so the Prisma client is generated automatically on every install. Migrations are **not** run automatically by `vercel build` — Step 2.4 already applied them directly against the production database, so no build-step migration hook is required for the initial deploy. For future schema changes, run `prisma migrate deploy` against the production `DATABASE_URL` manually (or wire it into a CI step) before pushing code that depends on the new schema.

4. **Function timeout**: add a route segment config to `app/api/chat/route.ts` so slow Groq calls (retries with backoff can add up) aren't killed by Vercel's default serverless timeout:
   ```ts
   export const maxDuration = 60; // seconds; Hobby plan max is 60, Pro allows up to 300
   ```
   This was flagged as a gap in `Docs/edge-cases.md` (Phase 10) and should be added before the first production deploy, not discovered after a timeout in the wild.

5. **Deploy**:
   ```bash
   vercel --prod
   ```

6. **Smoke test** (Phase 10 exit criteria): against the returned `*.vercel.app` URL,
   - One normal question → expect a valid `{answer, claims[]}` with all `source: null`.
   - One scope-abuse question (e.g. "what should my daily calorie target be?") → expect the refusal template, `claims: []`.
   - Confirm both persisted correctly by checking row counts in the production database (same method used for the local SQLite check).

---

## 5. Deploying to Railway

1. **Check/install the Railway CLI** and authenticate:
   ```bash
   railway login
   ```
2. **Create a new project** linked to the same GitHub repo:
   ```bash
   railway init
   railway link   # if the project already exists on Railway's dashboard
   ```
3. **Set environment variables**:
   ```bash
   railway variables set GROQ_API_KEY=<value>
   railway variables set GROQ_MODEL=openai/gpt-oss-120b
   railway variables set DATABASE_URL=<same production Postgres connection string as Vercel>
   ```
4. **Build/start commands**: Railway detects Next.js via Nixpacks automatically; confirm the generated build command is `npm run build` and the start command is `npm run start`. `postinstall`'s `prisma generate` runs the same way it does locally/on Vercel.
5. **Add the `maxDuration` config from Step 4.4 as well** if reusing the same route file (harmless on Railway, required for Vercel) — no need for a Railway-specific branch of that code.
6. **Deploy**: pushing to the linked GitHub branch triggers an automatic Railway deploy (or `railway up` for a manual deploy from the CLI).
7. **Smoke test**: same two checks as Step 4.6, against the Railway-provided `*.up.railway.app` URL, confirmed against the **same** shared Postgres database (so this step also confirms both deployments are writing to and reading from the same data, not silently diverging).

---

## 6. Running Both Simultaneously

Since both deployments point at the same Postgres database, running Vercel and Railway live at the same time is safe from a data-integrity standpoint (Postgres handles concurrent writes from two app instances normally — there's no SQLite-style single-writer concern here). Two reasons you might genuinely want both rather than picking one:
- **Comparing platforms** before committing to one for the long term (cold-start latency, pricing, DX).
- **Vercel as primary, Railway as a warm standby** — if Vercel's serverless timeout or cold starts become a problem for slower Groq responses, Railway's always-on container model doesn't have that constraint.

If only one is actually needed going forward, decommission the other via its dashboard once a decision is made — no code changes required either way, since neither platform is hard-coded into the app.

---

## 7. Post-Deployment Checklist

- [ ] Postgres provisioned, migrated, and verified (5 empty tables)
- [ ] `prisma/schema.prisma` datasource is `postgresql`, committed
- [ ] GitHub repo created and pushed
- [ ] Vercel: env vars set, `maxDuration` added, deployed, smoke-tested
- [ ] Railway: env vars set, deployed, smoke-tested
- [ ] Both URLs confirmed writing to the same database (no drift)
- [ ] `Docs/failure-log.md` / `Docs/prompt-iteration-log.md` reflect the current prompt version running in production
- [ ] `README.md` updated with the live URL(s) for the deliverable

---

## 8. What This Plan Deliberately Does Not Cover

- **Rate limiting the public endpoint itself** (distinct from the Groq-facing limiter already in `lib/rateLimiter.ts`) — flagged as an open gap in `Docs/edge-cases.md`; worth adding before wide public sharing of either URL, not required to complete the Milestone 1 deliverable.
- **A health-check endpoint** (`GET /api/health`) to verify env vars post-deploy — also flagged as a gap; recommended as a fast follow, not a hard blocker for the first deploy.
- **CI-driven migrations** — this plan runs `prisma migrate deploy` manually once; wiring it into a GitHub Action is a reasonable next step once the deployment is stable, not part of the initial deploy.

# Release runbook — finish, verify, deploy, publish

Written for the agent that runs the final release on 4 October 2026, starting around
22:00 IST, after the Groq daily quota has refilled. Follow the steps in order. Stop at
any step that fails and report it; do not skip ahead.

## 0. Preconditions (check first, change nothing)

- `git status` shows only intended changes. Nothing secret is staged (`gh secret`, `.env`,
  `.env.local` are gitignored; scan the staged diff for `gsk_` and `postgres://` before committing).
- `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run test:scope`,
  `npm run test:corpus`, `npm run test:rate` all pass.

## 1. Groq quota — only start expensive work when it fits

Quota is a rolling 24-hour window of 200,000 tokens, refilling about 139 tokens a minute.
A single grounded answer needs about 2,900 tokens in one request.

- Probe with a 4-token call. If it fails, read "Used N | Requested M | try again in X".
- Start the full evaluation only after one grounded answer succeeds.
- Never run two Groq-heavy jobs in parallel.

## 2. Live grounded answer

- `GENERATION_DEADLINE_MS=300000` for the check (default is 45s).
- Ask: "How long can I keep cooked rice in the fridge?"
- Pass: an answer with at least one claim, every claim's citation has a publisher, year and
  chunk id, and nothing unexpected is dropped by `bindCitations`.
- Fail on quota: wait and retry. Fail on any other error: diagnose it, fix it, retry.

## 3. Full evaluation

- `GENERATION_DEADLINE_MS=300000 npm run eval:retrieval` (about 100k tokens).
- Run once, in the background, and poll its log.
- Read the result from `Docs/retrieval-report.md`. Do not hand-edit numbers.
- Expected: recall@5 17/17, document recall 17/17, adversarial 8/8, 0 false refusals.
  Any drop must be explained, not hidden.

## 4. Errors

- Fix every defect with the smallest correct change.
- If something cannot be fixed, remove the failing item (the source, the URL, the data row)
  and record why in `Docs/release-notes.md`.
- Never remove a test, a safety check (scope guard, citation binding, ownership check), or
  a citation requirement to make a result pass. Report those instead.

## 5. Release

1. Commit with a clear message, `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
2. `git push origin master` (GitHub is the source of truth).
3. Backend: `npx --yes @railway/cli@latest up --ci --service app`.
4. Frontend: `npx vercel deploy --prod --yes --scope mad-6a83`. Check the BACKEND_API_URL
   variable is set on the Vercel production environment first.

## 6. Verify both live hosts

- Backend `https://app-production-3fe4f.up.railway.app/api/chat` (GET): status ok, 7 documents,
  229 chunks, groqConfigured true.
- Frontend `https://ai-nutrition-assistant-self.vercel.app` (GET root 200; GET /api/chat ok).
- POST a salt question on each host: a cited answer, with WHO and PHE both attributed.
- POST a calorie question: refused, no claims.
- POST an off-corpus question: refused, names the 7 documents.
- Stranger on an owned conversation: 404.

## 7. Report

Give the frontend URL, the backend URL, the GitHub repository and commit, the measured
numbers quoted from the report, and every removal with its reason.

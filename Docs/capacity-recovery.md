# Capacity recovery fix

The reported screenshot showed `how many eggs to eat a day` ending in a capacity reply with a 42-second wait. Provider quotas remain real, but several application behaviors made this harder to recover from.

## Changes

- The browser displays a live countdown and automatically retries a temporary capacity response. It respects `Retry-After`, preserves the returned conversation ID and owner cookie, and stops after two retries or an excessive wait. Authentication, provider outages, malformed answers and daily quota waits are not retried automatically.
- Failed user/server-error pairs are excluded from generation history and first-answer cache eligibility. A first-question retry can therefore use a valid cached answer. The original history is still scanned by the safety guard; real answered context still prevents shared-cache reuse.
- Terminal `a day`, `each day` and `every day` wording is normalized to `per day`, so the exact screenshot wording shares the existing question's cache entry. Context, document filter, prompt/corpus versions and ownership safeguards remain in place.
- Concurrent identical eligible first questions are serialized and re-check the cache; they generate one answer while each request keeps its own conversation and ownership.
- Provider 429/auth rejection releases its unused inference-token reservation. Missing usage reports and uncertain failures remain conservatively budgeted. Provider cooldown applies to all callers; daily budgets are rechecked after waits.
- Grounded generation and its general-answer fallback share one deadline instead of each starting a fresh deadline.

## Validation before deployment

- 40 independent server regressions passed, including retry cache recovery, real-history isolation, concurrent duplicate generation, ownership, shared deadlines, quota settlement and existing error/citation/refusal checks.
- 13 fake-clock browser retry checks passed, including countdown timing, returned conversation IDs, bounded retries, HTTP-date hints, daily limits, provider/auth failures and ownership recovery.
- Scope guard: 78 checks passed. Existing rate-limiter and corpus-watcher checks passed. TypeScript, lint and the production build passed.
- Controlled browser smoke used the rebuilt app through a temporary local test proxy. Its first response was a simulated 15-second capacity failure; the UI displayed the countdown, retried automatically, and then obtained an actual HTTP 200 general-answer response for the exact eggs wording. Browser console errors were empty. The test proxy is outside the repository and is not deployed; its test conversation was cleaned up.
- Environment file hashes were unchanged. No API key, model/provider, plan, dependency, database schema, corpus, host configuration or Docker setup was changed.

## Production verification

Pending deployment of this change. The previous release's audit remains historical evidence, not verification of this release.

## Remaining limit

Distinct fresh questions can still wait for Groq's shared quota. The application recovers from temporary overload instead of treating it as a final answer; it does not provide unlimited throughput or bypass provider limits. Existing dependency security alerts recorded in `guardrail-audit.md` are unchanged.

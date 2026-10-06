import assert from "node:assert/strict";
import { RateLimiter, TPM_SAFE } from "../lib/rateLimiter";

async function main() {
  const limiter = new RateLimiter();
  await assert.rejects(limiter.reserve(TPM_SAFE + 1), /exceeds the per-minute budget/);
  await assert.rejects(limiter.reserve(NaN), /finite and nonnegative/);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(limiter.reserve(1, alreadyAborted.signal), { name: "AbortError" });

  // Fill the budget, then cancel a reservation that would normally wait a
  // minute. Cancellation must release the timer and spend no quota.
  await limiter.reserve(TPM_SAFE);
  const controller = new AbortController();
  const waiting = limiter.reserve(1, controller.signal);
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });

  // A rejected oversized or cancelled request must not poison a fresh limiter.
  const fresh = new RateLimiter();
  await assert.rejects(fresh.reserve(TPM_SAFE + 1000), /exceeds/);
  await assert.rejects(fresh.reserve(TPM_SAFE, alreadyAborted.signal), { name: "AbortError" });
  await fresh.reserve(TPM_SAFE);

  // Fail fast: with the budget full, a request that would have to wait longer
  // than its maxWaitMs is refused at once with a retry hint, instead of
  // queueing silently until the caller's deadline.
  const started = Date.now();
  await assert.rejects(fresh.reserve(1, undefined, 1_000), /per-minute budget is full; retry in about \d+ s/);
  assert.ok(Date.now() - started < 500, "fail-fast must not wait");

  // Settle: a reservation corrected down to the tokens actually used frees the
  // budget immediately for the next request.
  const settling = new RateLimiter();
  const r = await settling.reserve(TPM_SAFE);
  await assert.rejects(settling.reserve(TPM_SAFE / 2, undefined, 100), /budget is full/);
  r.settle(500);
  await settling.reserve(TPM_SAFE / 2, undefined, 100); // fits now, no wait

  console.log("PASS: oversized reservations reject, waits cancel, full budgets fail fast, and settled usage frees budget");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

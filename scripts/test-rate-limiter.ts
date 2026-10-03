import assert from "node:assert/strict";
import { RateLimiter } from "../lib/rateLimiter";

async function main() {
  const limiter = new RateLimiter();
  await assert.rejects(limiter.reserve(7001), /exceeds the per-minute budget/);
  await assert.rejects(limiter.reserve(NaN), /finite and nonnegative/);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(limiter.reserve(1, alreadyAborted.signal), { name: "AbortError" });

  // Fill the budget, then cancel a reservation that would normally wait a
  // minute. Cancellation must release the timer and spend no quota.
  await limiter.reserve(7000);
  const controller = new AbortController();
  const waiting = limiter.reserve(1, controller.signal);
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });

  // A rejected oversized or cancelled request must not poison a fresh limiter.
  const fresh = new RateLimiter();
  await assert.rejects(fresh.reserve(8000), /exceeds/);
  await assert.rejects(fresh.reserve(7000, alreadyAborted.signal), { name: "AbortError" });
  await fresh.reserve(7000);
  console.log("PASS: oversized reservations reject immediately and waiting reservations cancel");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

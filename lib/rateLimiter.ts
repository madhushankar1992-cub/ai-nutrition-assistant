import { setTimeout as delay } from "node:timers/promises";

// Client-side rate limiting for the Groq `openai/gpt-oss-120b` tier limits:
// 30 requests/min, 8,000 tokens/min, 1,000 requests/day, 200,000 tokens/day.
// This is a best-effort, in-memory limiter: it holds up under a single
// long-running process (dev server, or one warm serverless instance), but it
// does NOT coordinate across multiple serverless instances or survive a
// process restart. The authoritative backstop is the 429 handling in
// lib/groq.ts, which reacts to Groq's own rate-limit response regardless of
// what this limiter thinks the state is.

const RPM_LIMIT = 30;
const TPM_LIMIT = 8000;
const RPD_LIMIT = 1000;
const TPD_LIMIT = 200000;

// Stay under the provider's stated limits, not right at the edge of them.
const RPM_SAFE = 25;
// 7,600 of Groq's 8,000. The margin used to be 1,000 because every request was
// budgeted at its worst case (the full max_tokens output). Reservations are now
// settled to the tokens Groq actually reports, so the margin only has to cover
// the estimate for requests still in flight.
const TPM_SAFE = 7600;

interface RequestRecord {
  timestamp: number;
  tokens: number;
}

export class RateLimiter {
  private minuteWindow: RequestRecord[] = [];
  private dayRequests = 0;
  private dayTokens = 0;
  private dayResetAt = this.nextUtcMidnight();
  private blockedUntil = 0;

  /** Honor provider throttling across all callers, not just the failing request. */
  deferFor(ms: number) {
    if (Number.isFinite(ms) && ms > 0) this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
  }

  private nextUtcMidnight(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  }

  private pruneMinuteWindow() {
    const cutoff = Date.now() - 60_000;
    this.minuteWindow = this.minuteWindow.filter((r) => r.timestamp > cutoff);
  }

  private resetDayIfNeeded() {
    if (Date.now() >= this.dayResetAt) {
      this.dayRequests = 0;
      this.dayTokens = 0;
      this.dayResetAt = this.nextUtcMidnight();
    }
  }

  /**
   * Resolves once there is room under the per-minute budget for a call
   * estimated to use `estimatedTokens`, sleeping as needed. Throws
   * immediately if the daily budget (requests or tokens) is already
   * exhausted — a day-long wait isn't practical to do silently.
   * Oversized requests reject immediately; a signal cancels queued waits.
   */
  async reserve(
    estimatedTokens: number,
    signal?: AbortSignal,
    maxWaitMs = Number.POSITIVE_INFINITY
  ): Promise<{ settle(actualTokens: number): void }> {
    const startedAt = Date.now();
    signal?.throwIfAborted();
    if (!Number.isFinite(estimatedTokens) || estimatedTokens < 0) {
      throw new Error("Estimated token count must be finite and nonnegative.");
    }
    if (estimatedTokens > TPM_SAFE) {
      throw new Error(`Request token estimate (${estimatedTokens}) exceeds the per-minute budget (${TPM_SAFE}). Reduce the request size.`);
    }
    this.resetDayIfNeeded();

    if (this.dayRequests + 1 > RPD_LIMIT || this.dayTokens + estimatedTokens > TPD_LIMIT) {
      throw new Error(
        `Groq daily rate limit would be exceeded (limit: ${RPD_LIMIT} requests / ${TPD_LIMIT} tokens per day). Try again after the daily reset (UTC midnight).`
      );
    }

    for (;;) {
      signal?.throwIfAborted();
      this.resetDayIfNeeded();
      if (this.dayRequests + 1 > RPD_LIMIT || this.dayTokens + estimatedTokens > TPD_LIMIT) {
        throw new Error("Groq daily rate limit would be exceeded. Try again after the daily reset (UTC midnight).");
      }
      this.pruneMinuteWindow();
      const usedTokens = this.minuteWindow.reduce((sum, r) => sum + r.tokens, 0);
      const usedRequests = this.minuteWindow.length;

      if (Date.now() >= this.blockedUntil && usedRequests < RPM_SAFE && usedTokens + estimatedTokens <= TPM_SAFE) {
        break;
      }

      const oldest = this.minuteWindow[0];
      const minuteWait = usedRequests >= RPM_SAFE || usedTokens + estimatedTokens > TPM_SAFE
        ? (oldest ? Math.max(oldest.timestamp + 60_000 - Date.now(), 250) : 1000) : 0;
      const waitMs = Math.max(minuteWait, this.blockedUntil - Date.now(), 250);

      // Fail fast rather than queue past the caller's patience. Measured:
      // a second question 8 s after the first waited silently for the
      // per-minute budget, hit the 45 s generation deadline, and the user got
      // "at capacity" after nearly a minute of nothing. Saying so immediately,
      // with how long to wait, is the honest version of the same outcome.
      if (Date.now() - startedAt + waitMs > maxWaitMs) {
        const retryInS = Math.ceil(waitMs / 1000);
        throw new Error(
          `Groq per-minute budget is full; retry in about ${retryInS} s.`
        );
      }
      await delay(waitMs, undefined, { signal });
    }

    const record = { timestamp: Date.now(), tokens: estimatedTokens };
    this.minuteWindow.push(record);
    this.dayRequests += 1;
    this.dayTokens += estimatedTokens;

    // The estimate counts the full max_tokens output allowance, which real
    // answers rarely use. Once Groq reports actual usage, correct the record,
    // so the next request is not held back by tokens that were never spent.
    return {
      settle: (actualTokens: number) => {
        if (!Number.isFinite(actualTokens) || actualTokens < 0) return;
        this.dayTokens = Math.max(0, this.dayTokens + actualTokens - record.tokens);
        record.tokens = actualTokens;
      },
    };
  }
}

// Singleton, hot-reload-safe (same pattern as lib/db.ts) so the limiter's
// state is actually shared across calls within this process.
const globalForLimiter = globalThis as unknown as { groqRateLimiter?: RateLimiter };
export const groqRateLimiter = globalForLimiter.groqRateLimiter ?? new RateLimiter();
if (process.env.NODE_ENV !== "production") {
  globalForLimiter.groqRateLimiter = groqRateLimiter;
}

/** Rough ~4 chars/token heuristic — good enough for conservative budgeting, not exact billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export { RPM_LIMIT, TPM_LIMIT, RPD_LIMIT, TPD_LIMIT, TPM_SAFE };

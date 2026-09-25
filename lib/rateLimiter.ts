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
const TPM_SAFE = 7000;

interface RequestRecord {
  timestamp: number;
  tokens: number;
}

class RateLimiter {
  private minuteWindow: RequestRecord[] = [];
  private dayRequests = 0;
  private dayTokens = 0;
  private dayResetAt = this.nextUtcMidnight();

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
   */
  async reserve(estimatedTokens: number): Promise<void> {
    this.resetDayIfNeeded();

    if (this.dayRequests + 1 > RPD_LIMIT || this.dayTokens + estimatedTokens > TPD_LIMIT) {
      throw new Error(
        `Groq daily rate limit would be exceeded (limit: ${RPD_LIMIT} requests / ${TPD_LIMIT} tokens per day). Try again after the daily reset (UTC midnight).`
      );
    }

    for (;;) {
      this.pruneMinuteWindow();
      const usedTokens = this.minuteWindow.reduce((sum, r) => sum + r.tokens, 0);
      const usedRequests = this.minuteWindow.length;

      if (usedRequests < RPM_SAFE && usedTokens + estimatedTokens <= TPM_SAFE) {
        break;
      }

      const oldest = this.minuteWindow[0];
      const waitMs = oldest ? Math.max(oldest.timestamp + 60_000 - Date.now(), 250) : 1000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.minuteWindow.push({ timestamp: Date.now(), tokens: estimatedTokens });
    this.dayRequests += 1;
    this.dayTokens += estimatedTokens;
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

export { RPM_LIMIT, TPM_LIMIT, RPD_LIMIT, TPD_LIMIT };

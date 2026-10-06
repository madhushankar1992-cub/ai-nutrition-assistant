/** Public, retryable errors without exposing provider responses or credentials. */
export function generationError(err: unknown) {
  const error = err as { name?: string; message?: string; status?: number; headers?: Headers; retryAfterSeconds?: number } | null;
  const message = error?.message ?? "";
  const capacity = error?.status === 429 || /rate limit|per-minute budget/i.test(message);
  const timeout = error?.name === "AbortError" || error?.name === "TimeoutError" || error?.name === "APIConnectionTimeoutError";
  const unavailable = error?.status === 401 || error?.status === 403 || (error?.status ?? 0) >= 500 || error?.name === "APIConnectionError";
  const header = error?.headers?.get?.("retry-after");
  const headerSeconds = header ? (Number.isFinite(Number(header)) ? Number(header) : (Date.parse(header) - Date.now()) / 1000) : NaN;
  const localSeconds = Number(message.match(/retry in about (\d+) s/i)?.[1]);
  const dailySeconds = /daily rate limit/i.test(message)
    ? (Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1) - Date.now()) / 1000
    : NaN;
  const retryAfterSeconds = Math.max(1, Math.ceil([error?.retryAfterSeconds, headerSeconds, localSeconds, dailySeconds].find((n) => Number.isFinite(n) && Number(n) > 0) ?? 60));
  return {
    status: capacity || timeout || unavailable ? 503 : 422,
    category: capacity ? "capacity" : timeout ? "generation_timeout" : unavailable ? "provider_unavailable" : "invalid_schema",
    answer: capacity
      ? `The assistant is at capacity right now. Please try again in ${retryAfterSeconds} seconds.`
      : timeout
        ? "The response took too long. Please try again shortly."
        : unavailable
          ? "The assistant is temporarily unavailable. Please try again shortly."
          : "Sorry, something went wrong generating a response. Please try again.",
    retryAfterSeconds,
  };
}

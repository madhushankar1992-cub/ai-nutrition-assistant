/** Browser-side capacity recovery: bounded, explicit waits, never retries authentication/outages. */
export async function sendChatRequest(
  message: string,
  initialConversationId: string | null,
  onWait: (seconds: number | null) => void,
  options: {
    fetch?: typeof fetch;
    wait?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {}
) {
  const request = options.fetch ?? fetch;
  const wait = options.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  let conversationId = initialConversationId;
  let ownershipRecovered = false;
  let retries = 0;
  const started = now();
  for (;;) {
    const response = await request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(65_000),
      body: JSON.stringify({ conversationId, message }),
    });
    if (response.status === 404 && conversationId && !ownershipRecovered) {
      ownershipRecovered = true;
      conversationId = null;
      continue;
    }
    const data = await response.json();
    if (data.conversationId) conversationId = data.conversationId;
    const header = response.headers.get("retry-after");
    const headerSeconds = header ? (Number.isFinite(Number(header)) ? Number(header) : (Date.parse(header) - now()) / 1000) : NaN;
    const seconds = Math.ceil(Number.isFinite(headerSeconds) ? headerSeconds : Number(data.retryAfterSeconds));
    // A daily quota or repeated overload must not keep a browser waiting indefinitely.
    if (response.status !== 503 || data.errorCode !== "capacity" || retries >= 2 ||
      !Number.isFinite(seconds) || seconds < 1 || seconds > 90 || now() - started + seconds * 1000 > 150_000) {
      onWait(null);
      return { response, data };
    }
    retries++;
    const until = now() + seconds * 1000;
    while (now() < until) {
      onWait(Math.ceil((until - now()) / 1000));
      await wait(Math.min(1000, until - now()));
    }
    onWait(null);
  }
}

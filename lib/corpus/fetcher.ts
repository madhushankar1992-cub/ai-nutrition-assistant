// Polite HTTP fetching for the corpus watcher.
//
// These are government and NGO servers being hit on a schedule, so this layer
// is deliberately conservative: one request at a time, a delay between hosts, a
// real User-Agent (several publishers reject the default Node one outright),
// and conditional requests so an unchanged 7 MB PDF costs a 304 instead of a
// download.
//
// Three outcomes are distinguished on purpose, because they need different
// human responses:
//   ok         - we have bytes
//   unchanged  - server said 304; nothing to do
//   blocked    - 401/403/429, or a challenge page. The document is fine, the
//                server just refuses robots. Needs a manual download.
//   unreachable- DNS failure, timeout, connection reset. May be transient;
//                retry before concluding anything.
//   error      - 404/5xx and anything else unexpected.

import { createHash } from "node:crypto";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const DELAY_BETWEEN_REQUESTS_MS = 2_000;
const MAX_BYTES = 40 * 1024 * 1024;

export type FetchOutcome = "ok" | "unchanged" | "blocked" | "unreachable" | "error";

export interface ConditionalHeaders {
  etag?: string | null;
  lastModified?: string | null;
}

export interface FetchResult {
  outcome: FetchOutcome;
  httpStatus: number | null;
  contentType: string | null;
  bytes: Buffer | null;
  byteLength: number;
  /** sha256 of the body, or null when there is no body (304, blocked, error). */
  checksum: string | null;
  etag: string | null;
  lastModified: string | null;
  finalUrl: string;
  redirected: boolean;
  durationMs: number;
  detail: string;
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when the body looks like a bot-check interstitial rather than the document. */
function looksLikeChallenge(contentType: string | null, bytes: Buffer): boolean {
  if (contentType && !contentType.includes("text/html")) return false;
  const head = bytes.subarray(0, 4000).toString("utf8").toLowerCase();
  return (
    head.includes("captcha") ||
    head.includes("checking your browser") ||
    head.includes("enable javascript and cookies") ||
    head.includes("request unsuccessful")
  );
}

function classifyNetworkError(err: unknown): { outcome: FetchOutcome; detail: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  if (name === "AbortError" || /timeout|timed out/i.test(msg)) {
    return { outcome: "unreachable", detail: `Timed out after ${REQUEST_TIMEOUT_MS} ms` };
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|socket hang up/i.test(msg)) {
    return { outcome: "unreachable", detail: msg };
  }
  return { outcome: "error", detail: msg };
}

async function attemptOnce(url: string, conditional: ConditionalHeaders): Promise<FetchResult> {
  const startedAt = Date.now();
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/pdf,text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
  };
  if (conditional.etag) headers["If-None-Match"] = conditional.etag;
  if (conditional.lastModified) headers["If-Modified-Since"] = conditional.lastModified;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const base = {
    httpStatus: null as number | null,
    contentType: null as string | null,
    bytes: null as Buffer | null,
    byteLength: 0,
    checksum: null as string | null,
    etag: null as string | null,
    lastModified: null as string | null,
    finalUrl: url,
    redirected: false,
    durationMs: 0,
  };

  try {
    const res = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
    const contentType = res.headers.get("content-type");
    const common = {
      ...base,
      httpStatus: res.status,
      contentType,
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
      finalUrl: res.url || url,
      redirected: (res.url || url) !== url,
      durationMs: Date.now() - startedAt,
    };

    if (res.status === 304) {
      return { ...common, outcome: "unchanged", detail: "Not modified since last check" };
    }
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return {
        ...common,
        outcome: "blocked",
        detail: `HTTP ${res.status} — server refuses programmatic clients. Needs a manual download.`,
      };
    }
    if (!res.ok) {
      return { ...common, outcome: "error", detail: `HTTP ${res.status} ${res.statusText}` };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      return {
        ...common,
        outcome: "error",
        detail: `Body is ${buf.byteLength} bytes, over the ${MAX_BYTES} byte ceiling`,
      };
    }
    if (looksLikeChallenge(contentType, buf)) {
      return {
        ...common,
        outcome: "blocked",
        detail: "HTTP 200 but the body is a bot-check page, not the document",
      };
    }

    return {
      ...common,
      outcome: "ok",
      bytes: buf,
      byteLength: buf.byteLength,
      checksum: sha256(buf),
      detail: `Fetched ${buf.byteLength} bytes`,
    };
  } catch (err) {
    const { outcome, detail } = classifyNetworkError(err);
    return { ...base, outcome, durationMs: Date.now() - startedAt, detail };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch one document, retrying only the failures that retrying can fix.
 *
 * A 403 is a policy decision by the server — retrying it just adds load and
 * still fails, so it returns immediately. Timeouts and connection resets do get
 * retried with backoff, because corpus research saw at least one publisher
 * (the Australian guidelines) fail that way intermittently.
 */
export async function fetchDocument(
  url: string,
  conditional: ConditionalHeaders = {}
): Promise<FetchResult> {
  let last: FetchResult | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await attemptOnce(url, conditional);
    if (last.outcome !== "unreachable") return last;
    if (attempt < MAX_ATTEMPTS) await sleep(1_000 * attempt);
  }

  return {
    ...(last as FetchResult),
    detail: `${last?.detail ?? "unreachable"} (after ${MAX_ATTEMPTS} attempts)`,
  };
}

export { DELAY_BETWEEN_REQUESTS_MS, USER_AGENT };

// Conversation ownership.
//
// The gap this closes: `conversationId` is a UUID returned to the client and
// accepted back without any check, so anyone holding one could read and extend
// that conversation. An unguessable identifier is obscurity, not access control
// — UUIDs leak through logs, referrers, shared screenshots and browser history.
//
// What this is NOT: user accounts. There is no login, no password, no identity.
// Each browser is issued an opaque owner id in an httpOnly cookie, signed so it
// cannot be forged, and a conversation can only be read by the browser that
// created it. That is the right size for a prototype: it stops cross-user
// access without inventing an auth system nobody asked for.
//
// Limits, stated plainly: clearing cookies loses access to past conversations,
// and the owner id is not portable between devices. Both are acceptable for a
// prototype and both are fixed by real accounts, not by a bigger cookie.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const OWNER_COOKIE = "nk_owner";

/** A year. The cookie carries no personal data, only an opaque random id. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Signing key.
 *
 * SESSION_SECRET is the intended source. Falling back to DATABASE_URL is
 * deliberate rather than lazy: it is present and identical on both deploy
 * targets, it is already a secret, and it means the cookie is signed with
 * something attacker-unknown even if SESSION_SECRET was never set — which is
 * exactly the case where a weak default would otherwise be silently accepted.
 * It is never used as the cookie value, only as an HMAC key.
 */
function signingKey(): string {
  const secret = process.env.SESSION_SECRET || process.env.DATABASE_URL;
  if (!secret) {
    throw new Error(
      "Cannot sign session cookies: set SESSION_SECRET (or DATABASE_URL) in the environment."
    );
  }
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", signingKey()).update(value).digest("base64url");
}

/** Constant-time compare, so a forged signature cannot be found byte by byte. */
function signatureMatches(value: string, signature: string): boolean {
  const expected = Buffer.from(sign(value));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Parse `id.signature`, returning the id only if the signature verifies. */
export function verifyOwnerCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;

  const value = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  try {
    return signatureMatches(value, signature) ? value : null;
  } catch {
    return null;
  }
}

export function issueOwnerId(): { ownerId: string; cookieValue: string } {
  const ownerId = randomUUID();
  return { ownerId, cookieValue: `${ownerId}.${sign(ownerId)}` };
}

export function ownerCookieAttributes(cookieValue: string): string {
  // httpOnly: script cannot read it, so an XSS cannot exfiltrate the owner id.
  // sameSite=lax: not sent on cross-site POSTs, which blocks CSRF against
  // DELETE while still surviving ordinary top-level navigation.
  const parts = [
    `${OWNER_COOKIE}=${cookieValue}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export type OwnerResult = {
  ownerId: string;
  /** Set when a new id was issued and the response must carry Set-Cookie. */
  setCookie?: string;
};

/** Read the owner id from the request, or mint a new one. */
export function resolveOwner(cookieHeader: string | undefined | null): OwnerResult {
  const raw = cookieHeader
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${OWNER_COOKIE}=`))
    ?.slice(OWNER_COOKIE.length + 1);

  const existing = verifyOwnerCookie(raw);
  if (existing) return { ownerId: existing };

  const { ownerId, cookieValue } = issueOwnerId();
  return { ownerId, setCookie: ownerCookieAttributes(cookieValue) };
}

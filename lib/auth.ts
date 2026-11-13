import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Single-user password gate. This app spends your Anthropic and Azure credits,
 * so even a "personal" deployment needs a lock on the door.
 *
 * The session cookie is `<issuedAtMs>.<hmac>`, signed with SESSION_SECRET over
 * the issue time and a hash of APP_PASSWORD. Changing either variable logs out
 * every existing session. No server-side session storage is needed.
 *
 * This module must not import "server-only" or lib/env.ts: proxy.ts uses it.
 */

export const SESSION_COOKIE = "laoshi_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface AuthConfig {
  password: string;
  secret: string;
}

function authConfig(): AuthConfig {
  const password = process.env.APP_PASSWORD?.trim() ?? "";
  const secret = process.env.SESSION_SECRET ?? "";
  if (!password || secret.length < 32) {
    throw new Error(
      "Auth is not configured: set APP_PASSWORD and SESSION_SECRET (32+ characters).",
    );
  }
  return { password, secret };
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function sign(issuedAt: number, cfg: AuthConfig): string {
  return createHmac("sha256", cfg.secret)
    .update(`v1:${issuedAt}:`)
    .update(sha256(cfg.password))
    .digest("base64url");
}

/** Constant-time password check (hashing first equalizes lengths). */
export function passwordMatches(candidate: string): boolean {
  const cfg = authConfig();
  return timingSafeEqual(sha256(candidate), sha256(cfg.password));
}

export function createSessionToken(now = Date.now()): string {
  return `${now}.${sign(now, authConfig())}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const issuedAt = Number(token.slice(0, dot));
  if (!Number.isSafeInteger(issuedAt)) return false;
  const ageMs = now - issuedAt;
  if (ageMs < -60_000 || ageMs > SESSION_MAX_AGE_SECONDS * 1000) return false;

  let cfg: AuthConfig;
  try {
    cfg = authConfig();
  } catch {
    return false; // misconfigured: fail closed
  }
  const expected = Buffer.from(sign(issuedAt, cfg));
  const actual = Buffer.from(token.slice(dot + 1));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

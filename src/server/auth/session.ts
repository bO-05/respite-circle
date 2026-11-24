import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ROLES, type Role } from "./policy";
import { assertProductionSessionSecret } from "./session-secret";

/**
 * Signed, stateless `rc_session` cookie.
 *
 * The payload is base64url JSON — person, role, church, issued-at, expiry — and
 * the second segment is an HMAC-SHA256 over that payload using SESSION_SECRET.
 * The payload carries no names, contact details, or free text, so it is safe to
 * hand to the browser; the signature is what makes the role unforgeable.
 */

export const SESSION_COOKIE_NAME = "rc_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const SESSION_VERSION = 1;

const MAX_TOKEN_LENGTH = 4096;
const CLOCK_SKEW_SECONDS = 60;

export type Session = {
  personId: string;
  role: Role;
  churchId: string;
  issuedAt: number;
  expiresAt: number;
};

export type SessionClaims = Pick<Session, "personId" | "role" | "churchId">;

export type SessionOptions = {
  /** Defaults to SESSION_SECRET. Tests pass a fixed value. */
  secret?: string;
  /** Unix seconds. Defaults to the wall clock. Tests pass a fixed value. */
  now?: number;
};

export type IssueSessionOptions = SessionOptions & {
  ttlSeconds?: number;
};

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  expires: Date;
  maxAge: number;
};

const claimsSchema = z
  .object({
    personId: z.string().uuid(),
    role: z.enum(ROLES),
    churchId: z.string().uuid(),
  })
  .strict();

const payloadSchema = z
  .object({
    v: z.literal(SESSION_VERSION),
    personId: z.string().uuid(),
    role: z.enum(ROLES),
    churchId: z.string().uuid(),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
  })
  .strict();

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Read SESSION_SECRET lazily so a missing secret fails a request with a clear
 * server error instead of failing at module import (which would break builds).
 *
 * The published placeholder is refused when NODE_ENV is production.
 * `next.config.ts` stops a production start (and a production build) before
 * Next serves a request, and `src/instrumentation.ts` repeats the assertion for
 * runtimes that do not load the config at request time.
 */
export function getSessionSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const secret = env.SESSION_SECRET?.trim();

  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set. Add a long random value to .env.local or the deployment environment.",
    );
  }

  assertProductionSessionSecret(env);

  if (secret.length < 16) {
    throw new Error("SESSION_SECRET must be at least 16 characters long.");
  }

  return secret;
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

/** Create a signed session token and the claims it represents. */
export function issueSession(
  claims: SessionClaims,
  options: IssueSessionOptions = {},
): { token: string; session: Session } {
  const parsed = claimsSchema.parse(claims);
  const secret = options.secret ?? getSessionSecret();
  const issuedAt = options.now ?? nowSeconds();
  const ttlSeconds = options.ttlSeconds ?? SESSION_TTL_SECONDS;

  if (!Number.isInteger(issuedAt) || issuedAt < 0) {
    throw new Error("Session issue time must be a non-negative integer.");
  }

  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("Session lifetime must be a positive integer.");
  }

  const expiresAt = issuedAt + ttlSeconds;
  const payload = {
    v: SESSION_VERSION,
    personId: parsed.personId,
    role: parsed.role,
    churchId: parsed.churchId,
    iat: issuedAt,
    exp: expiresAt,
  };

  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64url");
  const signature = signPayload(encodedPayload, secret);

  return {
    token: `${encodedPayload}.${signature}`,
    session: {
      personId: parsed.personId,
      role: parsed.role,
      churchId: parsed.churchId,
      issuedAt,
      expiresAt,
    },
  };
}

/**
 * Verify a cookie value. Returns null for anything that is not a correctly
 * signed, unexpired session with a known role. Never throws on bad input.
 */
export function verifySessionToken(
  token: string | null | undefined,
  options: SessionOptions = {},
): Session | null {
  if (typeof token !== "string" || token.length === 0) return null;
  if (token.length > MAX_TOKEN_LENGTH) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;

  let secret: string;
  try {
    secret = options.secret ?? getSessionSecret();
  } catch {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload, secret);
  const providedBytes = Buffer.from(signature, "base64url");
  const expectedBytes = Buffer.from(expectedSignature, "base64url");

  if (providedBytes.length !== expectedBytes.length) return null;
  if (!timingSafeEqual(providedBytes, expectedBytes)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
  } catch {
    return null;
  }

  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return null;

  const now = options.now ?? nowSeconds();
  const payload = parsed.data;

  if (payload.exp <= now) return null;
  if (payload.iat > now + CLOCK_SKEW_SECONDS) return null;

  return {
    personId: payload.personId,
    role: payload.role,
    churchId: payload.churchId,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

/**
 * Cookie attributes for the session. HttpOnly and SameSite=Lax are not
 * optional; `secure` follows the deployment protocol so the local demo over
 * http://127.0.0.1 still works while HTTPS deployments get Secure cookies.
 */
export function sessionCookieOptions(
  expiresAt: number,
  secure: boolean,
  now: number = nowSeconds(),
): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: new Date(expiresAt * 1000),
    maxAge: Math.max(0, expiresAt - now),
  };
}

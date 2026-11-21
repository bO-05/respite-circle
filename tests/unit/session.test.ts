import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getSessionSecret,
  issueSession,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  verifySessionToken,
} from "../../src/server/auth/session";

const SECRET = "unit-test-secret-that-is-long-enough";
const NOW = 1_800_000_000;
const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const CHURCH_ID = "22222222-2222-4222-8222-222222222222";

const claims = {
  personId: PERSON_ID,
  role: "caregiver" as const,
  churchId: CHURCH_ID,
};

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split(".")[0], "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

function encodePayload(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

describe("signed session tokens", () => {
  it("issues a session that verifies back to the same person, role, and church", () => {
    const { token, session } = issueSession(claims, { secret: SECRET, now: NOW });

    expect(session.personId).toBe(PERSON_ID);
    expect(session.role).toBe("caregiver");
    expect(session.churchId).toBe(CHURCH_ID);
    expect(session.issuedAt).toBe(NOW);
    expect(session.expiresAt).toBe(NOW + SESSION_TTL_SECONDS);

    expect(verifySessionToken(token, { secret: SECRET, now: NOW + 10 })).toEqual(
      session,
    );
  });

  it("issues a two-part token whose payload is not a bare identity", () => {
    const { token } = issueSession(claims, { secret: SECRET, now: NOW });
    const parts = token.split(".");

    expect(parts).toHaveLength(2);
    expect(token).not.toContain(PERSON_ID);
    expect(parts[1].length).toBeGreaterThan(20);
    expect(decodePayload(token)).toMatchObject({
      v: 1,
      personId: PERSON_ID,
      role: "caregiver",
      churchId: CHURCH_ID,
      iat: NOW,
      exp: NOW + SESSION_TTL_SECONDS,
    });
  });

  it("rejects a payload whose role was rewritten without re-signing", () => {
    const { token } = issueSession(claims, { secret: SECRET, now: NOW });
    const [payloadPart, signature] = token.split(".");
    const payload = decodePayload(token);
    payload.role = "coordinator";

    const forged = `${encodePayload(payload)}.${signature}`;

    expect(payloadPart).not.toBe(forged.split(".")[0]);
    expect(verifySessionToken(forged, { secret: SECRET, now: NOW + 10 })).toBeNull();
  });

  it("rejects a payload whose church was rewritten without re-signing", () => {
    const { token } = issueSession(claims, { secret: SECRET, now: NOW });
    const [, signature] = token.split(".");
    const payload = decodePayload(token);
    payload.churchId = "33333333-3333-4333-8333-333333333333";

    expect(
      verifySessionToken(`${encodePayload(payload)}.${signature}`, {
        secret: SECRET,
        now: NOW + 10,
      }),
    ).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = issueSession(claims, { secret: SECRET, now: NOW });

    expect(
      verifySessionToken(token, { secret: `${SECRET}-different`, now: NOW + 10 }),
    ).toBeNull();
  });

  it("rejects an expired token", () => {
    const { token } = issueSession(claims, {
      secret: SECRET,
      now: NOW,
      ttlSeconds: 60,
    });

    expect(verifySessionToken(token, { secret: SECRET, now: NOW + 60 })).toBeNull();
    expect(verifySessionToken(token, { secret: SECRET, now: NOW + 59 })).not.toBeNull();
  });

  it("rejects unknown roles even when the signature is valid", () => {
    // Sign a payload with a role outside the closed set using the real secret.
    const payload = {
      v: 1,
      personId: PERSON_ID,
      role: "admin",
      churchId: CHURCH_ID,
      iat: NOW,
      exp: NOW + 60,
    };
    const encoded = encodePayload(payload);
    const signature = createHmac("sha256", SECRET).update(encoded).digest("base64url");

    expect(
      verifySessionToken(`${encoded}.${signature}`, { secret: SECRET, now: NOW }),
    ).toBeNull();
  });

  it("rejects extra payload keys rather than accepting a widened session", () => {
    const payload = {
      v: 1,
      personId: PERSON_ID,
      role: "caregiver",
      churchId: CHURCH_ID,
      iat: NOW,
      exp: NOW + 60,
      admin: true,
    };
    const encoded = encodePayload(payload);
    const signature = createHmac("sha256", SECRET).update(encoded).digest("base64url");

    expect(
      verifySessionToken(`${encoded}.${signature}`, { secret: SECRET, now: NOW }),
    ).toBeNull();
  });

  it("rejects malformed, empty, and missing tokens", () => {
    expect(verifySessionToken(undefined, { secret: SECRET, now: NOW })).toBeNull();
    expect(verifySessionToken("", { secret: SECRET, now: NOW })).toBeNull();
    expect(verifySessionToken("one", { secret: SECRET, now: NOW })).toBeNull();
    expect(verifySessionToken("a.b.c", { secret: SECRET, now: NOW })).toBeNull();
    expect(verifySessionToken("!!!.???", { secret: SECRET, now: NOW })).toBeNull();
  });

  it("never falls back to a default secret", () => {
    expect(() => getSessionSecret({})).toThrow(/SESSION_SECRET/);
    expect(() => getSessionSecret({ SESSION_SECRET: "" })).toThrow(/SESSION_SECRET/);
    expect(() => getSessionSecret({ SESSION_SECRET: "short" })).toThrow(
      /at least 16 characters/,
    );
    expect(getSessionSecret({ SESSION_SECRET: SECRET })).toBe(SECRET);
  });
});

describe("session cookie options", () => {
  it("is HttpOnly, SameSite=Lax, path-scoped, and always expires", () => {
    const expiresAt = NOW + 600;
    const options = sessionCookieOptions(expiresAt, false, NOW);

    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 600,
    });
    expect(options.expires).toBeInstanceOf(Date);
    expect(options.expires.getTime()).toBe(expiresAt * 1000);
  });

  it("marks the cookie Secure only when the deployment is HTTPS", () => {
    expect(sessionCookieOptions(NOW + 600, true, NOW).secure).toBe(true);
    expect(sessionCookieOptions(NOW + 600, false, NOW).secure).toBe(false);
  });

  it("never emits a negative Max-Age for an already expired session", () => {
    const options = sessionCookieOptions(NOW - 60, false, NOW);
    expect(options.maxAge).toBe(0);
  });
});

import { timingSafeEqual } from "node:crypto";
import { isDemoModeEnabled } from "./policy";

/**
 * The reset's two locks, kept out of the route so they can be tested whole.
 *
 * Demo mode off is indistinguishable from the route not existing: 404 with a
 * generic body. A missing token is 401 and a wrong token is 403, and neither
 * answer says which part of the token was close.
 */

export type DemoResetGuardResult =
  | { ok: true }
  | {
      ok: false;
      status: 404 | 401 | 403;
      error: string;
    };

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function demoResetGuard(
  headerToken: string | null,
  env: Readonly<Record<string, string | undefined>> = process.env,
): DemoResetGuardResult {
  if (!isDemoModeEnabled(env)) {
    return { ok: false, status: 404, error: "Not found." };
  }

  const expected = env.RC_DEMO_RESET_TOKEN;
  if (!expected) {
    return { ok: false, status: 404, error: "Not found." };
  }

  if (!headerToken) {
    return {
      ok: false,
      status: 401,
      error: "A demo reset token is required.",
    };
  }

  if (!tokensMatch(headerToken, expected)) {
    return {
      ok: false,
      status: 403,
      error: "That demo reset token is not valid.",
    };
  }

  return { ok: true };
}

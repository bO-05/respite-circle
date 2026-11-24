import { assertProductionSessionSecret } from "./server/auth/session-secret";

/**
 * Runs once when a Next.js server instance starts.
 *
 * A production deployment that kept the published `SESSION_SECRET` placeholder
 * must not sign cookies anyone can forge. The thrown message names the variable
 * and never the value; it is a second gate for runtimes that do not re-evaluate
 * `next.config.ts` at request time. A missing secret is left to the request-time
 * loader, so a build with no environment loaded still starts.
 */
export function register(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  assertProductionSessionSecret(env);
}

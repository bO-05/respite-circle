/**
 * The published placeholder values a session secret must never be in
 * production, and the one check that refuses them.
 *
 * `.env.example` used to ship `SESSION_SECRET=change-me-to-a-long-random-value`.
 * A deployment that kept that template value would sign every `rc_session`
 * cookie with a string anyone can read, so the role in the payload would be
 * forgeable. The list is deliberately short: it guards the templates people
 * copy, it is not a password-strength meter.
 *
 * No Node or Next imports here: the boot check in `src/instrumentation.ts` and
 * the request-time loader in `session.ts` share this module, so the two can
 * never drift apart.
 */

export const PLACEHOLDER_SESSION_SECRETS = [
  "change-me",
  "change-me-to-a-long-random-value",
  "changeme",
  "placeholder",
  "replace-me",
  "session-secret",
  "your-secret-here",
  "your-session-secret",
] as const;

/** Whether `value` is one of the published placeholders, compared trimmed. */
export function isPlaceholderSessionSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (PLACEHOLDER_SESSION_SECRETS as readonly string[]).includes(
    normalized,
  );
}

/**
 * The message names the variable and the problem. It never includes the value
 * itself, so a failed boot cannot print a secret into a build or deploy log.
 */
const PLACEHOLDER_SESSION_SECRET_MESSAGE =
  "SESSION_SECRET is set to a published placeholder value, so session cookies signed with it could be forged. " +
  "Generate a long random value (for example, `openssl rand -base64 32`) and set SESSION_SECRET to it in the deployment environment.";

/**
 * Throw when a production environment holds a published placeholder.
 *
 * A missing value is left alone: it stays a request-time error, so a build
 * with no environment loaded still succeeds. Development keeps working with
 * the placeholder on purpose — the local demo and the E2E suite use it.
 */
export function assertProductionSessionSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (env.NODE_ENV !== "production") return;

  const secret = env.SESSION_SECRET?.trim();
  if (!secret) return;
  if (!isPlaceholderSessionSecret(secret)) return;

  throw new Error(PLACEHOLDER_SESSION_SECRET_MESSAGE);
}

/**
 * Database target guards.
 *
 * There is one Neon project. `neondb` is the demo/app database; the isolated
 * `respite_circle_e2e` database is the only place a suite may truncate. Neon
 * hosts are endpoint ids and never contain a database name, so the guard reads
 * the name from the connection path instead of string-matching the host.
 *
 * These functions are pure so they can be unit-tested without a connection.
 */

export const E2E_DATABASE_NAME = "respite_circle_e2e";
export const E2E_FLAG = "e2e";

export function databaseNameFromUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("The database URL is not a valid URL.");
  }

  const name = parsed.pathname.replace(/^\//, "");
  if (!name) {
    throw new Error("The database URL does not name a database.");
  }
  return name;
}

export function isPooledHost(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).hostname.includes("-pooler");
  } catch {
    throw new Error("The database URL is not a valid URL.");
  }
}

function requireUrl(rawUrl: string | undefined, variable: string): string {
  if (!rawUrl) {
    throw new Error(
      `${variable} is not set. Add it to .env.local (see .env.example).`,
    );
  }
  return rawUrl;
}

/**
 * The direct endpoint is mandatory for migrations, seed, and reset: the pooled
 * `-pooler` host is PgBouncer and cannot hold the session state migrations need.
 */
export function requireDirectUrl(
  variable: string,
  rawUrl: string | undefined,
): string {
  const url = requireUrl(rawUrl, variable);
  if (isPooledHost(url)) {
    throw new Error(
      `${variable} points at the pooled (-pooler) host. Migrations and seeding need the direct connection string.`,
    );
  }
  return url;
}

/**
 * A suite may only touch `respite_circle_e2e`. The explicit flag names the
 * isolation target; it is not a Neon branch.
 */
export function assertE2eTarget(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.RC_DB_BRANCH !== E2E_FLAG) {
    throw new Error(
      `Refusing to run: RC_DB_BRANCH must equal "${E2E_FLAG}" for the integration suite. ` +
        "The flag is an isolation guard, not a Neon branch; without it a suite could truncate the app database neondb.",
    );
  }

  const url = requireUrl(
    env.E2E_DATABASE_URL_UNPOOLED,
    "E2E_DATABASE_URL_UNPOOLED",
  );
  const name = databaseNameFromUrl(url);

  if (name !== E2E_DATABASE_NAME) {
    throw new Error(
      `Refusing to run: E2E_DATABASE_URL_UNPOOLED targets the "${name}" database, ` +
        `but the suite may only use "${E2E_DATABASE_NAME}".`,
    );
  }

  if (isPooledHost(url)) {
    throw new Error(
      "Refusing to run: E2E_DATABASE_URL_UNPOOLED points at the pooled (-pooler) host. Use the direct endpoint.",
    );
  }

  return url;
}

/**
 * Writable targets (migrate, seed, reset) beyond the disposable test database
 * require the deliberate opt-in `RC_SEED_ALLOW_REMOTE=1`. `respite_circle_e2e`
 * still requires the suite's own flag so it can never be confused with the demo
 * database.
 */
export function assertWritableTarget(
  rawUrl: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const name = databaseNameFromUrl(rawUrl);

  if (isPooledHost(rawUrl)) {
    throw new Error(
      "Writable database targets must use the direct (-pooler-free) endpoint.",
    );
  }

  if (name === E2E_DATABASE_NAME) {
    if (env.RC_DB_BRANCH !== E2E_FLAG) {
      throw new Error(
        `Refusing to write to ${E2E_DATABASE_NAME}: set RC_DB_BRANCH=${E2E_FLAG} to confirm the isolated test database.`,
      );
    }
    return rawUrl;
  }

  if (env.RC_SEED_ALLOW_REMOTE !== "1") {
    throw new Error(
      `Refusing to write to the "${name}" database. Set RC_SEED_ALLOW_REMOTE=1 to confirm a deliberate migration, seed, or reset of a remote database.`,
    );
  }

  return rawUrl;
}

import {
  databaseNameFromUrl,
  E2E_DATABASE_NAME,
  requireDirectUrl,
} from "./target";

/**
 * The deliberate opt-in required before a script writes to the app database.
 * Development and production share one Neon database, so this flag is the only
 * thing between a stray local command and the judged demo data.
 */
export const REMOTE_FLAG = "RC_SEED_ALLOW_REMOTE";

/**
 * Resolve `DATABASE_URL_UNPOOLED` for the `:remote` scripts.
 *
 * These scripts exist for the deployed demo database (`neondb`). They must
 * never touch the isolated test database, must never use the pooled endpoint,
 * and must refuse to run until an operator sets `RC_SEED_ALLOW_REMOTE=1` in
 * the same shell. The flag is checked before any connection opens.
 */
export function requireRemoteTarget(
  command: string,
  env: Record<string, string | undefined> = process.env,
): string {
  if (env[REMOTE_FLAG] !== "1") {
    throw new Error(
      `Refusing to run ${command}: set ${REMOTE_FLAG}=1 to confirm a deliberate write to the remote app database.`,
    );
  }

  const url = requireDirectUrl(
    "DATABASE_URL_UNPOOLED",
    env.DATABASE_URL_UNPOOLED,
  );
  const name = databaseNameFromUrl(url);

  if (name === E2E_DATABASE_NAME) {
    throw new Error(
      `Refusing to run ${command}: DATABASE_URL_UNPOOLED targets the isolated test database "${E2E_DATABASE_NAME}". The :remote scripts only write to the app database.`,
    );
  }

  return url;
}

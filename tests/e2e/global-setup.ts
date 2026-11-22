import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadEnvLocal } from "../../src/db/env";
import { assertE2eTarget } from "../../src/db/target";

/**
 * Playwright's one-time fixture.
 *
 * The ask spec writes asks, so the suite runs against the isolated
 * `respite_circle_e2e` database — the same database the integration suite uses
 * — never `neondb`. This setup applies the committed migrations, then runs the
 * repo's own reset script (truncate, reseed, verify) in a child process so the
 * E2E fixture and the demo reset use exactly the same code path.
 *
 * `assertE2eTarget()` refuses anything but that database and aborts without
 * `RC_DB_BRANCH=e2e` (the isolation flag, not a Neon branch).
 */
export default async function setup(): Promise<void> {
  loadEnvLocal();
  const url = assertE2eTarget();

  const client = postgres(url, {
    max: 1,
    prepare: false,
    ssl: "require",
    onnotice: () => undefined,
  });

  try {
    await migrate(drizzle(client), {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
  } finally {
    await client.end();
  }

  // `src/db/seed.ts` is an ESM entry point (`import.meta`), so it must run in
  // its own tsx process rather than inside Playwright's CommonJS transform.
  const tsxCli = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

  execFileSync(process.execPath, [tsxCli, "scripts/reset-demo.ts"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL_UNPOOLED: url,
      RC_DB_BRANCH: "e2e",
    },
  });
}

import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadEnvLocal } from "../../src/db/env";
import { assertE2eTarget } from "../../src/db/target";

/**
 * Integration global setup.
 *
 * Refuses to run unless `RC_DB_BRANCH=e2e` and `E2E_DATABASE_URL_UNPOOLED`
 * target the isolated `respite_circle_e2e` database, then applies the committed
 * migrations so the suite always tests the real schema, never a stale one.
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
}

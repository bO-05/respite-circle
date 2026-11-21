import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadEnvLocal } from "../src/db/env";
import * as schema from "../src/db/schema";
import {
  assertWritableTarget,
  databaseNameFromUrl,
  requireDirectUrl,
} from "../src/db/target";

/**
 * Apply the committed Drizzle migrations against the direct Neon endpoint.
 * Guarded: the demo database `neondb` needs `RC_SEED_ALLOW_REMOTE=1`, and the
 * isolated test database needs `RC_DB_BRANCH=e2e`.
 */
async function main(): Promise<void> {
  loadEnvLocal();

  const url = requireDirectUrl(
    "DATABASE_URL_UNPOOLED",
    process.env.DATABASE_URL_UNPOOLED,
  );
  assertWritableTarget(url);

  const client = postgres(url, {
    max: 1,
    prepare: false,
    ssl: "require",
    onnotice: () => undefined,
  });

  try {
    await migrate(drizzle(client, { schema }), {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
    console.log(
      `Applied committed migrations to the "${databaseNameFromUrl(url)}" database.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

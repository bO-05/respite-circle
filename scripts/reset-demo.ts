import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadEnvLocal } from "../src/db/env";
import { resetDemoDatabase } from "../src/db/reset";
import * as schema from "../src/db/schema";
import type { SeedDb } from "../src/db/seed";
import { assertWritableTarget, requireDirectUrl } from "../src/db/target";
import { verifySeed } from "./verify-seed";

/**
 * Wipe the demo tables and reseed the deterministic cast. Refuses to touch the
 * app database without `RC_SEED_ALLOW_REMOTE=1` (see src/db/target.ts).
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
    const db = drizzle(client, { schema }) as SeedDb;
    await resetDemoDatabase(db);

    const result = await verifySeed(db);
    if (!result.ok) {
      console.error("Reset completed but seed verification failed:");
      for (const failure of result.failures) {
        console.error(`  - ${failure}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("Demo reset: tables truncated, Grace Community Church reseeded.");
    console.log(
      Object.entries(result.counts)
        .map(([table, value]) => `${table}=${value}`)
        .join(" "),
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

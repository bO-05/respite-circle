import { drizzle } from "drizzle-orm/postgres-js";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { loadEnvLocal } from "./env";
import { requireRemoteTarget } from "./remote-target";
import * as schema from "./schema";
import { seedChurch } from "./seed-data";
import {
  formatSeedCounts,
  seedDatabase,
  type SeedDb,
} from "./seed-core";
import { assertWritableTarget, requireDirectUrl } from "./target";

/**
 * `npm run db:seed` — the CLI around the deterministic cast.
 *
 * The cast itself lives in `seed-core.ts` so the demo reset route can import
 * it without pulling this file's CLI and `.env.local` loading into the server
 * bundle. This module re-exports the core so existing callers keep working.
 */

export * from "./seed-core";

export function isDirectRun(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(entry).href === metaUrl;
}

async function main(): Promise<void> {
  loadEnvLocal();

  const remote = process.argv.includes("--remote");
  const url = remote
    ? requireRemoteTarget("db:seed:remote")
    : requireDirectUrl(
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
    const counts = await seedDatabase(db);
    console.log(`Seeded ${seedChurch.name}.`);
    console.log(formatSeedCounts(counts));
  } finally {
    await client.end();
  }
}

if (isDirectRun(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

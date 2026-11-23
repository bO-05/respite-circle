import { drizzle } from "drizzle-orm/postgres-js";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { loadEnvLocal } from "../src/db/env";
import * as schema from "../src/db/schema";
import type { SeedDb } from "../src/db/seed-core";
import { seedChurch } from "../src/db/seed-data";
import { requireDirectUrl } from "../src/db/target";
import { COUNTED_TABLES, type TableCounts } from "../src/db/counts";
import { verifySeed } from "../src/db/verify";

/**
 * `npm run db:verify` — read-only seed check and row counts.
 *
 * The verification itself lives in `src/db/verify.ts` so the demo reset
 * endpoint and the integration suite use exactly the same rules without
 * importing a CLI script. These re-exports keep the existing imports working.
 */

export {
  COUNTED_TABLES,
  readAllTableCounts,
  type TableCounts,
} from "../src/db/counts";
export { verifySeed, type VerifySeedResult } from "../src/db/verify";

function printCounts(counts: TableCounts): void {
  console.log("Row counts:");
  for (const table of COUNTED_TABLES) {
    console.log(`  ${table.padEnd(18, " ")} ${counts[table] ?? 0}`);
  }
}

async function main(): Promise<void> {
  loadEnvLocal();

  const url = requireDirectUrl(
    "DATABASE_URL_UNPOOLED",
    process.env.DATABASE_URL_UNPOOLED,
  );

  const client = postgres(url, {
    max: 1,
    prepare: false,
    ssl: "require",
    onnotice: () => undefined,
  });

  try {
    const db = drizzle(client, { schema }) as SeedDb;
    const result = await verifySeed(db);
    printCounts(result.counts);

    if (!result.ok) {
      console.error("");
      console.error("Seed verification failed:");
      for (const failure of result.failures) {
        console.error(`  - ${failure}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("");
    console.log(
      `Seed verified: ${seedChurch.name}, the full fictional cast, policy version 1, and four Respite Morning sessions are present.`,
    );
  } finally {
    await client.end();
  }
}

function isDirectRun(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(entry).href === metaUrl;
}

if (isDirectRun(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

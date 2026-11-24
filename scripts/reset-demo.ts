import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadEnvLocal } from "../src/db/env";
import * as schema from "../src/db/schema";
import type { SeedDb } from "../src/db/seed-core";
import { assertWritableTarget, requireDirectUrl } from "../src/db/target";
import { COUNTED_TABLES } from "../src/db/counts";
import { runDemoReset } from "../src/server/services/demo-reset";

/**
 * Wipe the demo tables, reseed the deterministic cast, write the demo-ready
 * asks and published times, and verify twelve assertions before reporting
 * success. Refuses to touch the app database without `RC_SEED_ALLOW_REMOTE=1`
 * (see src/db/target.ts); the isolated test database needs `RC_DB_BRANCH=e2e`.
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
    const result = await runDemoReset(db);

    if (!result.ok) {
      console.error("Demo reset failed; success was not reported.");
      for (const failure of result.failures) {
        console.error(`  - [${failure.id}] ${failure.message}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(
      `Demo reset: tables truncated, ${result.church} reseeded with the demo-ready board.`,
    );
    console.log(
      COUNTED_TABLES.map(
        (table) => `${table}=${result.counts[table] ?? 0}`,
      ).join(" "),
    );
    console.log(
      `Assertions: ${result.assertions.passed}/${result.assertions.total} passed.`,
    );
    console.log(`Decision mode: ${result.mode}.`);
    for (const engine of result.engines) {
      const provider = engine.providers.join(", ") || "none";
      const model = engine.models.join(", ") || "none";
      const latency =
        engine.latencyMs === null ? "latency not recorded" : `${engine.latencyMs} ms`;
      const fallback = engine.fallbackReason
        ? ` · fallback: ${engine.fallbackReason}`
        : "";
      console.log(
        `  ${engine.label}: ${engine.engine} — ${provider} / ${model}, ${engine.questionCount} answers, ${latency}${fallback}`,
      );
    }
    console.log(`Seed digest: ${result.seedDigest}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

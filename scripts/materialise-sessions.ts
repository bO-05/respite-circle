import { drizzle } from "drizzle-orm/postgres-js";
import { and, gt, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { loadEnvLocal } from "../src/db/env";
import * as schema from "../src/db/schema";
import { church, session } from "../src/db/schema";
import {
  assertE2eTarget,
  assertWritableTarget,
  databaseNameFromUrl,
  requireDirectUrl,
} from "../src/db/target";

/**
 * Materialise the next four occurrences of every active weekly template.
 *
 * Safe to run twice: the unique `(template_id, starts_at)` index makes the
 * second run insert zero rows. Writes use the direct Neon endpoint.
 *
 * Targets follow the repository's guards:
 *   - `--e2e` uses `E2E_DATABASE_URL_UNPOOLED` and requires RC_DB_BRANCH=e2e;
 *   - otherwise `DATABASE_URL_UNPOOLED` is used and `neondb` requires the
 *     deliberate `RC_SEED_ALLOW_REMOTE=1` confirmation.
 */
async function main(): Promise<void> {
  loadEnvLocal();

  // The repository module builds the app's lazy database client at import
  // time, so it may only be imported after `.env.local` is loaded.
  const { materialiseSessionsForChurch } = await import(
    "../src/server/repositories/sessions"
  );

  const e2e = process.argv.includes("--e2e");
  const url = e2e
    ? assertE2eTarget()
    : assertWritableTarget(
        requireDirectUrl(
          "DATABASE_URL_UNPOOLED",
          process.env.DATABASE_URL_UNPOOLED,
        ),
      );

  const client = postgres(url, {
    max: 1,
    prepare: false,
    ssl: "require",
    onnotice: () => undefined,
  });

  try {
    const db = drizzle(client, { schema });
    const churches = await db
      .select({ id: church.id, name: church.name })
      .from(church)
      .orderBy(church.name);

    if (churches.length === 0) {
      console.log(
        `No church exists in "${databaseNameFromUrl(url)}". Seed the database first.`,
      );
      return;
    }

    const now = new Date();
    let totalInserted = 0;

    for (const row of churches) {
      const outcome = await materialiseSessionsForChurch({
        churchId: row.id,
        database: db,
        now,
      });
      totalInserted += outcome.inserted;
      console.log(
        `${row.name}: checked=${outcome.checked} inserted=${outcome.inserted} timezone=${outcome.timeZone}`,
      );
    }

    const [future] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(session)
      .where(and(gt(session.startsAt, now), eq(session.status, "scheduled")));

    console.log(
      `Database "${databaseNameFromUrl(url)}": inserted ${totalInserted} session(s) this run.`,
    );
    console.log(
      `Future scheduled sessions: ${Number(future?.count ?? 0)}. The second run of this command must insert 0.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

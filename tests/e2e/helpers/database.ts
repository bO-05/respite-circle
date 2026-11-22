import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../../src/db/schema";
import { loadEnvLocal } from "../../../src/db/env";
import { assertE2eTarget } from "../../../src/db/target";

/**
 * A Playwright spec's own read-only connection to the isolated
 * `respite_circle_e2e` database.
 *
 * The guard refuses anything but that database, so an E2E assertion can never
 * accidentally inspect (or worse) the demo data in `neondb`. Callers must
 * close the client in `afterAll`.
 */
export async function openE2eDatabase() {
  loadEnvLocal();
  const url = assertE2eTarget();

  const client = postgres(url, {
    max: 1,
    prepare: false,
    ssl: "require",
    onnotice: () => undefined,
  });

  return { client, db: drizzle(client, { schema }), url };
}

export type E2eDatabase = Awaited<ReturnType<typeof openE2eDatabase>>;

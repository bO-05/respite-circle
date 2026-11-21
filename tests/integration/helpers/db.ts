import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { loadEnvLocal } from "../../../src/db/env";
import * as schema from "../../../src/db/schema";
import type { SeedDb } from "../../../src/db/seed";
import { assertE2eTarget } from "../../../src/db/target";

export type TestDatabase = {
  client: Sql;
  db: SeedDb;
  url: string;
};

/**
 * Open a client against the isolated `respite_circle_e2e` database. The target
 * guard aborts unless RC_DB_BRANCH=e2e and the URL names that database.
 */
export async function openTestDatabase(): Promise<TestDatabase> {
  loadEnvLocal();
  const url = assertE2eTarget();

  const client = postgres(url, {
    max: 2,
    prepare: false,
    ssl: "require",
    onnotice: () => undefined,
  });

  return { client, db: drizzle(client, { schema }) as SeedDb, url };
}

/** Collect a drizzle-wrapped error and every underlying cause message. */
function errorMessages(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = (current as { cause?: unknown }).cause;
    } else {
      messages.push(String(current));
      break;
    }
  }

  return messages.join("\n");
}

/** Assert a statement fails, matching the database's own message. */
export async function expectRejection(
  run: () => Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = errorMessages(error);
    if (!pattern.test(message)) {
      throw new Error(
        `The statement failed, but not with the expected message.\nExpected: ${pattern}\nReceived: ${message}`,
      );
    }
    return;
  }

  throw new Error(
    `Expected the statement to fail with ${pattern}, but it succeeded.`,
  );
}

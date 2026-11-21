import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * The only connection the Next runtime opens.
 *
 * `prepare: false` is mandatory: DATABASE_URL points at Neon's pooled endpoint,
 * which runs PgBouncer and cannot hold prepared statements across requests.
 * `ssl: "require"` is mandatory: Neon refuses plaintext connections.
 * `postgres.js` pools internally, so one client per process is correct.
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Add the pooled Neon connection string to .env.local or the Vercel environment.",
  );
}

const globalForDb = globalThis as typeof globalThis & {
  __respiteCircleSql?: ReturnType<typeof postgres>;
};

export const sql =
  globalForDb.__respiteCircleSql ??
  postgres(connectionString, { prepare: false, ssl: "require" });

if (process.env.NODE_ENV !== "production") {
  // Next dev reloads modules on edit; reuse the pool instead of leaking clients.
  globalForDb.__respiteCircleSql = sql;
}

export const db = drizzle(sql, { schema });

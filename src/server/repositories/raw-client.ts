import type { Sql } from "postgres";
import type { AppDatabase } from "./coordinator";

/**
 * The postgres.js client behind a drizzle database.
 *
 * `AppDatabase` is the narrow drizzle type the repositories accept (a test can
 * pass its own connection). At runtime the object is the value `drizzle()`
 * returns, which also carries `$client`; the type does not declare it. This one
 * cast keeps raw aggregate queries honest and in a single place, rather than
 * scattering `as unknown as` through the repositories.
 */
export function rawClient(database: AppDatabase): Sql {
  return (database as unknown as AppDatabase & { $client: Sql }).$client;
}

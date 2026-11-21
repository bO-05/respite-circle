import { asc, eq } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import { decision } from "@/db/schema";
import type { AppDatabase } from "./coordinator";

/**
 * Decision reads. The table is append-only in the database; this module offers
 * no update and no delete path, only insert (through the service transaction)
 * and read.
 */

export type DecisionRow = typeof decision.$inferSelect;

/** Every typed answer for one ask, in Q1–Q9 order. */
export async function getDecisionsForAsk(
  askId: string,
  database: AppDatabase = appDb,
): Promise<DecisionRow[]> {
  return database
    .select()
    .from(decision)
    .where(eq(decision.askId, askId))
    .orderBy(asc(decision.questionId));
}

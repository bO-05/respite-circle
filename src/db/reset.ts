import type { SeedDb } from "./seed";
import { seedDatabase } from "./seed";

/**
 * Every app table, in dependency order. One TRUNCATE statement lets Postgres
 * resolve the order itself, so there is no delete-order bug to introduce.
 */
export const RESET_TABLE_ORDER = [
  "absence_proof",
  "notification",
  "call_log",
  "slot_candidate",
  "slot",
  "decision",
  "ask_revision",
  "ask",
  "invite",
  "familiar_face",
  "volunteer",
  "care_recipient",
  "caregiver",
  "policy",
  "session",
  "session_template",
  "audit_event",
  "person",
  "church",
] as const;

export async function truncateAll(db: SeedDb): Promise<void> {
  const tables = RESET_TABLE_ORDER.map((name) => `"${name}"`).join(", ");
  await db.$client.unsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

/** Wipe the demo data and reseed the deterministic cast. */
export async function resetDemoDatabase(db: SeedDb) {
  await truncateAll(db);
  return seedDatabase(db);
}

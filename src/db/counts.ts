import type { SeedDb } from "./seed-core";

/**
 * Row counts for every app table, read in one round trip.
 *
 * The reset endpoint reports these with its seed digest, and the seed verifier
 * prints them. One query keeps a reset from paying a third of a second per
 * table against Neon.
 */
export const COUNTED_TABLES = [
  "absence_proof",
  "ask",
  "ask_revision",
  "audit_event",
  "call_log",
  "care_recipient",
  "caregiver",
  "church",
  "decision",
  "familiar_face",
  "invite",
  "notification",
  "person",
  "policy",
  "session",
  "session_template",
  "slot",
  "slot_candidate",
  "volunteer",
] as const;

export type TableCounts = Record<string, number>;

export async function readAllTableCounts(db: SeedDb): Promise<TableCounts> {
  const rows = await db.$client<{ table_name: string; row_count: number }[]>`
    SELECT 'absence_proof' AS table_name, COUNT(*)::int AS row_count FROM absence_proof
    UNION ALL SELECT 'ask', COUNT(*)::int FROM ask
    UNION ALL SELECT 'ask_revision', COUNT(*)::int FROM ask_revision
    UNION ALL SELECT 'audit_event', COUNT(*)::int FROM audit_event
    UNION ALL SELECT 'call_log', COUNT(*)::int FROM call_log
    UNION ALL SELECT 'care_recipient', COUNT(*)::int FROM care_recipient
    UNION ALL SELECT 'caregiver', COUNT(*)::int FROM caregiver
    UNION ALL SELECT 'church', COUNT(*)::int FROM church
    UNION ALL SELECT 'decision', COUNT(*)::int FROM decision
    UNION ALL SELECT 'familiar_face', COUNT(*)::int FROM familiar_face
    UNION ALL SELECT 'invite', COUNT(*)::int FROM invite
    UNION ALL SELECT 'notification', COUNT(*)::int FROM notification
    UNION ALL SELECT 'person', COUNT(*)::int FROM person
    UNION ALL SELECT 'policy', COUNT(*)::int FROM policy
    UNION ALL SELECT 'session', COUNT(*)::int FROM session
    UNION ALL SELECT 'session_template', COUNT(*)::int FROM session_template
    UNION ALL SELECT 'slot', COUNT(*)::int FROM slot
    UNION ALL SELECT 'slot_candidate', COUNT(*)::int FROM slot_candidate
    UNION ALL SELECT 'volunteer', COUNT(*)::int FROM volunteer
    ORDER BY table_name
  `;

  return Object.fromEntries(rows.map((row) => [row.table_name, row.row_count]));
}

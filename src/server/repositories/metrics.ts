import { eq } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import { church } from "@/db/schema";
import {
  DESK_AREA_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import {
  measureCoordinatorMinutes,
  type CoordinatorMinutes,
  type MetricsRange,
} from "@/server/domain/metrics";
import type { AppDatabase } from "./coordinator";
import { rawClient } from "./raw-client";

/**
 * The church's numbers for one stated range, computed only from its own rows.
 *
 * One statement returns every count, so the page pays one round trip for the
 * set instead of eight sequential ones. The second statement returns only the
 * coordinator and deputy audit instants the time measure needs. Neither
 * statement reads `ask.verbatim_text`, a care recipient, or an orientation
 * note: these are aggregate counts, not a view of a family.
 *
 * Definitions, mirrored on the page and in the integration cross-check:
 *
 *   households served  distinct families with a covered or done time whose
 *                      window falls in the range
 *   asks               asks received in the range (a draft was never received)
 *   times published    slots whose publication approval falls in the range
 *   claims             times whose claim instant falls in the range
 *   times covered      times whose claim confirmation instant falls in range
 *   unclaimed → called distinct times a coordinator called about in the range
 *   volunteer hours    length of the windows neighbours claimed in the range
 *   coordinator minutes measured from the audit trail (see domain/metrics.ts)
 */

export type ChurchMetrics = {
  householdsServed: number;
  asks: number;
  slotsPublished: number;
  claims: number;
  covered: number;
  unclaimedCalled: number;
  volunteerSeconds: number;
  coordinator: CoordinatorMinutes;
  timeZone: string;
};

type MetricsCountsRow = {
  households_served: number;
  asks: number;
  slots_published: number;
  claims: number;
  covered: number;
  unclaimed_called: number;
  volunteer_seconds: number;
  time_zone: string | null;
};

type CoordinatorActionRow = {
  ask_id: string | null;
  created_at: Date;
};

/**
 * The church's own clock, needed before the range can be parsed. The page
 * cannot guess it from the unsigned query string.
 */
export async function getChurchTimeZone(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<string> {
  requireRoleSession(actor, DESK_AREA_ROLES);

  const rows = await database
    .select({ timeZone: church.timezone })
    .from(church)
    .where(eq(church.id, actor.churchId))
    .limit(1);

  return rows[0]?.timeZone ?? "UTC";
}

/** Both range bounds are bound as ISO strings and cast in SQL. */
export async function getChurchMetrics(
  actor: Actor,
  range: MetricsRange,
  database: AppDatabase = appDb,
): Promise<ChurchMetrics> {
  requireRoleSession(actor, DESK_AREA_ROLES);

  const churchId = actor.churchId;
  const start = range.start.toISOString();
  const end = range.endExclusive.toISOString();

  const client = rawClient(database);
  const [countRows, actionRows] = await Promise.all([
    client<MetricsCountsRow[]>`
      SELECT
        (
          SELECT count(DISTINCT a.caregiver_id)::int
            FROM slot s
            JOIN ask a ON a.id = s.ask_id
           WHERE s.church_id = ${churchId}::uuid
             AND s.status IN ('covered', 'done')
             AND s.window_start >= ${start}::timestamptz
             AND s.window_start < ${end}::timestamptz
        ) AS households_served,
        (
          SELECT count(*)::int
            FROM ask a
           WHERE a.church_id = ${churchId}::uuid
             AND a.status <> 'draft'
             AND a.created_at >= ${start}::timestamptz
             AND a.created_at < ${end}::timestamptz
        ) AS asks,
        (
          SELECT count(*)::int
            FROM slot s
           WHERE s.church_id = ${churchId}::uuid
             AND s.approved_at >= ${start}::timestamptz
             AND s.approved_at < ${end}::timestamptz
        ) AS slots_published,
        (
          SELECT count(*)::int
            FROM slot s
           WHERE s.church_id = ${churchId}::uuid
             AND s.claimed_at >= ${start}::timestamptz
             AND s.claimed_at < ${end}::timestamptz
        ) AS claims,
        (
          SELECT count(*)::int
            FROM slot s
           WHERE s.church_id = ${churchId}::uuid
             AND s.claim_confirmed_at >= ${start}::timestamptz
             AND s.claim_confirmed_at < ${end}::timestamptz
        ) AS covered,
        (
          SELECT count(DISTINCT c.slot_id)::int
            FROM call_log c
            JOIN slot s ON s.id = c.slot_id
           WHERE s.church_id = ${churchId}::uuid
             AND c.created_at >= ${start}::timestamptz
             AND c.created_at < ${end}::timestamptz
        ) AS unclaimed_called,
        (
          SELECT COALESCE(
            sum(EXTRACT(EPOCH FROM (s.window_end - s.window_start))),
            0
          )::int
            FROM slot s
           WHERE s.church_id = ${churchId}::uuid
             AND s.status IN ('claimed', 'covered', 'done')
             AND s.window_start >= ${start}::timestamptz
             AND s.window_start < ${end}::timestamptz
             AND s.window_end IS NOT NULL
        ) AS volunteer_seconds,
        (
          SELECT c.timezone
            FROM church c
           WHERE c.id = ${churchId}::uuid
        ) AS time_zone
    `,
    client<CoordinatorActionRow[]>`
      SELECT
        COALESCE(s.ask_id, ae.entity_id) AS ask_id,
        ae.created_at
      FROM audit_event ae
      LEFT JOIN slot s
        ON ae.entity = 'slot'
       AND s.id = ae.entity_id
       AND s.church_id = ae.church_id
      JOIN person p ON p.id = ae.actor_id
      WHERE ae.church_id = ${churchId}::uuid
        AND ae.actor_type = 'human'
        AND ae.entity IN ('ask', 'slot')
        AND ae.entity_id IS NOT NULL
        AND ae.created_at >= ${start}::timestamptz
        AND ae.created_at < ${end}::timestamptz
        AND (
          p.roles @> '["coordinator"]'::jsonb
          OR p.roles @> '["deputy"]'::jsonb
        )
      ORDER BY ae.created_at ASC
      LIMIT 2000
    `,
  ]);

  const counts = countRows[0];

  const actions = actionRows
    .filter(
      (row): row is CoordinatorActionRow & { ask_id: string } =>
        typeof row.ask_id === "string",
    )
    .map((row) => ({
      askId: row.ask_id,
      at: new Date(row.created_at),
    }));

  return {
    householdsServed: counts?.households_served ?? 0,
    asks: counts?.asks ?? 0,
    slotsPublished: counts?.slots_published ?? 0,
    claims: counts?.claims ?? 0,
    covered: counts?.covered ?? 0,
    unclaimedCalled: counts?.unclaimed_called ?? 0,
    volunteerSeconds: counts?.volunteer_seconds ?? 0,
    coordinator: measureCoordinatorMinutes(actions),
    timeZone: counts?.time_zone ?? "UTC",
  };
}

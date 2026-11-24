import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import { resolveNow } from "../lib/clock";
import * as schema from "./schema";
import {
  buildSeedSessions,
  seedCareRecipients,
  seedCaregivers,
  seedChurch,
  seedFamiliarFaces,
  seedIds,
  seedPeople,
  seedPolicy,
  seedSessionTemplate,
  seedVolunteers,
} from "./seed-data";

/**
 * The deterministic cast, without the CLI.
 *
 * `seed.ts` is the `db:seed` entry point and loads `.env.local`; importing it
 * from a route would drag the CLI's filesystem access into the server bundle.
 * The runtime therefore imports this module, and `seed.ts` re-exports it so
 * existing callers keep a single import path.
 */

export type SeedDb = PostgresJsDatabase<typeof schema> & { $client: Sql };

export type SeedCounts = {
  church: number;
  person: number;
  caregiver: number;
  care_recipient: number;
  volunteer: number;
  familiar_face: number;
  policy: number;
  session_template: number;
  session: number;
  ask: number;
  slot: number;
  notification: number;
  audit_event: number;
};

/**
 * Insert the deterministic demo cast. Every statement uses
 * `ON CONFLICT DO NOTHING` keyed on stable ids, so running the seed twice
 * leaves the same rows. Returns the resulting row counts.
 *
 * The four seeded Respite Mornings are the exception to "insert-only content",
 * and only in where they are computed: they are the next four Tuesdays from
 * `options.now` (the app clock by default), so a fresh seed on any run date
 * gives the construction guard four mornings to offer. The ids never change,
 * and `ON CONFLICT DO NOTHING` means a database seeded on an earlier date keeps
 * its rows; `npm run db:reset` (truncate, reseed, verify) is the way to roll
 * that calendar forward.
 */
export async function seedDatabase(
  db: SeedDb,
  options: { now?: Date } = {},
): Promise<SeedCounts> {
  const now = options.now ?? resolveNow();
  const sessions = buildSeedSessions(now);

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.church)
      .values({
        id: seedChurch.id,
        name: seedChurch.name,
        timezone: seedChurch.timezone,
        demoMode: seedChurch.demoMode,
      })
      .onConflictDoNothing();

    await tx
      .insert(schema.person)
      .values(
        seedPeople.map((p) => ({
          id: p.id,
          churchId: seedIds.church,
          firstName: p.firstName,
          lastName: p.lastName,
          roles: [...p.roles],
          accessToken: p.accessToken,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(schema.caregiver)
      .values(
        seedCaregivers.map((c) => ({
          personId: c.personId,
          phoneNote: c.phoneNote,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(schema.careRecipient)
      .values(
        seedCareRecipients.map((r) => ({
          id: r.id,
          churchId: seedIds.church,
          firstName: r.firstName,
          relation: r.relation,
          createdByCaregiverId: r.createdByCaregiverId,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(schema.volunteer)
      .values(
        seedVolunteers.map((v) => ({
          personId: v.personId,
          driverOk: v.driverOk,
          checklistCompletedAt: v.checklistCompletedAt,
          checklistVersion: v.checklistVersion,
          referencesContacted: v.referencesContacted,
          trainingExpiresOn: v.trainingExpiresOn,
          backgroundRenewsOn: v.backgroundRenewsOn,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(schema.familiarFace)
      .values(
        seedFamiliarFaces.map((f) => ({
          volunteerId: f.volunteerId,
          careRecipientId: f.careRecipientId,
          attestedBy: f.attestedBy,
          attestedAt: f.attestedAt,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(schema.policy)
      .values({
        id: seedPolicy.id,
        churchId: seedIds.church,
        version: seedPolicy.version,
        safeguardingPromises: [...seedPolicy.safeguardingPromises],
        questionSet: seedPolicy.questionSet.map((q) => ({ ...q })),
        crisisScript: seedPolicy.crisisScript,
        localCrisisLine: seedPolicy.localCrisisLine,
        referralResources: seedPolicy.referralResources.map((r) => ({ ...r })),
        familiarFaceDefault: seedPolicy.familiarFaceDefault,
        reminderWindowHours: seedPolicy.reminderWindowHours,
        callThresholdHours: seedPolicy.callThresholdHours,
        callAfterOpenHours: seedPolicy.callAfterOpenHours,
        transportEnabled: seedPolicy.transportEnabled,
        autoPublishLowRisk: seedPolicy.autoPublishLowRisk,
        signedOffBy: seedPolicy.signedOffBy,
        signedOffAt: seedPolicy.signedOffAt,
      })
      .onConflictDoNothing();

    await tx
      .insert(schema.sessionTemplate)
      .values({
        id: seedSessionTemplate.id,
        churchId: seedIds.church,
        weekday: seedSessionTemplate.weekday,
        startTime: seedSessionTemplate.startTime,
        endTime: seedSessionTemplate.endTime,
        capacity: seedSessionTemplate.capacity,
        active: seedSessionTemplate.active,
      })
      .onConflictDoNothing();

    await tx
      .insert(schema.session)
      .values(
        sessions.map((s) => ({
          id: s.id,
          churchId: seedIds.church,
          templateId: seedSessionTemplate.id,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          capacity: s.capacity,
          status: s.status,
        })),
      )
      .onConflictDoNothing();
  });

  return readSeedCounts(db);
}

/** Raw counts for every table the seed touches, in one round trip. */
export async function readSeedCounts(db: SeedDb): Promise<SeedCounts> {
  const [row] = await db.$client<SeedCounts[]>`
    SELECT
      (SELECT COUNT(*)::int FROM church) AS church,
      (SELECT COUNT(*)::int FROM person) AS person,
      (SELECT COUNT(*)::int FROM caregiver) AS caregiver,
      (SELECT COUNT(*)::int FROM care_recipient) AS care_recipient,
      (SELECT COUNT(*)::int FROM volunteer) AS volunteer,
      (SELECT COUNT(*)::int FROM familiar_face) AS familiar_face,
      (SELECT COUNT(*)::int FROM policy) AS policy,
      (SELECT COUNT(*)::int FROM session_template) AS session_template,
      (SELECT COUNT(*)::int FROM session) AS session,
      (SELECT COUNT(*)::int FROM ask) AS ask,
      (SELECT COUNT(*)::int FROM slot) AS slot,
      (SELECT COUNT(*)::int FROM notification) AS notification,
      (SELECT COUNT(*)::int FROM audit_event) AS audit_event
  `;

  return row;
}

export function formatSeedCounts(counts: SeedCounts): string {
  return Object.entries(counts)
    .map(([table, value]) => `${table}=${value}`)
    .join(" ");
}

import type { SeedDb } from "../../../src/db/seed";
import {
  ask,
  careRecipient,
  caregiver,
  church,
  person,
  policy,
  session,
  sessionTemplate,
  slot,
  volunteer,
} from "../../../src/db/schema";

/** Stable ids for the small fixture graph used by schema tests. */
export const FIXTURE = {
  churchId: "c1111111-1111-4111-8111-111111111111",
  coordinatorId: "a1111111-1111-4111-8111-111111111111",
  caregiverId: "a2222222-2222-4222-8222-222222222222",
  volunteerId: "a3333333-3333-4333-8333-333333333333",
  careRecipientId: "f1111111-1111-4111-8111-111111111111",
  policyId: "b1111111-1111-4111-8111-111111111111",
  templateId: "d1111111-1111-4111-8111-111111111111",
  sessionId: "e1111111-1111-4111-8111-111111111111",
  askId: "11111111-2222-4333-8444-555555555555",
  slotId: "22222222-3333-4444-8555-666666666666",
} as const;

/**
 * Insert the minimum graph a schema test needs: one church, one coordinator,
 * one caregiver with a recipient, one volunteer, one policy version.
 */
export async function insertBaseFixtures(db: SeedDb): Promise<void> {
  await db.insert(church).values({
    id: FIXTURE.churchId,
    name: "Fixture Community Church",
    timezone: "America/New_York",
  });

  await db.insert(person).values([
    {
      id: FIXTURE.coordinatorId,
      churchId: FIXTURE.churchId,
      firstName: "Casey",
      lastName: "Coordinator",
      roles: ["coordinator"],
      accessToken: "fixture-coordinator",
    },
    {
      id: FIXTURE.caregiverId,
      churchId: FIXTURE.churchId,
      firstName: "Marta",
      lastName: "Fixture",
      roles: ["caregiver"],
      accessToken: "fixture-caregiver",
    },
    {
      id: FIXTURE.volunteerId,
      churchId: FIXTURE.churchId,
      firstName: "Ruth",
      lastName: "Fixture",
      roles: ["volunteer"],
      accessToken: "fixture-volunteer",
    },
  ]);

  await db.insert(caregiver).values({ personId: FIXTURE.caregiverId });

  await db.insert(careRecipient).values({
    id: FIXTURE.careRecipientId,
    churchId: FIXTURE.churchId,
    firstName: "Elena",
    relation: "mother",
    createdByCaregiverId: FIXTURE.caregiverId,
  });

  await db.insert(volunteer).values({ personId: FIXTURE.volunteerId });

  await db.insert(policy).values({
    id: FIXTURE.policyId,
    churchId: FIXTURE.churchId,
    version: 1,
    crisisScript: "For crisis support, call or text 988.",
    questionSet: [],
  });
}

export async function insertAsk(db: SeedDb): Promise<void> {
  await db.insert(ask).values({
    id: FIXTURE.askId,
    churchId: FIXTURE.churchId,
    caregiverId: FIXTURE.caregiverId,
    careRecipientId: FIXTURE.careRecipientId,
    verbatimText: "The weeks are long and I need a few quiet hours.",
    status: "waiting_coordinator",
    policyVersionId: FIXTURE.policyId,
  });
}

export async function insertSessionTemplate(db: SeedDb): Promise<void> {
  await db.insert(sessionTemplate).values({
    id: FIXTURE.templateId,
    churchId: FIXTURE.churchId,
    weekday: 2,
    startTime: "10:00:00",
    endTime: "14:00:00",
    capacity: 12,
  });
}

export async function insertSession(db: SeedDb): Promise<void> {
  await db.insert(session).values({
    id: FIXTURE.sessionId,
    churchId: FIXTURE.churchId,
    templateId: FIXTURE.templateId,
    startsAt: new Date("2026-12-01T15:00:00.000Z"),
    endsAt: new Date("2026-12-01T19:00:00.000Z"),
    capacity: 12,
    status: "scheduled",
  });
}

export async function insertSlot(
  db: SeedDb,
  status: "draft" | "open" | "claimed" | "covered" | "done" | "cancelled" | "expired_unclaimed",
): Promise<void> {
  const claimed =
    status === "claimed" || status === "covered" || status === "done";
  const confirmed = status === "covered" || status === "done";

  await db.insert(slot).values({
    id: FIXTURE.slotId,
    askId: FIXTURE.askId,
    churchId: FIXTURE.churchId,
    sessionId: null,
    kind: "companion",
    tier: "public_event",
    label: "Companion place at Respite Morning",
    status,
    claimedBy: claimed ? FIXTURE.volunteerId : null,
    claimedAt: claimed ? new Date("2026-11-20T15:00:00.000Z") : null,
    claimConfirmedBy: confirmed ? FIXTURE.coordinatorId : null,
    claimConfirmedAt: confirmed
      ? new Date("2026-11-20T16:00:00.000Z")
      : null,
  });
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { seedIds } from "../../src/db/seed-data";
import { ask, auditEvent, callLog, slot } from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import { parseMetricsRange } from "../../src/server/domain/metrics";
import {
  getChurchMetrics,
  getChurchTimeZone,
} from "../../src/server/repositories/metrics";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-METRICS-001 and -002 at the database boundary.
 *
 * A fixture church month with a covered time, a claimed-and-covered time, an
 * open time with two calls, a draft time, and a time outside the range. Every
 * number on the page is checked against an independently written SQL query for
 * the same range, and the coordinator minutes are checked against the audit
 * instants by hand. A narrower range proves the bounds are real. Non-desk
 * roles are refused; the pastor may read; another church sees zero.
 */

const GRACE: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: seedIds.church,
};

const DANIEL: Actor = {
  personId: seedIds.people.daniel,
  role: "deputy",
  churchId: seedIds.church,
};

const MARTA: Actor = {
  personId: seedIds.people.marta,
  role: "caregiver",
  churchId: seedIds.church,
};

const RUTH: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: seedIds.church,
};

const PASTOR: Actor = {
  personId: seedIds.people.grace,
  role: "pastor",
  churchId: seedIds.church,
};

const FOREIGN_COORDINATOR: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: "c9999999-9999-4999-8999-999999999999",
};

const RANGE = parseMetricsRange(
  { from: "2026-11-01", to: "2026-11-30" },
  { timeZone: "America/New_York", now: new Date("2026-12-01T15:00:00.000Z") },
);

const NARROW_RANGE = parseMetricsRange(
  { from: "2026-11-09", to: "2026-11-12" },
  { timeZone: "America/New_York", now: new Date("2026-12-01T15:00:00.000Z") },
);

const ASK_A = "f1000000-0000-4000-8000-000000000001";
const ASK_B = "f1000000-0000-4000-8000-000000000002";
const ASK_DRAFT = "f1000000-0000-4000-8000-000000000003";
const ASK_OUTSIDE = "f1000000-0000-4000-8000-000000000004";

const SLOT_COVERED_A = "f2000000-0000-4000-8000-000000000001";
const SLOT_COVERED_B = "f2000000-0000-4000-8000-000000000002";
const SLOT_OPEN_A = "f2000000-0000-4000-8000-000000000003";
const SLOT_DRAFT_B = "f2000000-0000-4000-8000-000000000004";
const SLOT_OUTSIDE = "f2000000-0000-4000-8000-000000000005";

function at(value: string): Date {
  return new Date(value);
}

async function insertFixture(t: TestDatabase): Promise<void> {
  await t.db.insert(ask).values([
    {
      id: ASK_A,
      churchId: seedIds.church,
      caregiverId: seedIds.people.marta,
      careRecipientId: seedIds.careRecipients.elena,
      verbatimText: "A fixture ask for the metrics test.",
      status: "approved",
      policyVersionId: seedIds.policyV1,
      createdAt: at("2026-11-05T15:00:00.000Z"),
    },
    {
      id: ASK_B,
      churchId: seedIds.church,
      caregiverId: seedIds.people.priya,
      careRecipientId: seedIds.careRecipients.mrRao,
      verbatimText: "A second fixture ask for the metrics test.",
      status: "approved",
      policyVersionId: seedIds.policyV1,
      createdAt: at("2026-11-06T16:00:00.000Z"),
    },
    {
      id: ASK_DRAFT,
      churchId: seedIds.church,
      caregiverId: seedIds.people.marta,
      careRecipientId: seedIds.careRecipients.elena,
      verbatimText: "A draft that was never received.",
      status: "draft",
      policyVersionId: seedIds.policyV1,
      createdAt: at("2026-11-07T15:00:00.000Z"),
    },
    {
      id: ASK_OUTSIDE,
      churchId: seedIds.church,
      caregiverId: seedIds.people.priya,
      careRecipientId: seedIds.careRecipients.mrRao,
      verbatimText: "An ask from last month.",
      status: "approved",
      policyVersionId: seedIds.policyV1,
      createdAt: at("2026-10-20T15:00:00.000Z"),
    },
  ]);

  await t.db.insert(slot).values([
    {
      id: SLOT_COVERED_A,
      askId: ASK_A,
      churchId: seedIds.church,
      kind: "companion",
      tier: "public_event",
      label: "Companion place at Respite Morning",
      windowStart: at("2026-11-15T15:00:00.000Z"),
      windowEnd: at("2026-11-15T19:00:00.000Z"),
      status: "covered",
      claimedBy: seedIds.people.ruth,
      claimedAt: at("2026-11-09T15:00:00.000Z"),
      approvedBy: seedIds.people.grace,
      approvedAt: at("2026-11-08T15:00:00.000Z"),
      claimConfirmedBy: seedIds.people.grace,
      claimConfirmedAt: at("2026-11-10T15:00:00.000Z"),
    },
    {
      id: SLOT_COVERED_B,
      askId: ASK_B,
      churchId: seedIds.church,
      kind: "meal",
      tier: "doorstep",
      label: "A reheatable meal",
      windowStart: at("2026-11-16T15:00:00.000Z"),
      windowEnd: at("2026-11-16T17:00:00.000Z"),
      status: "covered",
      claimedBy: seedIds.people.sara,
      claimedAt: at("2026-11-11T15:00:00.000Z"),
      approvedBy: seedIds.people.grace,
      approvedAt: at("2026-11-08T16:00:00.000Z"),
      claimConfirmedBy: seedIds.people.grace,
      claimConfirmedAt: at("2026-11-12T15:00:00.000Z"),
    },
    {
      id: SLOT_OPEN_A,
      askId: ASK_A,
      churchId: seedIds.church,
      kind: "home",
      tier: "in_home",
      label: "A Saturday morning at home",
      windowStart: at("2026-11-20T15:00:00.000Z"),
      windowEnd: at("2026-11-20T17:00:00.000Z"),
      status: "open",
      approvedBy: seedIds.people.grace,
      approvedAt: at("2026-11-08T17:00:00.000Z"),
    },
    {
      id: SLOT_DRAFT_B,
      askId: ASK_B,
      churchId: seedIds.church,
      kind: "errand",
      tier: "doorstep",
      label: "An errand",
      windowStart: at("2026-11-21T15:00:00.000Z"),
      windowEnd: at("2026-11-21T17:00:00.000Z"),
      status: "draft",
      approvedBy: null,
      approvedAt: null,
    },
    {
      id: SLOT_OUTSIDE,
      askId: ASK_OUTSIDE,
      churchId: seedIds.church,
      kind: "companion",
      tier: "public_event",
      label: "A companion place last month",
      windowStart: at("2026-10-25T14:00:00.000Z"),
      windowEnd: at("2026-10-25T18:00:00.000Z"),
      status: "covered",
      claimedBy: seedIds.people.tom,
      claimedAt: at("2026-10-22T15:00:00.000Z"),
      approvedBy: seedIds.people.grace,
      approvedAt: at("2026-10-21T15:00:00.000Z"),
      claimConfirmedBy: seedIds.people.grace,
      claimConfirmedAt: at("2026-10-23T15:00:00.000Z"),
    },
  ]);

  await t.db.insert(callLog).values([
    {
      slotId: SLOT_OPEN_A,
      coordinatorId: seedIds.people.grace,
      outcome: "left_message",
      note: "Left a message with the family.",
      createdAt: at("2026-11-14T15:00:00.000Z"),
    },
    {
      slotId: SLOT_OPEN_A,
      coordinatorId: seedIds.people.grace,
      outcome: "reached",
      note: "Reached them on the second try.",
      createdAt: at("2026-11-14T18:00:00.000Z"),
    },
  ]);

  await t.db.insert(auditEvent).values([
    // Ask A: three coordinator actions — 15:00, 15:05, 15:40 — so only the
    // first gap is inside the 20-minute cap.
    {
      churchId: seedIds.church,
      actorType: "human",
      actorId: seedIds.people.grace,
      action: "ask_submitted",
      entity: "ask",
      entityId: ASK_A,
      detail: {},
      createdAt: at("2026-11-05T15:00:00.000Z"),
    },
    {
      churchId: seedIds.church,
      actorType: "human",
      actorId: seedIds.people.grace,
      action: "ask_approved",
      entity: "ask",
      entityId: ASK_A,
      detail: {},
      createdAt: at("2026-11-05T15:05:00.000Z"),
    },
    {
      churchId: seedIds.church,
      actorType: "human",
      actorId: seedIds.people.grace,
      action: "draft_slot_edited",
      entity: "slot",
      entityId: SLOT_OPEN_A,
      detail: {},
      createdAt: at("2026-11-05T15:40:00.000Z"),
    },
    // Ask B: Daniel's ask action and his slot action map to the same request,
    // four minutes apart.
    {
      churchId: seedIds.church,
      actorType: "human",
      actorId: seedIds.people.daniel,
      action: "ask_approved",
      entity: "ask",
      entityId: ASK_B,
      detail: {},
      createdAt: at("2026-11-06T16:00:00.000Z"),
    },
    {
      churchId: seedIds.church,
      actorType: "human",
      actorId: seedIds.people.daniel,
      action: "draft_slot_edited",
      entity: "slot",
      entityId: SLOT_COVERED_B,
      detail: {},
      createdAt: at("2026-11-06T16:04:00.000Z"),
    },
    // Not desk work, and must not add a minute:
    {
      churchId: seedIds.church,
      actorType: "human",
      actorId: seedIds.people.marta,
      action: "ask_submitted",
      entity: "ask",
      entityId: ASK_A,
      detail: {},
      createdAt: at("2026-11-05T15:02:00.000Z"),
    },
    {
      churchId: seedIds.church,
      actorType: "ai",
      actorId: null,
      action: "ai_decision",
      entity: "ask",
      entityId: ASK_A,
      detail: { inputDigest: "b".repeat(64) },
      createdAt: at("2026-11-05T15:03:00.000Z"),
    },
    {
      churchId: seedIds.church,
      actorType: "human",
      actorId: seedIds.people.ruth,
      action: "slot_claimed",
      entity: "slot",
      entityId: SLOT_COVERED_A,
      detail: {},
      createdAt: at("2026-11-05T15:04:00.000Z"),
    },
    {
      churchId: seedIds.church,
      actorType: "system",
      actorId: null,
      action: "slots_proposed",
      entity: "ask",
      entityId: ASK_A,
      detail: {},
      createdAt: at("2026-11-05T15:01:00.000Z"),
    },
  ]);
}

describe("the church's numbers for a stated range", () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await openTestDatabase();
  });

  afterAll(async () => {
    await t.client.end();
  });

  beforeEach(async () => {
    await truncateAll(t.db);
    await seedDatabase(t.db);
    await insertFixture(t);
  });

  it("matches an independent SQL cross-check for every number", async () => {
    const metrics = await getChurchMetrics(GRACE, RANGE, t.db);

    const [counts] = await t.client<{
      households_served: number;
      asks: number;
      slots_published: number;
      claims: number;
      covered: number;
      unclaimed_called: number;
      volunteer_seconds: number;
    }[]>`
      SELECT
        (
          SELECT count(DISTINCT a.caregiver_id)::int
            FROM slot s
            JOIN ask a ON a.id = s.ask_id
           WHERE s.church_id = ${seedIds.church}::uuid
             AND s.status IN ('covered', 'done')
             AND s.window_start >= ${RANGE.start.toISOString()}::timestamptz
             AND s.window_start < ${RANGE.endExclusive.toISOString()}::timestamptz
        ) AS households_served,
        (
          SELECT count(*)::int FROM ask a
           WHERE a.church_id = ${seedIds.church}::uuid
             AND a.status <> 'draft'
             AND a.created_at >= ${RANGE.start.toISOString()}::timestamptz
             AND a.created_at < ${RANGE.endExclusive.toISOString()}::timestamptz
        ) AS asks,
        (
          SELECT count(*)::int FROM slot s
           WHERE s.church_id = ${seedIds.church}::uuid
             AND s.approved_at >= ${RANGE.start.toISOString()}::timestamptz
             AND s.approved_at < ${RANGE.endExclusive.toISOString()}::timestamptz
        ) AS slots_published,
        (
          SELECT count(*)::int FROM slot s
           WHERE s.church_id = ${seedIds.church}::uuid
             AND s.claimed_at >= ${RANGE.start.toISOString()}::timestamptz
             AND s.claimed_at < ${RANGE.endExclusive.toISOString()}::timestamptz
        ) AS claims,
        (
          SELECT count(*)::int FROM slot s
           WHERE s.church_id = ${seedIds.church}::uuid
             AND s.claim_confirmed_at >= ${RANGE.start.toISOString()}::timestamptz
             AND s.claim_confirmed_at < ${RANGE.endExclusive.toISOString()}::timestamptz
        ) AS covered,
        (
          SELECT count(DISTINCT c.slot_id)::int
            FROM call_log c
            JOIN slot s ON s.id = c.slot_id
           WHERE s.church_id = ${seedIds.church}::uuid
             AND c.created_at >= ${RANGE.start.toISOString()}::timestamptz
             AND c.created_at < ${RANGE.endExclusive.toISOString()}::timestamptz
        ) AS unclaimed_called,
        (
          SELECT COALESCE(sum(EXTRACT(EPOCH FROM (s.window_end - s.window_start))), 0)::int
            FROM slot s
           WHERE s.church_id = ${seedIds.church}::uuid
             AND s.status IN ('claimed', 'covered', 'done')
             AND s.window_start >= ${RANGE.start.toISOString()}::timestamptz
             AND s.window_start < ${RANGE.endExclusive.toISOString()}::timestamptz
             AND s.window_end IS NOT NULL
        ) AS volunteer_seconds
    `;

    expect(metrics.householdsServed).toBe(counts.households_served);
    expect(metrics.asks).toBe(counts.asks);
    expect(metrics.slotsPublished).toBe(counts.slots_published);
    expect(metrics.claims).toBe(counts.claims);
    expect(metrics.covered).toBe(counts.covered);
    expect(metrics.unclaimedCalled).toBe(counts.unclaimed_called);
    expect(metrics.volunteerSeconds).toBe(counts.volunteer_seconds);

    // And the fixture's intended numbers, for a reader of this test.
    expect(metrics.householdsServed).toBe(2);
    expect(metrics.asks).toBe(2);
    expect(metrics.slotsPublished).toBe(3);
    expect(metrics.claims).toBe(2);
    expect(metrics.covered).toBe(2);
    expect(metrics.unclaimedCalled).toBe(1);
    expect(metrics.volunteerSeconds).toBe(6 * 3_600);
    expect(metrics.timeZone).toBe("America/New_York");
  });

  it("measures coordinator minutes from the audit timestamps, not a guess", async () => {
    const metrics = await getChurchMetrics(GRACE, RANGE, t.db);

    // Ask A: 15:00 → 15:05 counts 5; 15:05 → 15:40 is a 35-minute pause.
    // Ask B: 16:00 → 16:04 counts 4, across an ask event and a slot event.
    // The caregiver, volunteer, AI, and system rows add nothing.
    expect(metrics.coordinator.totalMinutes).toBe(9);
    expect(metrics.coordinator.averageMinutes).toBe(4.5);
    expect(metrics.coordinator.requestsWithIntervals).toBe(2);
    expect(metrics.coordinator.requestsMeasured).toBe(2);
    expect(metrics.coordinator.actionsCounted).toBe(5);
    expect(metrics.coordinator.gapCapMinutes).toBe(20);
  });

  it("changes when the range changes, and excludes a draft and an older month", async () => {
    const narrow = await getChurchMetrics(GRACE, NARROW_RANGE, t.db);

    expect(narrow.asks).toBe(0);
    expect(narrow.slotsPublished).toBe(0);
    expect(narrow.claims).toBe(2);
    expect(narrow.covered).toBe(2);
    expect(narrow.unclaimedCalled).toBe(0);
    expect(narrow.householdsServed).toBe(0);
    expect(narrow.volunteerSeconds).toBe(0);
    expect(narrow.coordinator.totalMinutes).toBe(0);
    expect(narrow.coordinator.averageMinutes).toBeNull();
  });

  it("lets the pastor read the same numbers and refuses a caregiver or volunteer", async () => {
    const coordinator = await getChurchMetrics(GRACE, RANGE, t.db);
    const deputy = await getChurchMetrics(DANIEL, RANGE, t.db);
    const pastor = await getChurchMetrics(PASTOR, RANGE, t.db);

    expect(deputy).toEqual(coordinator);
    expect(pastor).toEqual(coordinator);

    await expect(
      getChurchMetrics(MARTA, RANGE, t.db),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      getChurchMetrics(RUTH, RANGE, t.db),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      getChurchTimeZone(MARTA, t.db),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("gives another church zero and falls back to UTC when its row is absent", async () => {
    const foreign = await getChurchMetrics(
      FOREIGN_COORDINATOR,
      RANGE,
      t.db,
    );

    expect(foreign.householdsServed).toBe(0);
    expect(foreign.asks).toBe(0);
    expect(foreign.slotsPublished).toBe(0);
    expect(foreign.claims).toBe(0);
    expect(foreign.covered).toBe(0);
    expect(foreign.unclaimedCalled).toBe(0);
    expect(foreign.volunteerSeconds).toBe(0);
    expect(foreign.coordinator.totalMinutes).toBe(0);
    expect(foreign.timeZone).toBe("UTC");
  });
});

import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import {
  SEED_REFERENCE_DATE,
  seedCrisisScript,
  seedIds,
  seedLocalCrisisLine,
  seedQuestionSet,
  seedReferralResources,
  seedSafeguardingPromises,
} from "../../src/db/seed-data";
import {
  absenceProof,
  ask,
  askRevision,
  auditEvent,
  callLog,
  decision,
  notification,
  session,
  slot,
} from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import {
  ABSENCE_PROOF_QUERY_TEXT,
  coverageMessageCountLine,
} from "../../src/server/domain/coverage";
import { computeAbsenceProofDigest } from "../../src/server/domain/absence-proof";
import type { TypedAnswer } from "../../src/server/domain/slots";
import { approveClaim } from "../../src/server/repositories/claim-review";
import { claimSlot } from "../../src/server/repositories/claims";
import {
  expireSlotUnclaimed,
  getDeskSlotCoverage,
  listCaregiverWorkingLines,
  listCoverageWatch,
  recordCoverageCall,
  reofferSlot,
} from "../../src/server/repositories/coverage";
import { writeReminder } from "../../src/server/repositories/reminders";
import { createPolicyVersion } from "../../src/server/repositories/policy";
import { approveAskForCoordinator } from "../../src/server/services/ask-review";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { constructDraftSlots } from "../../src/server/services/slot-construction";
import {
  expectRejection,
  openTestDatabase,
  type TestDatabase,
} from "./helpers/db";

/**
 * VAL-FAILURE-001 through -006 at the database boundary, plus VAL-CROSS-002's
 * zero-row proof.
 *
 * The fixture is deliberately not empty: one companion time is covered and has
 * both a confirmation and a reminder in the outbox, so the absence on the open
 * time proves the pipeline can send and chose not to. A call persists its
 * actor, instant, outcome, and note. Expiry writes `absence_proof` with a live
 * zero and the query text, refuses loudly when any notification row exists,
 * and closes the ask when this was its last live time. No path writes a
 * caregiver notification for an unclaimed time.
 */

const NOW = SEED_REFERENCE_DATE; // Tuesday 17 November 2026, 10:00 in New York
const CONFIRMED_AT = new Date("2026-11-18T15:00:00.000Z");
const COMPANION_START = new Date("2026-11-24T15:00:00.000Z");
const IN_WINDOW = new Date("2026-11-24T13:00:00.000Z");
const CALLED_AT = new Date("2026-11-19T16:30:00.000Z");
const REOFFERED_AT = new Date("2026-11-19T17:00:00.000Z");

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

const PRIYA: Actor = {
  personId: seedIds.people.priya,
  role: "caregiver",
  churchId: seedIds.church,
};

const RUTH: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: seedIds.church,
};

const FOREIGN_COORDINATOR: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: "c9999999-9999-4999-8999-999999999999",
};

const HERO_TEXT =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

function answer(questionId: string, value: unknown): TypedAnswer {
  return { questionId, answer: value, abstained: false };
}

const HERO_ANSWERS: TypedAnswer[] = [
  answer("Q1", true),
  answer("Q2", false),
  answer("Q3", false),
  answer("Q4", "saturday"),
  answer("Q5", false),
  answer("Q6", true),
  answer("Q7", "unknown"),
  answer("Q8", false),
  answer("Q9", false),
];

function isPick(questionId: string): boolean {
  return questionId === "Q4" || questionId === "Q7";
}

async function insertAskWithAnswers(t: TestDatabase): Promise<string> {
  const askId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();

  await t.db.insert(ask).values({
    id: askId,
    churchId: seedIds.church,
    caregiverId: seedIds.people.marta,
    careRecipientId: seedIds.careRecipients.elena,
    verbatimText: HERO_TEXT,
    status: "waiting_coordinator",
    policyVersionId: seedIds.policyV1,
  });

  await t.db.insert(askRevision).values({
    id: revisionId,
    askId,
    verbatimText: HERO_TEXT,
    digest: sha256Hex(HERO_TEXT),
  });

  await t.db.insert(decision).values(
    HERO_ANSWERS.map((entry, index) => ({
      askId,
      askRevisionId: revisionId,
      policyVersionId: seedIds.policyV1,
      questionId: entry.questionId,
      questionText: `Question ${entry.questionId}`,
      answerType: isPick(entry.questionId)
        ? ("pick" as const)
        : ("yesno" as const),
      answer: entry.answer as boolean | string,
      confidence: 0.92,
      abstained: entry.abstained,
      samples: null,
      model: "fake-typed-v1",
      provider: "deterministic",
      latencyMs: 14,
      digest: sha256Hex(`${askId}:${entry.questionId}:${index}`),
    })),
  );

  return askId;
}

type PublishedAsk = {
  askId: string;
  companionId: string;
  homeId: string;
};

/** A real ask, constructed by plain code and published by Grace. */
async function publishedAsk(t: TestDatabase): Promise<PublishedAsk> {
  const askId = await insertAskWithAnswers(t);

  const built = await constructDraftSlots({
    askId,
    churchId: seedIds.church,
    database: t.db,
    now: NOW,
  });
  if (built.reason !== "created") {
    throw new Error(`expected drafts, got ${built.reason}`);
  }

  const approved = await approveAskForCoordinator(GRACE, askId, t.db, NOW);
  if (!approved.ok) throw new Error(approved.message);

  const rows = await t.db
    .select({ id: slot.id, kind: slot.kind })
    .from(slot)
    .where(eq(slot.askId, askId));

  const companion = rows.find((row) => row.kind === "companion");
  const home = rows.find((row) => row.kind === "home");
  if (!companion || !home) throw new Error("expected companion and home");

  return { askId, companionId: companion.id, homeId: home.id };
}

async function claimAndConfirm(
  t: TestDatabase,
  slotId: string,
): Promise<void> {
  const claimed = await claimSlot(RUTH, slotId, t.db, NOW);
  if (!claimed.ok) throw new Error(claimed.message);

  const confirmed = await approveClaim(GRACE, slotId, t.db, CONFIRMED_AT);
  if (!confirmed.ok) throw new Error(confirmed.message);
}

async function notificationRows(t: TestDatabase, slotId: string) {
  return t.db
    .select()
    .from(notification)
    .where(eq(notification.slotId, slotId));
}

async function notificationCount(
  t: TestDatabase,
  slotId: string,
): Promise<number> {
  const rows = await notificationRows(t, slotId);
  return rows.length;
}

async function absenceProofRows(t: TestDatabase, slotId: string) {
  return t.db
    .select()
    .from(absenceProof)
    .where(eq(absenceProof.slotId, slotId));
}

/**
 * The documented recipe, rebuilt here from the published format rather than
 * calling the implementation. If either the documentation or the canonical
 * string drifts, this recomputation stops matching the stored digest.
 */
function recomputeAbsenceProofDigestFromRow(row: {
  slotId: string;
  caregiverOutboxCount: number;
  queryText: string;
  createdAt: Date;
}): string {
  return createHash("sha256")
    .update(
      [
        "absence-proof/v1",
        `slot_id:${row.slotId.toLowerCase()}`,
        `caregiver_outbox_count:${row.caregiverOutboxCount}`,
        `generated_at:${row.createdAt.toISOString()}`,
        "query_text:",
        row.queryText,
      ].join("\n"),
      "utf8",
    )
    .digest("hex");
}

async function auditRows(
  t: TestDatabase,
  slotId: string,
  actions: string[],
) {
  return t.db
    .select({
      action: auditEvent.action,
      actorId: auditEvent.actorId,
      detail: auditEvent.detail,
      createdAt: auditEvent.createdAt,
    })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.entity, "slot"),
        eq(auditEvent.entityId, slotId),
        inArray(auditEvent.action, actions),
      ),
    )
    .orderBy(auditEvent.createdAt, auditEvent.id);
}

/** Put a published time inside the 48-hour call threshold. */
async function makeAtRisk(
  t: TestDatabase,
  slotId: string,
  start: Date,
  end: Date,
): Promise<void> {
  await t.db
    .update(slot)
    .set({
      windowStart: start,
      windowEnd: end,
      approvedAt: NOW,
      approvedBy: seedIds.people.grace,
    })
    .where(eq(slot.id, slotId));
}

async function askStatus(t: TestDatabase, askId: string): Promise<string> {
  const [row] = await t.db
    .select({ status: ask.status })
    .from(ask)
    .where(eq(ask.id, askId))
    .limit(1);
  return row?.status ?? "missing";
}

describe("the coverage watch and the failure-path proof", () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await openTestDatabase();
  });

  afterAll(async () => {
    await t.client.end();
  });

  beforeEach(async () => {
    await truncateAll(t.db);
    await seedDatabase(t.db, { now: NOW });
  });

  it("lists a published time past the threshold with a live zero count", async () => {
    const { askId, companionId, homeId } = await publishedAsk(t);

    // The proof is not vacuous: this church has already sent one family a
    // confirmation and a reminder for a covered time in the same fixture.
    await claimAndConfirm(t, companionId);
    const reminder = await writeReminder(GRACE, companionId, t.db, IN_WINDOW);
    expect(reminder.ok).toBe(true);
    expect(await notificationCount(t, companionId)).toBe(2);
    expect(await notificationCount(t, homeId)).toBe(0);

    // The home time starts in 12 hours, inside the 48-hour threshold.
    const start = new Date(NOW.getTime() + 12 * 3_600_000);
    const end = new Date(start.getTime() + 2 * 3_600_000);
    await makeAtRisk(t, homeId, start, end);

    const items = await listCoverageWatch(GRACE, t.db, NOW);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.slotId).toBe(homeId);
    expect(item.askId).toBe(askId);
    expect(item.kind).toBe("home");
    expect(item.caregiverFirstName).toBe("Marta");
    expect(item.careRecipientFirstName).toBe("Elena");
    expect(item.windowStart).toEqual(start);
    expect(item.windowEnd).toEqual(end);
    expect(item.openForLabel).toMatch(/hour|day/);
    expect(item.caregiverOutboxCount).toBe(0);
    expect(item.churchOutboxCount).toBe(2);
    expect(item.isDue).toBe(true);
    expect(item.calls).toHaveLength(0);
    expect(item.reofferCount).toBe(0);
    expect(item.absenceProof).toBeNull();
    expect(coverageMessageCountLine(item.caregiverOutboxCount)).toBe(
      "Messages sent to the caregiver about this slot: 0",
    );

    const card = await getDeskSlotCoverage(GRACE, homeId, t.db, NOW);
    expect(card).not.toBeNull();
    expect(card?.caregiverOutboxCount).toBe(0);
    expect(card?.canExpire).toBe(true);
    expect(card?.canReoffer).toBe(false);
    expect(card?.reofferRefusal).toMatch(/call/i);

    // A far time with a fresh publication is not in the watch yet.
    await makeAtRisk(
      t,
      homeId,
      new Date(NOW.getTime() + 72 * 3_600_000),
      new Date(NOW.getTime() + 74 * 3_600_000),
    );
    expect(await listCoverageWatch(GRACE, t.db, NOW)).toHaveLength(0);
    expect(
      await listCoverageWatch(
        GRACE,
        t.db,
        new Date(NOW.getTime() + 25 * 3_600_000),
      ),
    ).toHaveLength(1);

    // A deputy sees the same church's watch; a caregiver, a volunteer, and a
    // foreign coordinator get nothing or a refusal.
    await makeAtRisk(t, homeId, start, end);
    expect(await listCoverageWatch(DANIEL, t.db, NOW)).toHaveLength(1);
    await expect(listCoverageWatch(MARTA, t.db, NOW)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(
      getDeskSlotCoverage(RUTH, homeId, t.db, NOW),
    ).rejects.toBeInstanceOf(AuthError);
    expect(await listCoverageWatch(FOREIGN_COORDINATOR, t.db, NOW)).toEqual(
      [],
    );
    expect(
      await getDeskSlotCoverage(FOREIGN_COORDINATOR, homeId, t.db, NOW),
    ).toBeNull();
  });

  it("reads the publication clock from the signed policy, not from a constant", async () => {
    const { companionId } = await publishedAsk(t);
    const afterADay = new Date(NOW.getTime() + 25 * 3_600_000);

    const byDefault = await getDeskSlotCoverage(
      GRACE,
      companionId,
      t.db,
      afterADay,
    );
    expect(byDefault?.openAfterHours).toBe(24);
    expect(byDefault?.thresholdHours).toBe(48);
    expect(byDefault?.isDue).toBe(true);

    // A signed version with a longer publication clock gives the church more
    // time on the board before a person is called. The next read must use it.
    await createPolicyVersion(
      GRACE,
      {
        safeguardingPromises: [...seedSafeguardingPromises],
        questionSet: seedQuestionSet.map((question) => ({ ...question })),
        crisisScript: seedCrisisScript,
        localCrisisLine: seedLocalCrisisLine,
        referralResources: seedReferralResources.map((resource) => ({
          ...resource,
        })),
        reminderWindowHours: 24,
        callThresholdHours: 48,
        callAfterOpenHours: 72,
        signedOffBy: "Grace Whitfield",
      },
      t.db,
    );

    const byPolicy = await getDeskSlotCoverage(
      GRACE,
      companionId,
      t.db,
      afterADay,
    );
    expect(byPolicy?.openAfterHours).toBe(72);
    expect(byPolicy?.isDue).toBe(false);
    expect(byPolicy?.dueAt.toISOString()).toBe(
      new Date(NOW.getTime() + 72 * 3_600_000).toISOString(),
    );

    const later = await getDeskSlotCoverage(
      GRACE,
      companionId,
      t.db,
      new Date(NOW.getTime() + 73 * 3_600_000),
    );
    expect(later?.isDue).toBe(true);
  });

  it("records the call with actor, timestamp, outcome, and note and sends nothing", async () => {
    const { homeId } = await publishedAsk(t);
    const start = new Date(NOW.getTime() + 12 * 3_600_000);
    await makeAtRisk(t, homeId, start, new Date(start.getTime() + 2 * 3_600_000));

    const note = "  Left a message with her neighbour. Try again after six.\r\nShe has the number.  ";

    const outcome = await recordCoverageCall(
      GRACE,
      homeId,
      { outcome: "left_message", note },
      t.db,
      CALLED_AT,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.outcome).toBe("left_message");
    expect(outcome.message.toLowerCase()).toMatch(/call|recorded/i);

    const calls = await t.db
      .select()
      .from(callLog)
      .where(eq(callLog.slotId, homeId));
    expect(calls).toHaveLength(1);
    expect(calls[0].coordinatorId).toBe(seedIds.people.grace);
    expect(calls[0].outcome).toBe("left_message");
    expect(calls[0].note).toBe(
      "  Left a message with her neighbour. Try again after six.\nShe has the number.  ",
    );
    expect(calls[0].createdAt).toEqual(CALLED_AT);

    const audits = await auditRows(t, homeId, ["coverage_call_logged"]);
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe(seedIds.people.grace);
    expect(audits[0].detail).toMatchObject({
      outcome: "left_message",
      callId: calls[0].id,
    });

    // The count is still zero: a call is not a message.
    expect(await notificationCount(t, homeId)).toBe(0);

    const card = await getDeskSlotCoverage(GRACE, homeId, t.db, NOW);
    expect(card?.calls).toHaveLength(1);
    expect(card?.calls[0]).toMatchObject({
      outcome: "left_message",
      coordinatorFirstName: "Grace",
      note: calls[0].note,
    });

    const invalid = await recordCoverageCall(
      GRACE,
      homeId,
      { outcome: "declined", note: "" },
      t.db,
      CALLED_AT,
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.code).toBe("invalid_outcome");
    expect(
      await t.db.select({ id: callLog.id }).from(callLog).where(eq(callLog.slotId, homeId)),
    ).toHaveLength(1);

    await expect(
      recordCoverageCall(
        MARTA,
        homeId,
        { outcome: "reached", note: "" },
        t.db,
        CALLED_AT,
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("re-offers a time at most once and only after a logged call", async () => {
    const { companionId, homeId } = await publishedAsk(t);
    const start = new Date(NOW.getTime() + 12 * 3_600_000);
    await makeAtRisk(t, homeId, start, new Date(start.getTime() + 2 * 3_600_000));

    const before = await reofferSlot(GRACE, homeId, t.db, REOFFERED_AT);
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.code).toBe("needs_call");

    const call = await recordCoverageCall(
      GRACE,
      homeId,
      { outcome: "try_later", note: "She asked for a call next week." },
      t.db,
      CALLED_AT,
    );
    expect(call.ok).toBe(true);

    const offered = await reofferSlot(GRACE, homeId, t.db, REOFFERED_AT);
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    expect(offered.windowStart.getTime()).toBeGreaterThan(start.getTime());
    expect(offered.windowStart.getTime()).toBeGreaterThanOrEqual(
      REOFFERED_AT.getTime() + 24 * 3_600_000,
    );

    const [row] = await t.db
      .select({
        status: slot.status,
        windowStart: slot.windowStart,
        windowEnd: slot.windowEnd,
        approvedAt: slot.approvedAt,
        approvedBy: slot.approvedBy,
      })
      .from(slot)
      .where(eq(slot.id, homeId))
      .limit(1);
    expect(row.status).toBe("open");
    expect(row.windowStart).toEqual(offered.windowStart);
    expect(row.approvedAt).toEqual(REOFFERED_AT);
    expect(row.approvedBy).toBe(seedIds.people.grace);

    const audits = await auditRows(t, homeId, ["slot_reoffered"]);
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({
      reason: "after_call",
      callId: call.ok ? call.callId : null,
    });

    const second = await reofferSlot(GRACE, homeId, t.db, REOFFERED_AT);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("already_reoffered");

    // A session-linked companion time moves to the next real morning, not an
    // invented instant.
    const companionCall = await recordCoverageCall(
      GRACE,
      companionId,
      { outcome: "reached", note: "" },
      t.db,
      CALLED_AT,
    );
    expect(companionCall.ok).toBe(true);

    const sessions = await t.db
      .select({
        id: session.id,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
      })
      .from(session)
      .orderBy(session.startsAt);
    expect(sessions.length).toBeGreaterThanOrEqual(2);

    const companionOffer = await reofferSlot(
      GRACE,
      companionId,
      t.db,
      REOFFERED_AT,
    );
    expect(companionOffer.ok).toBe(true);
    if (!companionOffer.ok) return;
    expect(
      sessions.some(
        (entry) => entry.startsAt.getTime() === companionOffer.windowStart.getTime(),
      ),
    ).toBe(true);
    expect(companionOffer.windowStart.getTime()).toBeGreaterThan(
      COMPANION_START.getTime(),
    );

    expect(await notificationCount(t, homeId)).toBe(0);
    expect(await notificationCount(t, companionId)).toBe(0);
  });

  it("writes the zero-row absence proof and closes the ask on its last live time", async () => {
    const { askId, companionId, homeId } = await publishedAsk(t);

    // The companion time finished; the home time is the last live one.
    await t.db
      .update(slot)
      .set({
        status: "done",
        claimedBy: seedIds.people.ruth,
        claimedAt: NOW,
        claimConfirmedBy: seedIds.people.grace,
        claimConfirmedAt: NOW,
      })
      .where(eq(slot.id, companionId));
    const start = new Date(NOW.getTime() + 12 * 3_600_000);
    await makeAtRisk(t, homeId, start, new Date(start.getTime() + 2 * 3_600_000));

    expect(await askStatus(t, askId)).toBe("approved");

    const outcome = await expireSlotUnclaimed(GRACE, homeId, t.db, CALLED_AT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.caregiverOutboxCount).toBe(0);
    expect(outcome.askClosed).toBe(true);
    expect(outcome.askStatus).toBe("closed");
    const expectedDigest = computeAbsenceProofDigest({
      slotId: homeId,
      caregiverOutboxCount: 0,
      queryText: ABSENCE_PROOF_QUERY_TEXT,
      generatedAt: CALLED_AT,
    });
    expect(outcome.digest).toBe(expectedDigest);
    expect(outcome.absenceProofId).toBeTruthy();

    const [closedSlot] = await t.db
      .select({ status: slot.status })
      .from(slot)
      .where(eq(slot.id, homeId))
      .limit(1);
    expect(closedSlot.status).toBe("expired_unclaimed");

    const proofs = await absenceProofRows(t, homeId);
    expect(proofs).toHaveLength(1);
    expect(proofs[0].caregiverOutboxCount).toBe(0);
    expect(proofs[0].queryText).toBe(ABSENCE_PROOF_QUERY_TEXT);
    expect(proofs[0].digest).toBe(expectedDigest);
    expect(proofs[0].digest).toBe(
      recomputeAbsenceProofDigestFromRow(proofs[0]),
    );
    expect(proofs[0].createdAt).toEqual(CALLED_AT);

    // Independent confirmation: zero rows for the slot, and the ask closed
    // rather than stranded in approved.
    const [zero] = await t.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notification)
      .where(eq(notification.slotId, homeId));
    expect(Number(zero?.count ?? -1)).toBe(0);
    expect(await askStatus(t, askId)).toBe("closed");

    const proofsAudit = await auditRows(t, homeId, ["slot_expired_unclaimed"]);
    expect(proofsAudit).toHaveLength(1);
    expect(proofsAudit[0].detail).toMatchObject({
      caregiverOutboxCount: 0,
      digest: proofs[0].digest,
    });

    const askAudit = await t.db
      .select({ action: auditEvent.action, detail: auditEvent.detail })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.entity, "ask"),
          eq(auditEvent.entityId, askId),
          eq(auditEvent.action, "ask_closed"),
        ),
      );
    expect(askAudit).toHaveLength(1);
    expect(askAudit[0].detail).toMatchObject({ cause: "slot_expired" });

    const card = await getDeskSlotCoverage(GRACE, homeId, t.db, CALLED_AT);
    expect(card?.status).toBe("expired_unclaimed");
    expect(card?.absenceProof?.caregiverOutboxCount).toBe(0);
    expect(card?.absenceProof?.digest).toBe(proofs[0].digest);
    expect(card?.canExpire).toBe(false);

    const again = await expireSlotUnclaimed(GRACE, homeId, t.db, CALLED_AT);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("not_open");
    expect(await absenceProofRows(t, homeId)).toHaveLength(1);
    expect(await listCoverageWatch(GRACE, t.db, CALLED_AT)).toHaveLength(0);
  });

  it("gives two proofs from different times different digests that each recompute from the row", async () => {
    const { companionId, homeId } = await publishedAsk(t);

    const first = await expireSlotUnclaimed(GRACE, homeId, t.db, CALLED_AT);
    if (!first.ok) throw new Error(first.message);
    expect(first.digest).not.toBe(sha256Hex(ABSENCE_PROOF_QUERY_TEXT));

    const later = new Date(CALLED_AT.getTime() + 60 * 60 * 1000);
    const second = await expireSlotUnclaimed(
      GRACE,
      companionId,
      t.db,
      later,
    );
    if (!second.ok) throw new Error(second.message);

    const [homeProof] = await absenceProofRows(t, homeId);
    const [companionProof] = await absenceProofRows(t, companionId);

    expect(homeProof.slotId).not.toBe(companionProof.slotId);
    expect(homeProof.caregiverOutboxCount).toBe(0);
    expect(companionProof.caregiverOutboxCount).toBe(0);
    expect(homeProof.digest).not.toBe(companionProof.digest);
    expect(homeProof.digest).not.toBe(sha256Hex(ABSENCE_PROOF_QUERY_TEXT));
    expect(companionProof.digest).not.toBe(
      sha256Hex(ABSENCE_PROOF_QUERY_TEXT),
    );

    // The documented recipe reproduces each digest from its own stored row.
    for (const proof of [homeProof, companionProof]) {
      expect(proof.queryText).toBe(ABSENCE_PROOF_QUERY_TEXT);
      expect(proof.digest).toBe(recomputeAbsenceProofDigestFromRow(proof));
    }

    expect(first.digest).toBe(homeProof.digest);
    expect(second.digest).toBe(companionProof.digest);

    // The same slot id at a different written instant is a different proof.
    expect(
      computeAbsenceProofDigest({
        slotId: homeProof.slotId,
        caregiverOutboxCount: homeProof.caregiverOutboxCount,
        queryText: homeProof.queryText,
        generatedAt: new Date(homeProof.createdAt.getTime() + 1),
      }),
    ).not.toBe(homeProof.digest);

    const [homeAudit] = await auditRows(t, homeId, [
      "slot_expired_unclaimed",
    ]);
    expect(homeAudit.detail).toMatchObject({ digest: homeProof.digest });
  });

  it("refuses to write the proof when any notification row exists", async () => {
    const { companionId, homeId } = await publishedAsk(t);
    const start = new Date(NOW.getTime() + 12 * 3_600_000);
    await makeAtRisk(t, homeId, start, new Date(start.getTime() + 2 * 3_600_000));

    // The trigger only allows a caregiver row while the time is covered, and a
    // confirmed time can never be reopened: the claim is write-once, so the
    // database refuses to clear `claim_confirmed_at`. An open time holding a
    // message is therefore unreachable through any path. Build that bad state
    // by moving a real confirmation row onto the open time, and prove the
    // expiry still refuses it loudly.
    await claimAndConfirm(t, companionId);
    await t.db
      .update(notification)
      .set({ slotId: homeId })
      .where(eq(notification.slotId, companionId));

    expect(await notificationCount(t, homeId)).toBe(1);

    const outcome = await expireSlotUnclaimed(GRACE, homeId, t.db, CALLED_AT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("outbox_not_empty");
      expect(outcome.message.toLowerCase()).toMatch(/message|sent/i);
    }

    const [stillOpen] = await t.db
      .select({ status: slot.status })
      .from(slot)
      .where(eq(slot.id, homeId))
      .limit(1);
    expect(stillOpen.status).toBe("open");
    expect(await absenceProofRows(t, homeId)).toHaveLength(0);

    const audits = await auditRows(t, homeId, ["absence_proof_refused"]);
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({
      reason: "outbox_not_empty",
      caregiverOutboxCount: 1,
    });

    // The database's own CHECK refuses a non-zero proof even if a caller tried
    // to write one directly.
    await expectRejection(
      () =>
        t.db.insert(absenceProof).values({
          slotId: homeId,
          caregiverOutboxCount: 1,
          queryText: ABSENCE_PROOF_QUERY_TEXT,
          digest: computeAbsenceProofDigest({
            slotId: homeId,
            caregiverOutboxCount: 1,
            queryText: ABSENCE_PROOF_QUERY_TEXT,
            generatedAt: CALLED_AT,
          }),
        }),
      /absence_proof_zero_outbox|check constraint/i,
    );
  });

  it("gives the caregiver a day and a person, never a count or the word unclaimed", async () => {
    const { companionId, homeId } = await publishedAsk(t);

    const line = await listCaregiverWorkingLines(MARTA, t.db);
    expect(line).not.toBeNull();
    expect(line?.sentence).toMatch(/Your coordinator is working on/);
    expect(line?.weekdays).toContain("Saturday");
    expect(line?.sentence.toLowerCase()).not.toMatch(
      /unclaimed|waiting|decline|count|views?|places? left|remaining/,
    );

    // The line follows open times only. Cover both times and it disappears
    // while the family still has their confirmations.
    await claimAndConfirm(t, companionId);
    await claimAndConfirm(t, homeId);
    expect(await notificationCount(t, companionId)).toBe(1);
    expect(await notificationCount(t, homeId)).toBe(1);

    const covered = await listCaregiverWorkingLines(MARTA, t.db);
    expect(covered).toBeNull();

    // Another family with no ask has no line, and only a caregiver may read
    // their own.
    expect(await listCaregiverWorkingLines(PRIYA, t.db)).toBeNull();
    await expect(
      listCaregiverWorkingLines(GRACE, t.db),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { SEED_REFERENCE_DATE, seedIds } from "../../src/db/seed-data";
import {
  ask,
  askRevision,
  auditEvent,
  decision,
  notification,
  slot,
} from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import type { TypedAnswer } from "../../src/server/domain/slots";
import { claimSlot } from "../../src/server/repositories/claims";
import {
  approveClaim,
  getDeskSlotClaimReview,
  listCaregiverConfirmations,
  listPendingClaims,
  revokeClaim,
} from "../../src/server/repositories/claim-review";
import { listMyClaims } from "../../src/server/repositories/my-claims";
import { approveAskForCoordinator } from "../../src/server/services/ask-review";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { constructDraftSlots } from "../../src/server/services/slot-construction";
import {
  expectRejection,
  openTestDatabase,
  type TestDatabase,
} from "./helpers/db";

/**
 * VAL-CONFIRM-001, VAL-CONFIRM-002, and VAL-CLAIM-007 at the database boundary.
 *
 * A claim alone writes no message. Approval is one transaction: the claim moves
 * to `covered`, its own confirmation columns record the actor and instant
 * (never the publication columns), and exactly one confirmation row is written
 * from the fixed human template. The database itself refuses a caregiver row
 * for a claim and a second confirmation for one slot. Revocation requires a
 * reason, returns the slot to open, and writes no caregiver message at all.
 */

const NOW = SEED_REFERENCE_DATE; // Tuesday 17 November 2026, 10:00 in New York
const LATER = new Date("2026-11-18T15:00:00.000Z");

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

const SARA: Actor = {
  personId: seedIds.people.sara,
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

const NOTE_CANARY =
  "ORIENTATION CANARY: the blue teapot is in the second cupboard.";

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

/** A real ask, constructed by plain code and published by Grace. */
async function publishedAsk(
  t: TestDatabase,
): Promise<{ askId: string; companionId: string; homeId: string }> {
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

  // The coordinator's own note; its absence from every desk read is part of
  // this feature's privacy contract.
  await t.db
    .update(slot)
    .set({ orientationNote: NOTE_CANARY })
    .where(inArray(slot.id, [companion.id, home.id]));

  return { askId, companionId: companion.id, homeId: home.id };
}

async function claim(
  t: TestDatabase,
  actor: Actor,
  slotId: string,
): Promise<void> {
  const result = await claimSlot(actor, slotId, t.db, NOW);
  if (!result.ok) throw new Error(result.message);
}

async function slotRow(t: TestDatabase, slotId: string) {
  const [row] = await t.db.select().from(slot).where(eq(slot.id, slotId));
  return row;
}

async function notificationRows(t: TestDatabase, slotId: string) {
  return t.db
    .select()
    .from(notification)
    .where(eq(notification.slotId, slotId))
    .orderBy(notification.createdAt, notification.id);
}

async function countNotifications(
  t: TestDatabase,
  slotId: string,
): Promise<number> {
  const rows = await t.db
    .select({ id: notification.id })
    .from(notification)
    .where(eq(notification.slotId, slotId));
  return rows.length;
}

async function auditRows(
  t: TestDatabase,
  slotId: string,
  actions?: readonly string[],
) {
  return t.db
    .select({
      action: auditEvent.action,
      actorId: auditEvent.actorId,
      entityId: auditEvent.entityId,
      detail: auditEvent.detail,
      createdAt: auditEvent.createdAt,
    })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.entity, "slot"),
        eq(auditEvent.entityId, slotId),
        actions ? inArray(auditEvent.action, [...actions]) : undefined,
      ),
    )
    .orderBy(auditEvent.createdAt, auditEvent.id);
}

describe("claim approval and the one confirmation", () => {
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
  });

  it("writes no message when a volunteer claims, and the desk sees the claim", async () => {
    const { companionId, homeId } = await publishedAsk(t);

    await claim(t, RUTH, companionId);
    await claim(t, SARA, homeId);

    expect(await countNotifications(t, companionId)).toBe(0);
    expect(await countNotifications(t, homeId)).toBe(0);

    const review = await getDeskSlotClaimReview(GRACE, companionId, t.db);
    expect(review).not.toBeNull();
    expect(review?.status).toBe("claimed");
    expect(review?.volunteerFirstName).toBe("Ruth");
    expect(review?.claimedAt).toEqual(NOW);
    expect(review?.confirmation).toBeNull();
    expect(review?.claimConfirmedAt).toBeNull();
    expect(review?.claimConfirmedByName).toBeNull();
    // Publication approval is a separate fact and is already recorded.
    expect(review?.approvedAt).toEqual(NOW);
    expect(review?.publishedByName).toBe("Grace");

    const pending = await listPendingClaims(GRACE, t.db);
    expect(pending.map((row) => row.slotId).sort()).toEqual(
      [companionId, homeId].sort(),
    );
    expect(pending.map((row) => row.volunteerFirstName).sort()).toEqual([
      "Ruth",
      "Sara",
    ]);

    // The desk read never carries the family's words or the orientation note.
    const serialized = JSON.stringify(review);
    for (const forbidden of [
      NOTE_CANARY,
      "blue teapot",
      HERO_TEXT,
      "hymns and tea",
      "since March",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("approving covers the claim, records its own provenance, and writes exactly one confirmation", async () => {
    const { companionId } = await publishedAsk(t);
    await claim(t, RUTH, companionId);

    const published = await slotRow(t, companionId);
    expect(published.approvedBy).toBe(seedIds.people.grace);
    expect(published.approvedAt).toEqual(NOW);

    const outcome = await approveClaim(GRACE, companionId, t.db, LATER);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.notificationCreated).toBe(true);
      expect(outcome.message).toMatch(/confirmed/i);
    }

    const covered = await slotRow(t, companionId);
    expect(covered.status).toBe("covered");
    expect(covered.claimedBy).toBe(seedIds.people.ruth);
    // Claim confirmation has distinct columns; the publication trail is intact.
    expect(covered.claimConfirmedBy).toBe(seedIds.people.grace);
    expect(covered.claimConfirmedAt).toEqual(LATER);
    expect(covered.approvedBy).toBe(seedIds.people.grace);
    expect(covered.approvedAt).toEqual(NOW);

    const rows = await notificationRows(t, companionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("confirmation");
    expect(rows[0].templateCode).toBe("confirmation.companion");
    expect(rows[0].body).toBe(
      "Tuesday is covered — Elena has a place at Respite Morning, and Ruth will be their companion.",
    );
    expect(rows[0].caregiverId).toBe(seedIds.people.marta);
    expect(rows[0].churchId).toBe(seedIds.church);
    expect(rows[0].status).toBe("queued");
    expect(rows[0].body).not.toMatch(/\{|\}/);

    const audits = await auditRows(t, companionId, [
      "claim_approved",
      "claim_approval_refused",
    ]);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("claim_approved");
    expect(audits[0].actorId).toBe(seedIds.people.grace);
    expect(audits[0].detail).toMatchObject({
      volunteerId: seedIds.people.ruth,
      notificationId: rows[0].id,
      notificationCreated: true,
    });

    // The desk reads the confirmation back; the claimer's note now appears
    // through the my-claims predicate, not through this feature's reads.
    const review = await getDeskSlotClaimReview(GRACE, companionId, t.db);
    expect(review?.status).toBe("covered");
    expect(review?.claimConfirmedByName).toBe("Grace");
    expect(review?.claimConfirmedAt).toEqual(LATER);
    expect(review?.confirmation?.body).toBe(rows[0].body);
    expect(review?.approvedAt).toEqual(NOW);
    expect(JSON.stringify(review)).not.toContain(NOTE_CANARY);

    const mine = await listMyClaims(RUTH, t.db);
    expect(mine.claims.map((row) => row.status)).toEqual(["covered"]);
  });

  it("shows the caregiver only their own confirmation, with the volunteer's first name and details", async () => {
    const { companionId, homeId } = await publishedAsk(t);
    await claim(t, RUTH, companionId);
    await claim(t, SARA, homeId);
    await approveClaim(GRACE, companionId, t.db, LATER);

    const marta = await listCaregiverConfirmations(MARTA, t.db);
    expect(marta).toHaveLength(1);
    expect(marta[0].slotId).toBe(companionId);
    expect(marta[0].body).toBe(
      "Tuesday is covered — Elena has a place at Respite Morning, and Ruth will be their companion.",
    );
    expect(marta[0].volunteerFirstName).toBe("Ruth");
    expect(marta[0].label).toBe("Companion place at Respite Morning");
    expect(marta[0].windowStart).toEqual(
      new Date("2026-11-24T15:00:00.000Z"),
    );
    expect(marta[0].timeZone).toBe("America/New_York");
    expect(marta[0].createdAt).toEqual(LATER);

    // Another caregiver's own page sees nothing from Marta's family.
    expect(await listCaregiverConfirmations(PRIYA, t.db)).toEqual([]);

    const serialized = JSON.stringify(marta);
    for (const forbidden of [
      "Sara",
      "Bennett",
      NOTE_CANARY,
      HERO_TEXT,
      "hymns and tea",
      "fake-typed-v1",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("refuses a second confirmation for the same slot at the database", async () => {
    const { companionId, homeId } = await publishedAsk(t);
    await claim(t, RUTH, companionId);
    await claim(t, SARA, homeId);
    await approveClaim(GRACE, companionId, t.db, LATER);

    // A claimed slot cannot carry a caregiver message at all.
    await expectRejection(
      () =>
        t.db.insert(notification).values({
          churchId: seedIds.church,
          slotId: homeId,
          caregiverId: seedIds.people.marta,
          kind: "confirmation",
          templateCode: "confirmation.home",
          body: "A second message should never exist.",
        }),
      /requires a covered slot/i,
    );

    // A covered slot still accepts only one confirmation.
    await expectRejection(
      () =>
        t.db.insert(notification).values({
          churchId: seedIds.church,
          slotId: companionId,
          caregiverId: seedIds.people.marta,
          kind: "confirmation",
          templateCode: "confirmation.companion",
          body: "A second message should never exist.",
        }),
      /duplicate key|unique/i,
    );

    expect(await countNotifications(t, companionId)).toBe(1);
    expect(await countNotifications(t, homeId)).toBe(0);

    // Approving the same claim again is a calm refusal, not a second message.
    const again = await approveClaim(GRACE, companionId, t.db, LATER);
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.code).toBe("not_claimed");
      expect(again.message).toMatch(/already confirmed/i);
    }
    expect(await countNotifications(t, companionId)).toBe(1);

    const refused = await auditRows(t, companionId, [
      "claim_approval_refused",
    ]);
    expect(refused).toHaveLength(1);
    expect(refused[0].actorId).toBe(seedIds.people.grace);
  });

  it("requires a reason to revoke, sends nothing, and returns the time to the board", async () => {
    const { companionId, homeId } = await publishedAsk(t);
    await claim(t, RUTH, companionId);
    await claim(t, SARA, homeId);

    for (const reason of ["", "   ", "\n\t"]) {
      const invalid = await revokeClaim(
        GRACE,
        { slotId: homeId, reason },
        t.db,
        LATER,
      );
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) {
        expect(invalid.code).toBe("invalid_reason");
        expect(invalid.message).toMatch(/reason/i);
      }
    }

    const still = await slotRow(t, homeId);
    expect(still.status).toBe("claimed");
    expect(still.claimedBy).toBe(seedIds.people.sara);
    expect(await countNotifications(t, homeId)).toBe(0);
    expect(await auditRows(t, homeId, ["claim_revoked"])).toHaveLength(0);

    const revoked = await revokeClaim(
      GRACE,
      { slotId: homeId, reason: "Sara is unwell.\r\nWe will call her." },
      t.db,
      LATER,
    );
    expect(revoked.ok).toBe(true);

    const open = await slotRow(t, homeId);
    expect(open.status).toBe("open");
    expect(open.claimedBy).toBeNull();
    expect(open.claimedAt).toBeNull();
    expect(open.claimConfirmedAt).toBeNull();
    expect(open.claimConfirmedBy).toBeNull();
    // Publication approval survives revocation untouched.
    expect(open.approvedBy).toBe(seedIds.people.grace);
    expect(open.approvedAt).toEqual(NOW);

    expect(await countNotifications(t, homeId)).toBe(0);

    const audits = await auditRows(t, homeId, ["claim_revoked"]);
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe(seedIds.people.grace);
    expect(audits[0].detail).toMatchObject({
      volunteerId: seedIds.people.sara,
      reason: "Sara is unwell.\nWe will call her.",
    });

    // The volunteer's own list no longer carries the time.
    expect((await listMyClaims(SARA, t.db)).claims).toEqual([]);

    // The open time can be claimed again, and a fresh claim can be confirmed.
    await claim(t, SARA, homeId);
    const approved = await approveClaim(GRACE, homeId, t.db, LATER);
    expect(approved.ok).toBe(true);
    const rows = await notificationRows(t, homeId);
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe(
      "Saturday 21 November 2026, 10:00–12:00 is covered — Sara will visit Elena at home.",
    );
  });

  it("refuses to revoke a confirmed claim, so the family's one message stands", async () => {
    const { homeId } = await publishedAsk(t);
    await claim(t, SARA, homeId);
    const approved = await approveClaim(GRACE, homeId, t.db, LATER);
    expect(approved.ok).toBe(true);

    const revoked = await revokeClaim(
      GRACE,
      { slotId: homeId, reason: "Trying to take back a confirmed time." },
      t.db,
      LATER,
    );
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) {
      expect(revoked.code).toBe("not_claimed");
      expect(revoked.message).toMatch(/already confirmed/i);
    }

    const row = await slotRow(t, homeId);
    expect(row.status).toBe("covered");
    expect(row.claimedBy).toBe(seedIds.people.sara);
    expect(await countNotifications(t, homeId)).toBe(1);
  });

  it("keeps both reads and both writes behind the desk role and the church scope", async () => {
    const { companionId } = await publishedAsk(t);
    await claim(t, RUTH, companionId);

    await expect(getDeskSlotClaimReview(RUTH, companionId, t.db)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(getDeskSlotClaimReview(MARTA, companionId, t.db)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(listPendingClaims(RUTH, t.db)).rejects.toBeInstanceOf(AuthError);
    await expect(
      listCaregiverConfirmations(RUTH, t.db),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      listCaregiverConfirmations(GRACE, t.db),
    ).rejects.toBeInstanceOf(AuthError);

    expect(
      await getDeskSlotClaimReview(FOREIGN_COORDINATOR, companionId, t.db),
    ).toBeNull();
    expect(await listPendingClaims(FOREIGN_COORDINATOR, t.db)).toEqual([]);

    const foreignApprove = await approveClaim(
      FOREIGN_COORDINATOR,
      companionId,
      t.db,
      LATER,
    );
    expect(foreignApprove.ok).toBe(false);
    if (!foreignApprove.ok) expect(foreignApprove.code).toBe("not_found");

    const foreignRevoke = await revokeClaim(
      FOREIGN_COORDINATOR,
      { slotId: companionId, reason: "A foreign church must not touch this." },
      t.db,
      LATER,
    );
    expect(foreignRevoke.ok).toBe(false);
    if (!foreignRevoke.ok) expect(foreignRevoke.code).toBe("not_found");

    const row = await slotRow(t, companionId);
    expect(row.status).toBe("claimed");
    expect(row.claimedBy).toBe(seedIds.people.ruth);
    expect(await countNotifications(t, companionId)).toBe(0);
    expect(await auditRows(t, companionId, ["claim_approved", "claim_revoked"])).toEqual(
      [],
    );

    // A deputy holds the same desk powers as the coordinator.
    const deputy = await approveClaim(DANIEL, companionId, t.db, LATER);
    expect(deputy.ok).toBe(true);
    const afterDeputy = await slotRow(t, companionId);
    expect(afterDeputy.claimConfirmedBy).toBe(seedIds.people.daniel);
  });
});

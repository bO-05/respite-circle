import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
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
import { approveClaim } from "../../src/server/repositories/claim-review";
import { claimSlot } from "../../src/server/repositories/claims";
import {
  getClosure,
  recordCaregiverThankYou,
} from "../../src/server/repositories/closure";
import { markClaimDone } from "../../src/server/repositories/my-claims";
import { cancelSessionForCoordinator } from "../../src/server/repositories/sessions";
import { approveAskForCoordinator } from "../../src/server/services/ask-review";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { constructDraftSlots } from "../../src/server/services/slot-construction";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-CONFIRM-005 and the ask-closure half of VAL-CROSS-001.
 *
 * A real ask is constructed, published, claimed, confirmed, and then closed by
 * its volunteer. Closing the last published time marks the ask closed in the
 * same transaction and writes an append-only audit row; no notification row is
 * created by done, by the caregiver's optional thank-you, or by the closure
 * itself. The caregiver's thank-you is stored only when submitted, kept exactly
 * as typed, and read back by the volunteer who served that time — never by
 * another volunteer or another family.
 *
 * The session-cancel case proves the other closing path: when the last live
 * time is cancelled, the ask closes and still sends the family nothing.
 */

const NOW = SEED_REFERENCE_DATE;

const GRACE: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
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

const FOREIGN_CAREGIVER: Actor = {
  personId: seedIds.people.marta,
  role: "caregiver",
  churchId: "c9999999-9999-4999-8999-999999999999",
};

const FOREIGN_VOLUNTEER: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: "c9999999-9999-4999-8999-999999999999",
};

const HERO_TEXT =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

const COMPANION_ONLY_TEXT =
  "I haven't had a Saturday morning to myself since March. Mum can't be alone for long, and she loves hymns and tea.";

const THANK_YOU =
  "  Thank you, Ruth. The tea and the hymns made her morning.  ";

function answer(questionId: string, value: unknown): TypedAnswer {
  return { questionId, answer: value, abstained: false };
}

function heroAnswers(familiar: boolean): TypedAnswer[] {
  return [
    answer("Q1", true),
    answer("Q2", false),
    answer("Q3", false),
    answer("Q4", "saturday"),
    answer("Q5", false),
    answer("Q6", familiar),
    answer("Q7", "unknown"),
    answer("Q8", false),
    answer("Q9", false),
  ];
}

function isPick(questionId: string): boolean {
  return questionId === "Q4" || questionId === "Q7";
}

async function insertAskWithAnswers(
  t: TestDatabase,
  options: { familiar: boolean; text?: string },
): Promise<string> {
  const askId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const text = options.text ?? (options.familiar ? HERO_TEXT : COMPANION_ONLY_TEXT);

  await t.db.insert(ask).values({
    id: askId,
    churchId: seedIds.church,
    caregiverId: seedIds.people.marta,
    careRecipientId: seedIds.careRecipients.elena,
    verbatimText: text,
    status: "waiting_coordinator",
    policyVersionId: seedIds.policyV1,
  });

  await t.db.insert(askRevision).values({
    id: revisionId,
    askId,
    verbatimText: text,
    digest: sha256Hex(text),
  });

  await t.db.insert(decision).values(
    heroAnswers(options.familiar).map((entry, index) => ({
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

async function publishedAsk(
  t: TestDatabase,
  familiar: boolean,
): Promise<string> {
  const askId = await insertAskWithAnswers(t, { familiar });

  const constructed = await constructDraftSlots({
    askId,
    churchId: seedIds.church,
    database: t.db,
    now: NOW,
  });
  if (constructed.reason !== "created") {
    throw new Error(`expected drafts, got ${constructed.reason}`);
  }

  const approved = await approveAskForCoordinator(GRACE, askId, t.db, NOW);
  if (!approved.ok) throw new Error(approved.message);

  return askId;
}

async function slotsFor(t: TestDatabase, askId: string) {
  return t.db.select().from(slot).where(eq(slot.askId, askId));
}

async function claim(
  t: TestDatabase,
  actor: Actor,
  slotId: string,
): Promise<void> {
  const result = await claimSlot(actor, slotId, t.db, NOW);
  if (!result.ok) throw new Error(result.message);
}

async function moveIntoThePast(t: TestDatabase, slotId: string): Promise<void> {
  await t.db
    .update(slot)
    .set({
      windowStart: new Date("2026-11-14T15:00:00.000Z"),
      windowEnd: new Date("2026-11-14T17:00:00.000Z"),
    })
    .where(eq(slot.id, slotId));
}

async function notificationRows(t: TestDatabase, slotId: string) {
  return t.db
    .select({
      kind: notification.kind,
      body: notification.body,
    })
    .from(notification)
    .where(eq(notification.slotId, slotId));
}

async function auditRows(
  t: TestDatabase,
  action: string,
  entityId?: string,
) {
  return t.db
    .select({
      action: auditEvent.action,
      actorId: auditEvent.actorId,
      entity: auditEvent.entity,
      entityId: auditEvent.entityId,
      detail: auditEvent.detail,
    })
    .from(auditEvent)
    .where(
      entityId
        ? and(eq(auditEvent.action, action), eq(auditEvent.entityId, entityId))
        : eq(auditEvent.action, action),
    );
}

/** A companion-only ask, claimed, confirmed, and moved past its window. */
async function doneReadySlot(t: TestDatabase): Promise<{
  askId: string;
  slotId: string;
  sessionId: string | null;
}> {
  const askId = await publishedAsk(t, false);
  const rows = await slotsFor(t, askId);
  const companion = rows.find((row) => row.kind === "companion");
  if (!companion) throw new Error("expected a companion slot");

  await claim(t, RUTH, companion.id);
  const confirmed = await approveClaim(GRACE, companion.id, t.db, NOW);
  if (!confirmed.ok) throw new Error(confirmed.message);

  await moveIntoThePast(t, companion.id);
  return {
    askId,
    slotId: companion.id,
    sessionId: companion.sessionId,
  };
}

describe("closure", () => {
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

  it("closes the last published time and the ask in one transaction, sending nothing", async () => {
    const { askId, slotId } = await doneReadySlot(t);

    expect(await notificationRows(t, slotId)).toHaveLength(1);
    expect((await notificationRows(t, slotId))[0]?.kind).toBe("confirmation");

    const [beforeAsk] = await t.db
      .select({ status: ask.status })
      .from(ask)
      .where(eq(ask.id, askId));
    expect(beforeAsk.status).toBe("approved");
    expect(await auditRows(t, "ask_closed")).toHaveLength(0);

    const marked = await markClaimDone(RUTH, slotId, t.db, NOW);
    expect(marked.ok).toBe(true);

    const [row] = await t.db
      .select({ status: slot.status })
      .from(slot)
      .where(eq(slot.id, slotId));
    expect(row.status).toBe("done");

    const [closedAsk] = await t.db
      .select({ status: ask.status, updatedAt: ask.updatedAt })
      .from(ask)
      .where(eq(ask.id, askId));
    expect(closedAsk.status).toBe("closed");
    expect(closedAsk.updatedAt).toEqual(NOW);

    const doneAudit = await auditRows(t, "slot_done", slotId);
    expect(doneAudit).toHaveLength(1);
    expect(doneAudit[0]?.actorId).toBe(seedIds.people.ruth);
    expect(doneAudit[0]?.detail).toMatchObject({
      previousStatus: "covered",
      askId,
      askClosed: true,
    });

    const closureAudit = await auditRows(t, "ask_closed", askId);
    expect(closureAudit).toHaveLength(1);
    expect(closureAudit[0]?.actorId).toBe(seedIds.people.ruth);
    expect(closureAudit[0]?.detail).toMatchObject({
      cause: "slot_done",
      liveSlots: 0,
    });

    // The family's one confirmation is untouched, and nothing else was written.
    const sent = await notificationRows(t, slotId);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe("confirmation");

    // A second tap is a calm refusal and writes no second closure.
    const again = await markClaimDone(RUTH, slotId, t.db, NOW);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("already_done");
    expect(await auditRows(t, "ask_closed", askId)).toHaveLength(1);
    expect(await notificationRows(t, slotId)).toHaveLength(1);
  });

  it("keeps the ask open while another published time is still live", async () => {
    const askId = await publishedAsk(t, true);
    const rows = await slotsFor(t, askId);
    const companion = rows.find((row) => row.kind === "companion");
    const home = rows.find((row) => row.kind === "home");
    if (!companion || !home) throw new Error("expected companion and home");

    await claim(t, RUTH, companion.id);
    await claim(t, SARA, home.id);
    const companionApproved = await approveClaim(GRACE, companion.id, t.db, NOW);
    const homeApproved = await approveClaim(GRACE, home.id, t.db, NOW);
    if (!companionApproved.ok) throw new Error(companionApproved.message);
    if (!homeApproved.ok) throw new Error(homeApproved.message);

    await moveIntoThePast(t, companion.id);
    await moveIntoThePast(t, home.id);

    const first = await markClaimDone(RUTH, companion.id, t.db, NOW);
    expect(first.ok).toBe(true);

    const [stillOpen] = await t.db
      .select({ status: ask.status })
      .from(ask)
      .where(eq(ask.id, askId));
    expect(stillOpen.status).toBe("approved");
    expect(await auditRows(t, "ask_closed", askId)).toHaveLength(0);
    expect((await auditRows(t, "slot_done", companion.id))[0]?.detail).toMatchObject({
      askClosed: false,
    });

    const second = await markClaimDone(SARA, home.id, t.db, NOW);
    expect(second.ok).toBe(true);

    const [closed] = await t.db
      .select({ status: ask.status })
      .from(ask)
      .where(eq(ask.id, askId));
    expect(closed.status).toBe("closed");
    const closureAudit = await auditRows(t, "ask_closed", askId);
    expect(closureAudit).toHaveLength(1);
    expect(closureAudit[0]?.actorId).toBe(seedIds.people.sara);

    // Two confirmations, one per covered time, and no follow-up for either.
    expect(await notificationRows(t, companion.id)).toHaveLength(1);
    expect(await notificationRows(t, home.id)).toHaveLength(1);
  });

  it("closes the ask when its last live time is cancelled, still sending nothing", async () => {
    const askId = await publishedAsk(t, false);
    const rows = await slotsFor(t, askId);
    const companion = rows.find((row) => row.kind === "companion");
    if (!companion?.sessionId) {
      throw new Error("expected a session-linked companion slot");
    }

    await claim(t, RUTH, companion.id);
    const confirmed = await approveClaim(GRACE, companion.id, t.db, NOW);
    if (!confirmed.ok) throw new Error(confirmed.message);

    const cancelled = await cancelSessionForCoordinator(
      GRACE,
      companion.sessionId,
      t.db,
      NOW,
    );
    expect(cancelled.ok).toBe(true);

    const [closed] = await t.db
      .select({ status: ask.status })
      .from(ask)
      .where(eq(ask.id, askId));
    expect(closed.status).toBe("closed");

    const closureAudit = await auditRows(t, "ask_closed", askId);
    expect(closureAudit).toHaveLength(1);
    expect(closureAudit[0]?.actorId).toBe(seedIds.people.grace);
    expect(closureAudit[0]?.detail).toMatchObject({
      cause: "session_cancelled",
    });

    // The one confirmation from before the cancellation stays; no new row.
    expect(await notificationRows(t, companion.id)).toHaveLength(1);
  });

  it("stores the caregiver's thank-you only when submitted, and sends nothing", async () => {
    const { slotId } = await doneReadySlot(t);
    const marked = await markClaimDone(RUTH, slotId, t.db, NOW);
    expect(marked.ok).toBe(true);

    const before = await notificationRows(t, slotId);
    expect(before).toHaveLength(1);

    const blank = await recordCaregiverThankYou(MARTA, slotId, "   \n ", t.db, NOW);
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.stored).toBe(false);
    expect(await auditRows(t, "slot_thanked", slotId)).toHaveLength(0);

    const added = await recordCaregiverThankYou(MARTA, slotId, THANK_YOU, t.db, NOW);
    expect(added.ok).toBe(true);
    if (added.ok) {
      expect(added.stored).toBe(true);
      expect(added.code).toBe("added");
    }

    const thanksAudit = await auditRows(t, "slot_thanked", slotId);
    expect(thanksAudit).toHaveLength(1);
    expect(thanksAudit[0]?.actorId).toBe(seedIds.people.marta);
    expect(thanksAudit[0]?.detail).toMatchObject({ note: THANK_YOU });

    const after = await notificationRows(t, slotId);
    expect(after).toHaveLength(1);
    expect(after[0]?.kind).toBe("confirmation");

    // A second thank-you is a calm refusal; the record stays a single row.
    const duplicate = await recordCaregiverThankYou(
      MARTA,
      slotId,
      "A second note.",
      t.db,
      NOW,
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.code).toBe("already_thanked");
    expect(await auditRows(t, "slot_thanked", slotId)).toHaveLength(1);

    // The volunteer who served it reads the words back, without the family.
    const closure = await getClosure(RUTH, slotId, t.db, NOW);
    expect(closure).not.toBeNull();
    expect(closure?.thankYou).toBe(THANK_YOU);
    expect(closure?.status).toBe("done");
    const serialized = JSON.stringify(closure);
    expect(serialized).not.toContain("Marta");
    expect(serialized).not.toContain("Alvarez");
    expect(serialized).not.toContain(HERO_TEXT);
    expect(serialized).not.toContain(COMPANION_ONLY_TEXT);

    // Another volunteer and another church read nothing; another role is
    // refused before a query runs.
    expect(await getClosure(SARA, slotId, t.db, NOW)).toBeNull();
    expect(await getClosure(FOREIGN_VOLUNTEER, slotId, t.db, NOW)).toBeNull();
    await expect(getClosure(MARTA, slotId, t.db, NOW)).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("refuses a thank-you before done, from another family, or from a volunteer", async () => {
    const askId = await publishedAsk(t, false);
    const rows = await slotsFor(t, askId);
    const companion = rows.find((row) => row.kind === "companion");
    if (!companion) throw new Error("expected a companion slot");

    await claim(t, RUTH, companion.id);
    const confirmed = await approveClaim(GRACE, companion.id, t.db, NOW);
    if (!confirmed.ok) throw new Error(confirmed.message);

    // Covered, not done yet.
    const early = await recordCaregiverThankYou(
      MARTA,
      companion.id,
      THANK_YOU,
      t.db,
      NOW,
    );
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe("not_done");

    // Another caregiver and another church find no row.
    const priya = await recordCaregiverThankYou(
      PRIYA,
      companion.id,
      THANK_YOU,
      t.db,
      NOW,
    );
    expect(priya.ok).toBe(false);
    if (!priya.ok) expect(priya.code).toBe("not_found");

    const foreign = await recordCaregiverThankYou(
      FOREIGN_CAREGIVER,
      companion.id,
      THANK_YOU,
      t.db,
      NOW,
    );
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.code).toBe("not_found");

    // A volunteer is refused before a query runs.
    await expect(
      recordCaregiverThankYou(RUTH, companion.id, THANK_YOU, t.db, NOW),
    ).rejects.toBeInstanceOf(AuthError);

    // Too long is refused without a row.
    const long = await recordCaregiverThankYou(
      MARTA,
      companion.id,
      "a".repeat(1_001),
      t.db,
      NOW,
    );
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.code).toBe("too_long");

    expect(await auditRows(t, "slot_thanked", companion.id)).toHaveLength(0);
    expect(await notificationRows(t, companion.id)).toHaveLength(1);
  });

  it("offers closure facts only to the claimer and never before confirmation", async () => {
    const askId = await publishedAsk(t, false);
    const rows = await slotsFor(t, askId);
    const companion = rows.find((row) => row.kind === "companion");
    if (!companion) throw new Error("expected a companion slot");

    await claim(t, RUTH, companion.id);

    // Claimed but not confirmed: the closure page exists, but done is refused.
    const claimed = await getClosure(RUTH, companion.id, t.db, NOW);
    expect(claimed?.status).toBe("claimed");
    expect(claimed?.done.ok).toBe(false);

    const refused = await markClaimDone(RUTH, companion.id, t.db, NOW);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("not_covered");

    await expect(getClosure(MARTA, companion.id, t.db, NOW)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(getClosure(GRACE, companion.id, t.db, NOW)).rejects.toBeInstanceOf(
      AuthError,
    );

    const [waiting] = await t.db
      .select({ status: ask.status })
      .from(ask)
      .where(eq(ask.id, askId));
    expect(waiting.status).toBe("approved");
  });
});

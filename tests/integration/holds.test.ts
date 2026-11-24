import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
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
import {
  closeHeldAsk,
  getHeldAskCard,
  overrideSafetyHold,
} from "../../src/server/repositories/holds";
import { addDraftSlot } from "../../src/server/repositories/draft-slots";
import { listCaregiverNotes } from "../../src/server/repositories/ask-review";
import { getBoard } from "../../src/server/repositories/board";
import { constructDraftSlots } from "../../src/server/services/slot-construction";
import { sha256Hex } from "../../src/server/services/decision-contract";
import {
  expectRejection,
  openTestDatabase,
  type TestDatabase,
} from "./helpers/db";

/**
 * The human-only routes, against the isolated `respite_circle_e2e` database.
 *
 * VAL-SAFETY-001 through VAL-SAFETY-006: a safety ask and a personal-care ask
 * produce no slot from any path, the cards carry the script and the crisis and
 * referral resources, a close writes a coordinator's own words the family
 * reads, and only a safety hold can be converted — with confirmation, an actor,
 * and a reason in the append-only audit log.
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

const OTHER_CHURCH = "c9999999-9999-4999-8999-999999999999";
const OTHER_COORDINATOR: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: OTHER_CHURCH,
};

type AskStatus =
  | "draft"
  | "waiting_coordinator"
  | "safety_hold"
  | "care_hold"
  | "approved"
  | "sent_back"
  | "closed"
  | "withdrawn";

function answer(
  questionId: string,
  value: unknown,
  abstained = false,
): TypedAnswer {
  return { questionId, answer: value, abstained };
}

const SAFETY_ANSWERS: TypedAnswer[] = [
  answer("Q1", true),
  answer("Q2", false),
  answer("Q3", false),
  answer("Q4", "saturday"),
  answer("Q5", true),
  answer("Q6", false),
  answer("Q7", "unknown"),
  answer("Q8", false),
  answer("Q9", false),
];

const CARE_ANSWERS: TypedAnswer[] = [
  answer("Q1", false),
  answer("Q2", false),
  answer("Q3", false),
  answer("Q4", "none_stated"),
  answer("Q5", false),
  answer("Q6", false),
  answer("Q7", "not_a_meal"),
  answer("Q8", false),
  answer("Q9", true),
];

async function insertAsk(
  t: TestDatabase,
  options: {
    status: AskStatus;
    answers: TypedAnswer[];
    text?: string;
    caregiverId?: string;
  },
): Promise<string> {
  const askId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const text =
    options.text ?? "The weeks are long and I need a little help.";

  await t.db.insert(ask).values({
    id: askId,
    churchId: seedIds.church,
    caregiverId: options.caregiverId ?? seedIds.people.marta,
    careRecipientId: seedIds.careRecipients.elena,
    verbatimText: text,
    status: options.status,
    policyVersionId: seedIds.policyV1,
  });

  await t.db.insert(askRevision).values({
    id: revisionId,
    askId,
    verbatimText: text,
    digest: sha256Hex(text),
  });

  await t.db.insert(decision).values(
    options.answers.map((entry, index) => ({
      askId,
      askRevisionId: revisionId,
      policyVersionId: seedIds.policyV1,
      questionId: entry.questionId,
      questionText: `Question ${entry.questionId}`,
      answerType:
        entry.questionId === "Q4" || entry.questionId === "Q7"
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

async function readAsk(t: TestDatabase, askId: string) {
  const rows = await t.db.select().from(ask).where(eq(ask.id, askId)).limit(1);
  return rows[0];
}

async function slotsFor(t: TestDatabase, askId: string) {
  return t.db
    .select({ id: slot.id, kind: slot.kind, status: slot.status })
    .from(slot)
    .where(eq(slot.askId, askId))
    .orderBy(asc(slot.kind));
}

async function auditRows(
  t: TestDatabase,
  action: string,
  entityId: string,
) {
  return t.db
    .select()
    .from(auditEvent)
    .where(
      and(eq(auditEvent.action, action), eq(auditEvent.entityId, entityId)),
    )
    .orderBy(asc(auditEvent.createdAt));
}

describe("human-only routes", () => {
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

  it("gives a safety hold a script, 988 and the signed local line, and no slot", async () => {
    const askId = await insertAsk(t, {
      status: "safety_hold",
      answers: SAFETY_ANSWERS,
    });

    const held = await getHeldAskCard(GRACE, askId, t.db);
    expect(held).not.toBeNull();
    expect(held?.status).toBe("safety_hold");
    expect(held?.card.kind).toBe("safety");
    expect(held?.card.script.length).toBeGreaterThanOrEqual(3);

    const crisisText = (held?.card.crisis ?? [])
      .map((entry) => `${entry.name} ${entry.detail} ${entry.phone ?? ""}`)
      .join(" ");
    expect(crisisText).toMatch(/988/);
    expect(crisisText).toMatch(/555-0142/);
    expect(crisisText).toMatch(/911/);
    expect(held?.card.crisisScript).toMatch(/988/);
    expect(held?.card.noReportSentence).toMatch(/^No report has been made/);
    expect(held?.card.overrideAllowed).toBe(true);

    // The hold itself writes no slot, and the desk's own construction path
    // refuses it even if somebody asks.
    expect(await slotsFor(t, askId)).toHaveLength(0);
    const construction = await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(construction.created).toBe(false);
    expect(construction.blocked?.reason).toBe("safety_flag");
    expect(await slotsFor(t, askId)).toHaveLength(0);

    // Nothing about a security-held ask reaches the congregation board.
    const board = await getBoard(RUTH, t.db, NOW);
    expect(board?.slots ?? []).toHaveLength(0);
  });

  it("scopes the hold card to desk roles and the church", async () => {
    const askId = await insertAsk(t, {
      status: "safety_hold",
      answers: SAFETY_ANSWERS,
    });

    await expect(getHeldAskCard(MARTA, askId, t.db)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(
      getHeldAskCard(OTHER_COORDINATOR, askId, t.db),
    ).resolves.toBeNull();
  });

  it("gives a personal-care hold both referrals and refuses every slot path", async () => {
    const askId = await insertAsk(t, {
      status: "care_hold",
      answers: CARE_ANSWERS,
    });

    const held = await getHeldAskCard(GRACE, askId, t.db);
    expect(held?.card.kind).toBe("personal_care");
    const referrals = (held?.card.referrals ?? [])
      .map((entry) => entry.name)
      .join(" · ");
    expect(referrals).toMatch(/ARCH/);
    expect(referrals).toMatch(/Area Agency on Aging/);
    expect(held?.card.overrideAllowed).toBe(false);

    // Typed decisions may not build a slot.
    const construction = await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(construction.created).toBe(false);
    expect(construction.blocked?.reason).toBe("personal_care_flag");

    // A coordinator's manual add is refused for every kind.
    for (const kind of ["companion", "home", "drive", "meal"] as const) {
      const added = await addDraftSlot(GRACE, { askId, kind }, t.db, NOW);
      expect(added.ok).toBe(false);
      if (!added.ok) expect(added.message).toMatch(/personal care/i);
    }

    // A conversion is refused and writes nothing.
    const converted = await overrideSafetyHold(
      GRACE,
      {
        askId,
        confirmation: "yes",
        reason: "I thought a companion place might still help.",
      },
      t.db,
      NOW,
    );
    expect(converted.ok).toBe(false);
    if (!converted.ok) {
      expect(converted.code).toBe("personal_care");
      expect(converted.message).toMatch(/personal care/i);
    }

    expect(await slotsFor(t, askId)).toHaveLength(0);
    expect((await readAsk(t, askId)).status).toBe("care_hold");
    expect(await auditRows(t, "safety_hold_overridden", askId)).toHaveLength(0);
  });

  it("requires both the explicit confirmation and the reason before converting a safety hold", async () => {
    const askId = await insertAsk(t, {
      status: "safety_hold",
      answers: SAFETY_ANSWERS,
    });

    const noConfirm = await overrideSafetyHold(
      GRACE,
      { askId, confirmation: "", reason: "Called the family." },
      t.db,
      NOW,
    );
    expect(noConfirm.ok).toBe(false);
    if (!noConfirm.ok) {
      expect(noConfirm.code).toBe("invalid_confirmation");
      expect(noConfirm.field).toBe("confirm");
    }
    expect((await readAsk(t, askId)).status).toBe("safety_hold");

    const noReason = await overrideSafetyHold(
      GRACE,
      { askId, confirmation: "yes", reason: "   " },
      t.db,
      NOW,
    );
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) {
      expect(noReason.code).toBe("invalid_reason");
      expect(noReason.field).toBe("reason");
    }
    expect((await readAsk(t, askId)).status).toBe("safety_hold");
    expect(await auditRows(t, "safety_hold_overridden", askId)).toHaveLength(0);
  });

  it("converts a safety hold with the actor and the reason in the audit log, then allows construction", async () => {
    const askId = await insertAsk(t, {
      status: "safety_hold",
      answers: SAFETY_ANSWERS,
    });

    const reason =
      "Called Marta at 4pm. The fall was last week, her neighbour is with her tonight, and there is no immediate danger.";
    const converted = await overrideSafetyHold(
      GRACE,
      { askId, confirmation: "yes", reason },
      t.db,
      NOW,
    );
    expect(converted.ok).toBe(true);

    const row = await readAsk(t, askId);
    expect(row.status).toBe("waiting_coordinator");
    expect(row.safetyOverrideBy).toBe(seedIds.people.grace);
    expect(row.safetyOverrideAt).not.toBeNull();
    expect(row.safetyOverrideReason).toBe(reason);

    const audits = await auditRows(t, "safety_hold_overridden", askId);
    expect(audits).toHaveLength(1);
    expect(audits[0].actorType).toBe("human");
    expect(audits[0].actorId).toBe(seedIds.people.grace);
    expect(audits[0].detail).toMatchObject({
      reason,
      fromStatus: "safety_hold",
      automatic: false,
    });

    // The conversion is only a status change: nothing is published and no
    // slot exists until plain code proposes one.
    expect(await slotsFor(t, askId)).toHaveLength(0);

    const construction = await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(construction.created).toBe(true);
    expect((await slotsFor(t, askId)).length).toBeGreaterThan(0);
    for (const entry of await slotsFor(t, askId)) {
      expect(entry.status).toBe("draft");
    }
  });

  it("never converts a safety hold that also names personal care", async () => {
    const askId = await insertAsk(t, {
      status: "safety_hold",
      answers: [
        ...SAFETY_ANSWERS.map((entry) =>
          entry.questionId === "Q9" ? answer("Q9", true) : entry,
        ),
      ],
    });

    const converted = await overrideSafetyHold(
      GRACE,
      {
        askId,
        confirmation: "yes",
        reason: "Called the family; the safety concern is settled.",
      },
      t.db,
      NOW,
    );
    expect(converted.ok).toBe(false);
    if (!converted.ok) expect(converted.code).toBe("personal_care");

    expect((await readAsk(t, askId)).status).toBe("safety_hold");

    // Even if a status were forced, the typed answers still refuse a slot.
    const construction = await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(construction.created).toBe(false);
    expect(await slotsFor(t, askId)).toHaveLength(0);
  });

  it("closes a held ask with human words the family reads, and writes no message", async () => {
    const askId = await insertAsk(t, {
      status: "safety_hold",
      answers: SAFETY_ANSWERS,
    });

    const typed =
      "Marta, thank you for telling us. Grace will call you today, and we will stay with this together.\n\nYou do not owe anyone a decision tonight.";
    const closed = await closeHeldAsk(
      GRACE,
      { askId, note: typed },
      t.db,
      NOW,
    );
    expect(closed.ok).toBe(true);

    const row = await readAsk(t, askId);
    expect(row.status).toBe("closed");
    expect(row.closeNote).toBe(typed);
    expect(row.closedBy).toBe(seedIds.people.grace);
    expect(row.closedAt).not.toBeNull();

    const audits = await auditRows(t, "held_ask_closed", askId);
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe(seedIds.people.grace);
    expect(audits[0].detail).toMatchObject({
      fromStatus: "safety_hold",
      noteLength: typed.length,
    });

    const notes = await listCaregiverNotes(MARTA, t.db);
    const mine = notes.filter((note) => note.askId === askId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      kind: "close",
      note: typed,
      notedByName: "Grace",
    });

    // Another caregiver reads nothing about this family, and no notification
    // row was created by the close.
    const other = await listCaregiverNotes(PRIYA, t.db);
    expect(other.filter((note) => note.askId === askId)).toHaveLength(0);
    const outbox = await t.db
      .select({ id: notification.id })
      .from(notification)
      .where(eq(notification.caregiverId, MARTA.personId));
    expect(outbox).toHaveLength(0);
  });

  it("refuses to close an ask that is not held, and closes a care hold too", async () => {
    const waitingId = await insertAsk(t, {
      status: "waiting_coordinator",
      answers: SAFETY_ANSWERS.map((entry) =>
        entry.questionId === "Q5" ? answer("Q5", false) : entry,
      ),
    });

    const refused = await closeHeldAsk(
      GRACE,
      { askId: waitingId, note: "A note." },
      t.db,
      NOW,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("not_held");
    expect((await readAsk(t, waitingId)).status).toBe("waiting_coordinator");

    const careId = await insertAsk(t, {
      status: "care_hold",
      answers: CARE_ANSWERS,
    });
    const closed = await closeHeldAsk(
      GRACE,
      { askId: careId, note: "Marta, the referrals are on their way to you." },
      t.db,
      NOW,
    );
    expect(closed.ok).toBe(true);
    expect((await readAsk(t, careId)).status).toBe("closed");
  });

  it("refuses a blank close note and keeps the ask on hold", async () => {
    const askId = await insertAsk(t, {
      status: "care_hold",
      answers: CARE_ANSWERS,
    });

    const blank = await closeHeldAsk(
      GRACE,
      { askId, note: "   \n " },
      t.db,
      NOW,
    );
    expect(blank.ok).toBe(false);
    if (!blank.ok) {
      expect(blank.code).toBe("invalid_note");
      expect(blank.field).toBe("note");
    }
    expect((await readAsk(t, askId)).status).toBe("care_hold");
  });

  it("keeps the database from storing half an override or half a close", async () => {
    const askId = await insertAsk(t, {
      status: "safety_hold",
      answers: SAFETY_ANSWERS,
    });

    await expectRejection(
      () =>
        t.client`
          UPDATE ask
             SET safety_override_at = now()
           WHERE id = ${askId}
        `,
      /ask_safety_override_complete/,
    );

    await expectRejection(
      () =>
        t.client`
          UPDATE ask
             SET close_note = 'Only words, no closer'
           WHERE id = ${askId}
        `,
      /ask_close_note_complete/,
    );
  });

  it("keeps a draft slot on a held ask off the board and out of the volunteer payload", async () => {
    const askId = await insertAsk(t, {
      status: "care_hold",
      answers: CARE_ANSWERS,
    });

    // Even a row inserted directly, bypassing every service, is invisible:
    // the board projection selects only published statuses with an approver.
    await t.db.insert(slot).values({
      askId,
      churchId: seedIds.church,
      kind: "companion",
      tier: "public_event",
      label: "Companion place at Respite Morning",
      status: "draft",
    });

    const board = await getBoard(RUTH, t.db, NOW);
    expect(board?.slots ?? []).toHaveLength(0);
    expect(JSON.stringify(board)).not.toMatch(/Companion place/);
  });
});

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
  slot,
} from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import type { TypedAnswer } from "../../src/server/domain/slots";
import { getBoard } from "../../src/server/repositories/board";
import {
  getAskPublication,
  listCaregiverNotes,
  resolveHeldDraftAndPublish,
} from "../../src/server/repositories/ask-review";
import { getCaregiverAsk } from "../../src/server/repositories/asks";
import { holdDraftSlot } from "../../src/server/repositories/draft-slots";
import {
  approveAskForCoordinator,
  sendBackAskForCoordinator,
} from "../../src/server/services/ask-review";
import { constructDraftSlots } from "../../src/server/services/slot-construction";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-DESK-004, VAL-DESK-005, and VAL-DESK-006 against the isolated database.
 *
 * Approve publishes exactly the non-held drafts in one transaction and records
 * the approver and instant on the ask and on every published slot. A held draft
 * stays a draft with its reason and cannot be published until the hold is
 * resolved. Send back requires a human note, stores it byte-for-byte, publishes
 * nothing, and shows it only to the caregiver it belongs to. Before approval no
 * ask or draft can appear in the board projection.
 */

const NOW = SEED_REFERENCE_DATE; // Tuesday 17 November 2026, 10:00 in New York

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

const DAVID: Actor = {
  personId: seedIds.people.david,
  role: "caregiver",
  churchId: seedIds.church,
};

const RUTH: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: seedIds.church,
};

const OTHER_CHURCH = "c9999999-9999-4999-8999-999999999999";
const FOREIGN_COORDINATOR: Actor = {
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

async function insertAskWithAnswers(
  t: TestDatabase,
  options: {
    status?: AskStatus;
    answers?: TypedAnswer[];
    text?: string;
  } = {},
): Promise<{ askId: string; revisionId: string }> {
  const askId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const answers = options.answers ?? HERO_ANSWERS;
  const text =
    options.text ??
    "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.";

  await t.db.insert(ask).values({
    id: askId,
    churchId: seedIds.church,
    caregiverId: seedIds.people.marta,
    careRecipientId: seedIds.careRecipients.elena,
    verbatimText: text,
    status: options.status ?? "waiting_coordinator",
    policyVersionId: seedIds.policyV1,
  });

  await t.db.insert(askRevision).values({
    id: revisionId,
    askId,
    verbatimText: text,
    digest: sha256Hex(text),
  });

  await t.db.insert(decision).values(
    answers.map((entry, index) => ({
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

  return { askId, revisionId };
}

async function buildDrafts(t: TestDatabase, askId: string): Promise<void> {
  const result = await constructDraftSlots({
    askId,
    churchId: seedIds.church,
    database: t.db,
    now: NOW,
  });
  if (result.reason !== "created") {
    throw new Error(`expected drafts to be created, got ${result.reason}`);
  }
}

async function readSlots(t: TestDatabase, askId: string) {
  return t.db
    .select()
    .from(slot)
    .where(eq(slot.askId, askId))
    .orderBy(asc(slot.kind));
}

async function auditRows(t: TestDatabase, action: string, entityId?: string) {
  return t.db
    .select()
    .from(auditEvent)
    .where(
      entityId
        ? and(eq(auditEvent.action, action), eq(auditEvent.entityId, entityId))
        : eq(auditEvent.action, action),
    );
}

describe("approve, publish, and send back", () => {
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

  it("publishes exactly the non-held drafts and moves the ask to approved", async () => {
    const { askId } = await insertAskWithAnswers(t);
    await buildDrafts(t, askId);

    const before = await readSlots(t, askId);
    const companion = before.find((row) => row.kind === "companion");
    const home = before.find((row) => row.kind === "home");
    if (!companion || !home) throw new Error("expected two drafts");

    const held = await holdDraftSlot(
      GRACE,
      { slotId: home.id, reason: "Check with the family about the stairs first." },
      t.db,
    );
    expect(held.ok).toBe(true);

    // Before approval nothing is on the board.
    expect((await getBoard(RUTH, t.db))?.slots).toHaveLength(0);

    const result = await approveAskForCoordinator(GRACE, askId, t.db, NOW);
    expect(result).toMatchObject({
      ok: true,
      publishedCount: 1,
      heldCount: 1,
    });
    if (!result.ok) throw new Error(result.message);

    const [askRow] = await t.db.select().from(ask).where(eq(ask.id, askId));
    expect(askRow.status).toBe("approved");
    expect(askRow.approvedBy).toBe(seedIds.people.grace);
    expect(askRow.approvedAt?.toISOString()).toBe(NOW.toISOString());

    const after = await readSlots(t, askId);
    const published = after.find((row) => row.id === companion.id);
    const stillHeld = after.find((row) => row.id === home.id);
    if (!published || !stillHeld) throw new Error("expected both slots");

    expect(published.status).toBe("open");
    expect(published.approvedBy).toBe(seedIds.people.grace);
    expect(published.approvedAt?.toISOString()).toBe(NOW.toISOString());

    // The held draft is untouched: still a draft, still carrying its reason.
    expect(stillHeld.status).toBe("draft");
    expect(stillHeld.holdReason).toMatch(/stairs/i);
    expect(stillHeld.approvedAt).toBeNull();

    const approvedAudit = await auditRows(t, "ask_approved", askId);
    expect(approvedAudit).toHaveLength(1);
    expect(approvedAudit[0].actorId).toBe(seedIds.people.grace);
    expect(approvedAudit[0].actorType).toBe("human");
    expect(approvedAudit[0].createdAt).toBeInstanceOf(Date);
    expect(approvedAudit[0].detail).toMatchObject({
      publishedCount: 1,
      heldCount: 1,
    });

    const publishedAudit = await auditRows(t, "slot_published", companion.id);
    expect(publishedAudit).toHaveLength(1);
    expect(publishedAudit[0].actorId).toBe(seedIds.people.grace);
    expect(await auditRows(t, "slot_published", home.id)).toHaveLength(0);
  });

  it("shows the published time on the board with an allow-listed approval line", async () => {
    const { askId } = await insertAskWithAnswers(t);
    await buildDrafts(t, askId);

    const before = await getBoard(RUTH, t.db);
    expect(before?.slots).toHaveLength(0);

    await approveAskForCoordinator(GRACE, askId, t.db, NOW);

    const board = await getBoard(RUTH, t.db);
    expect(board?.timeZone).toBe("America/New_York");
    expect(board?.slots).toHaveLength(2);
    if (!board) throw new Error("expected a board view");

    for (const row of board.slots) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "approvedAt",
          "approvedByName",
          "claim",
          "gated",
          "id",
          "kind",
          "label",
          "sessionId",
          "status",
          "tier",
          "windowEnd",
          "windowStart",
        ].sort(),
      );
      expect(row.status).toBe("open");
      expect(row.approvedByName).toBe("Grace");
      expect(row.approvedAt?.toISOString()).toBe(NOW.toISOString());
    }

    // No caregiver or recipient identity, no words, no orientation note.
    const serialized = JSON.stringify(board);
    for (const forbidden of [
      "Marta",
      "Alvarez",
      "Elena",
      "I haven't had a Saturday morning",
      "hymns",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    // A caregiver cannot read the board projection at all.
    await expect(getBoard(MARTA, t.db)).rejects.toBeInstanceOf(AuthError);
  });

  it("keeps a held draft unpublished and only publishes it after the hold is resolved", async () => {
    const { askId } = await insertAskWithAnswers(t);
    await buildDrafts(t, askId);

    const drafts = await readSlots(t, askId);
    const home = drafts.find((row) => row.kind === "home");
    if (!home) throw new Error("expected a home draft");

    await holdDraftSlot(
      GRACE,
      { slotId: home.id, reason: "Confirm the second person for the first visit." },
      t.db,
    );

    await approveAskForCoordinator(GRACE, askId, t.db, NOW);

    // A held draft cannot be published by any other path.
    await expect(
      resolveHeldDraftAndPublish(RUTH, home.id, t.db, NOW),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      resolveHeldDraftAndPublish(DAVID, home.id, t.db, NOW),
    ).rejects.toBeInstanceOf(AuthError);

    const resolved = await resolveHeldDraftAndPublish(GRACE, home.id, t.db, NOW);
    expect(resolved).toMatchObject({ ok: true, askId, slotId: home.id });
    if (!resolved.ok) throw new Error(resolved.message);

    const [published] = await t.db
      .select()
      .from(slot)
      .where(eq(slot.id, home.id));
    expect(published.status).toBe("open");
    expect(published.holdReason).toBeNull();
    expect(published.heldAt).toBeNull();
    expect(published.heldBy).toBeNull();
    expect(published.approvedBy).toBe(seedIds.people.grace);

    const resolvedAudit = await auditRows(
      t,
      "draft_slot_hold_resolved",
      home.id,
    );
    expect(resolvedAudit).toHaveLength(1);
    expect(resolvedAudit[0].detail).toMatchObject({
      resolvedReason: "Confirm the second person for the first visit.",
      afterApproval: true,
    });
    const publishedAudit = await auditRows(t, "slot_published", home.id);
    expect(publishedAudit[0].detail).toMatchObject({ via: "hold_resolved" });

    // A second attempt is refused: it is no longer a draft.
    const again = await resolveHeldDraftAndPublish(GRACE, home.id, t.db, NOW);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("not_draft");

    // A released draft on an unapproved ask cannot be published singly.
    const second = await insertAskWithAnswers(t);
    await buildDrafts(t, second.askId);
    const secondHome = (await readSlots(t, second.askId)).find(
      (row) => row.kind === "home",
    );
    if (!secondHome) throw new Error("expected a home draft");
    await holdDraftSlot(
      GRACE,
      { slotId: secondHome.id, reason: "Wait for the family." },
      t.db,
    );
    const early = await resolveHeldDraftAndPublish(
      GRACE,
      secondHome.id,
      t.db,
      NOW,
    );
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.reason).toBe("not_approved");

    const [stillDraft] = await t.db
      .select()
      .from(slot)
      .where(eq(slot.id, secondHome.id));
    expect(stillDraft.status).toBe("draft");
  });

  it("sends back with a note exactly as written and publishes nothing", async () => {
    const { askId } = await insertAskWithAnswers(t);
    await buildDrafts(t, askId);

    const note =
      "  Thank you for writing this down.\n\nI read it twice. Nothing is arranged yet — please call me on Thursday and we will look at the week together.  ";

    const result = await sendBackAskForCoordinator(
      GRACE,
      { askId, note },
      t.db,
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.note).toBe(note);

    const [askRow] = await t.db.select().from(ask).where(eq(ask.id, askId));
    expect(askRow.status).toBe("sent_back");
    expect(askRow.sendBackNote).toBe(note);
    expect(askRow.sentBackBy).toBe(seedIds.people.grace);
    expect(askRow.sentBackAt?.toISOString()).toBe(NOW.toISOString());

    const drafts = await readSlots(t, askId);
    expect(drafts).toHaveLength(2);
    expect(drafts.every((row) => row.status === "draft")).toBe(true);
    expect(await auditRows(t, "slot_published")).toHaveLength(0);
    expect((await getBoard(RUTH, t.db))?.slots).toHaveLength(0);

    const audit = await auditRows(t, "ask_sent_back", askId);
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(seedIds.people.grace);
    expect(audit[0].detail).toMatchObject({
      noteLength: note.length,
      noteDigest: sha256Hex(note),
    });

    // The caregiver who owns the ask reads the same bytes.
    const receipt = await getCaregiverAsk(MARTA, askId, t.db);
    expect(receipt?.status).toBe("sent_back");
    expect(receipt?.sendBackNote).toBe(note);
    expect(receipt?.sentBackByFirstName).toBe("Grace");

    const notes = await listCaregiverNotes(MARTA, t.db);
    expect(notes).toHaveLength(1);
    expect(notes[0].askId).toBe(askId);
    expect(notes[0].kind).toBe("send_back");
    expect(notes[0].note).toBe(note);
    expect(notes[0].notedByName).toBe("Grace");

    // No other caregiver, no volunteer, no other church reads it.
    expect(await getCaregiverAsk(DAVID, askId, t.db)).toBeNull();
    expect(await listCaregiverNotes(DAVID, t.db)).toHaveLength(0);
    await expect(listCaregiverNotes(RUTH, t.db)).rejects.toBeInstanceOf(
      AuthError,
    );
    expect(await getAskPublication(FOREIGN_COORDINATOR, askId, t.db)).toBeNull();
  });

  it("refuses a send-back without a human note and writes nothing", async () => {
    const { askId } = await insertAskWithAnswers(t);
    await buildDrafts(t, askId);

    for (const note of ["", "   \n\t ", undefined]) {
      const result = await sendBackAskForCoordinator(
        GRACE,
        { askId, note },
        t.db,
        NOW,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_note");
    }

    const [askRow] = await t.db.select().from(ask).where(eq(ask.id, askId));
    expect(askRow.status).toBe("waiting_coordinator");
    expect(askRow.sendBackNote).toBeNull();
    expect(askRow.sentBackBy).toBeNull();
    expect(await auditRows(t, "ask_sent_back", askId)).toHaveLength(0);
  });

  it("refuses a second decision and never approves a safety or care hold", async () => {
    const { askId } = await insertAskWithAnswers(t);
    await buildDrafts(t, askId);

    const first = await approveAskForCoordinator(GRACE, askId, t.db, NOW);
    expect(first.ok).toBe(true);

    const second = await approveAskForCoordinator(GRACE, askId, t.db, NOW);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("not_waiting");

    const sendBack = await sendBackAskForCoordinator(
      GRACE,
      { askId, note: "Send it back after all." },
      t.db,
      NOW,
    );
    expect(sendBack.ok).toBe(false);
    if (!sendBack.ok) expect(sendBack.reason).toBe("not_waiting");

    for (const status of ["safety_hold", "care_hold"] as const) {
      const held = await insertAskWithAnswers(t, { status });
      const outcome = await approveAskForCoordinator(
        GRACE,
        held.askId,
        t.db,
        NOW,
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("not_waiting");

      const [row] = await t.db.select().from(ask).where(eq(ask.id, held.askId));
      expect(row.status).toBe(status);
      expect(row.approvedAt).toBeNull();
      // A held ask has no slot at all, so nothing reached the board.
      expect(await readSlots(t, held.askId)).toHaveLength(0);
    }

    // Exactly one approval audit row exists for the one successful transition.
    expect(await auditRows(t, "ask_approved", askId)).toHaveLength(1);
  });

  it("records a deputy as the approver, not the coordinator", async () => {
    const { askId } = await insertAskWithAnswers(t);
    await buildDrafts(t, askId);

    const result = await approveAskForCoordinator(DANIEL, askId, t.db, NOW);
    expect(result.ok).toBe(true);

    const [askRow] = await t.db.select().from(ask).where(eq(ask.id, askId));
    expect(askRow.approvedBy).toBe(seedIds.people.daniel);

    const board = await getBoard(RUTH, t.db);
    expect(
      board?.slots.every((row) => row.approvedByName === "Daniel"),
    ).toBe(true);

    const audit = await auditRows(t, "ask_approved", askId);
    expect(audit[0].actorId).toBe(seedIds.people.daniel);
  });

  it("refuses approval and send-back from another church without a write", async () => {
    const { askId } = await insertAskWithAnswers(t);
    await buildDrafts(t, askId);

    const approve = await approveAskForCoordinator(
      FOREIGN_COORDINATOR,
      askId,
      t.db,
      NOW,
    );
    expect(approve.ok).toBe(false);
    if (!approve.ok) expect(approve.reason).toBe("not_found");

    const sendBack = await sendBackAskForCoordinator(
      FOREIGN_COORDINATOR,
      { askId, note: "A note from the wrong church." },
      t.db,
      NOW,
    );
    expect(sendBack.ok).toBe(false);
    if (!sendBack.ok) expect(sendBack.reason).toBe("not_found");

    const [row] = await t.db.select().from(ask).where(eq(ask.id, askId));
    expect(row.status).toBe("waiting_coordinator");
    expect(row.sendBackNote).toBeNull();
    expect(
      (await readSlots(t, askId)).every((entry) => entry.status === "draft"),
    ).toBe(true);
  });
});

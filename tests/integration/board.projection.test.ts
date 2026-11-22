import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { SEED_REFERENCE_DATE, seedIds } from "../../src/db/seed-data";
import {
  ask,
  askRevision,
  decision,
  slot,
  volunteer,
} from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import type { TypedAnswer } from "../../src/server/domain/slots";
import { BOARD_VISIBLE_STATUSES, getBoard } from "../../src/server/repositories/board";
import { approveAskForCoordinator } from "../../src/server/services/ask-review";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { constructDraftSlots } from "../../src/server/services/slot-construction";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-BOARD-001, VAL-BOARD-002, VAL-BOARD-004, and the draft rule on the
 * projection itself.
 *
 * The board read is an explicit allow-list. It carries a time and the shape of
 * the help; it never joins the caregiver, the recipient, the words, or the
 * orientation note. Only published times are selected — and a published time
 * must also carry the approval instant, so a row that somehow held `open`
 * without passing the human gate still cannot reach a neighbour.
 */

const NOW = SEED_REFERENCE_DATE; // Tuesday 17 November 2026, 10:00 in New York

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

const RUTH: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: seedIds.church,
};

const TOM: Actor = {
  personId: seedIds.people.tom,
  role: "volunteer",
  churchId: seedIds.church,
};

const SARA: Actor = {
  personId: seedIds.people.sara,
  role: "volunteer",
  churchId: seedIds.church,
};

const BEN: Actor = {
  personId: seedIds.people.ben,
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

const HERO_TEXT =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.";
const WAITING_TEXT =
  "My father needs someone to sit with him on Saturday while I go to an appointment. He knows Ruth from church.";

function isPick(questionId: string): boolean {
  return questionId === "Q4" || questionId === "Q7";
}

async function insertAskWithAnswers(
  t: TestDatabase,
  options: {
    answers?: TypedAnswer[];
    text?: string;
    status?: AskStatus;
    recipientId?: string;
    caregiverId?: string;
  } = {},
): Promise<string> {
  const askId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const answers = options.answers ?? HERO_ANSWERS;
  const text = options.text ?? HERO_TEXT;

  await t.db.insert(ask).values({
    id: askId,
    churchId: seedIds.church,
    caregiverId: options.caregiverId ?? seedIds.people.marta,
    careRecipientId: options.recipientId ?? seedIds.careRecipients.elena,
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

  return askId;
}

async function buildDrafts(t: TestDatabase, askId: string): Promise<void> {
  const result = await constructDraftSlots({
    askId,
    churchId: seedIds.church,
    database: t.db,
    now: NOW,
  });
  if (result.reason !== "created") {
    throw new Error(`expected drafts, got ${result.reason}`);
  }
}

async function approve(t: TestDatabase, askId: string): Promise<void> {
  const result = await approveAskForCoordinator(GRACE, askId, t.db, NOW);
  if (!result.ok) throw new Error(result.message);
}

async function openAskWithSlots(t: TestDatabase): Promise<string> {
  const askId = await insertAskWithAnswers(t);
  await buildDrafts(t, askId);
  await approve(t, askId);
  return askId;
}

async function slotRows(t: TestDatabase, askId: string) {
  return t.db
    .select()
    .from(slot)
    .where(eq(slot.askId, askId))
    .orderBy(asc(slot.kind));
}

const BOARD_SLOT_KEYS = [
  "approvedAt",
  "approvedByName",
  "claim",
  "gated",
  "id",
  "kind",
  "label",
  "publishedVia",
  "sessionId",
  "status",
  "tier",
  "windowEnd",
  "windowStart",
].sort();

describe("the congregation board projection", () => {
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

  it("returns exactly the allow-listed keys and no story", async () => {
    await openAskWithSlots(t);
    const board = await getBoard(RUTH, t.db, NOW);
    if (!board) throw new Error("expected a board");

    expect(board.timeZone).toBe("America/New_York");
    expect(board.coordinatorFirstName).toBe("Grace");
    expect(board.slots).toHaveLength(2);

    for (const row of board.slots) {
      expect(Object.keys(row).sort()).toEqual(BOARD_SLOT_KEYS);
      expect(row.approvedByName).toBe("Grace");
      expect(row.approvedAt?.toISOString()).toBe(NOW.toISOString());
      expect(row.status).toBe("open");
    }

    const serialized = JSON.stringify(board);
    for (const forbidden of [
      "Marta",
      "Alvarez",
      "Elena",
      "June",
      "Mr. Rao",
      "diagnos",
      "orientation",
      "Mum is fine",
      "since March",
      "teapot",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    // No shaming metric exists in the payload at all.
    expect(serialized).not.toMatch(
      /places? left|remaining|views?|viewed|declines?|declined|waiting time|unclaimed/i,
    );

    // A caregiver never sees the board, even with a real ask of their own.
    await expect(getBoard(MARTA, t.db, NOW)).rejects.toBeInstanceOf(AuthError);
  });

  it("keeps a real waiting ask and its drafts off a board that is showing open times", async () => {
    await openAskWithSlots(t);
    const waitingAsk = await insertAskWithAnswers(t, {
      answers: HERO_ANSWERS,
      text: WAITING_TEXT,
      recipientId: seedIds.careRecipients.mrRao,
      caregiverId: seedIds.people.priya,
    });
    await buildDrafts(t, waitingAsk);

    const waitingSlots = await slotRows(t, waitingAsk);
    expect(waitingSlots.length).toBeGreaterThan(0);
    expect(waitingSlots.every((row) => row.status === "draft")).toBe(true);

    const board = await getBoard(RUTH, t.db, NOW);
    if (!board) throw new Error("expected a board");

    const boardIds = board.slots.map((row) => row.id);
    expect(boardIds.length).toBeGreaterThan(0);
    for (const draft of waitingSlots) {
      expect(boardIds).not.toContain(draft.id);
    }
    expect(board.slots.every((row) => row.status === "open")).toBe(true);
    expect([...BOARD_VISIBLE_STATUSES]).not.toContain("draft");

    const serialized = JSON.stringify(board);
    for (const forbidden of [
      "Mr. Rao",
      "Priya",
      "My father needs someone",
      "appointment",
      ...waitingSlots.map((row) => row.id),
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // The approved ask is genuinely on the board, so the absence above is not
    // an empty-query false positive.
    expect(board.slots).toHaveLength(2);
    expect(serialized).toContain("Companion place at Respite Morning");
  });

  it("never surfaces an open row that did not pass the human gate", async () => {
    const askId = await insertAskWithAnswers(t);
    await t.db.insert(slot).values({
      askId,
      churchId: seedIds.church,
      kind: "meal",
      tier: "doorstep",
      label: "A meal — Saturday",
      windowStart: new Date("2026-11-21T17:00:00.000Z"),
      windowEnd: new Date("2026-11-21T18:00:00.000Z"),
      gated: false,
      status: "open",
      approvedAt: null,
      approvedBy: null,
    });
    await t.db.insert(slot).values({
      askId,
      churchId: seedIds.church,
      kind: "companion",
      tier: "public_event",
      label: "Companion place at Respite Morning",
      windowStart: null,
      windowEnd: null,
      gated: false,
      status: "draft",
      approvedAt: NOW,
      approvedBy: seedIds.people.grace,
    });

    const board = await getBoard(RUTH, t.db, NOW);
    expect(board?.slots).toHaveLength(0);
  });

  it("explains the in-home gate for this viewer and unlocks the checklist path", async () => {
    await openAskWithSlots(t);

    const ruth = await getBoard(RUTH, t.db, NOW);
    const tom = await getBoard(TOM, t.db, NOW);
    const sara = await getBoard(SARA, t.db, NOW);
    const ben = await getBoard(BEN, t.db, NOW);
    if (!ruth || !tom || !sara || !ben) throw new Error("expected boards");

    const homeOf = (board: typeof ruth) =>
      board.slots.find((row) => row.kind === "home");
    const companionOf = (board: typeof ruth) =>
      board.slots.find((row) => row.kind === "companion");

    // Ruth is an attested familiar face for Elena.
    expect(homeOf(ruth)?.claim).toEqual({ eligible: true });
    // Sara is not, but has a current checklist, two references, training and
    // background dates — the checklist path opens the same door.
    expect(homeOf(sara)?.claim).toEqual({ eligible: true });
    // Ben has the same current checklist path.
    expect(homeOf(ben)?.claim).toEqual({ eligible: true });
    // Tom has no checklist and one reference, so he sees a reason and a fix.
    expect(homeOf(tom)?.claim).toEqual({
      eligible: false,
      ruleCode: "no_checklist",
    });
    // The ungated companion time stays open to every active volunteer.
    for (const board of [ruth, tom, sara, ben]) {
      expect(companionOf(board)?.claim).toEqual({ eligible: true });
    }

    // An expired checklist is a different reason from a missing one.
    await t.db
      .update(volunteer)
      .set({
        checklistCompletedAt: new Date("2025-01-05T14:00:00.000Z"),
        referencesContacted: 2,
        trainingExpiresOn: "2026-01-05",
        backgroundRenewsOn: "2026-01-05",
      })
      .where(eq(volunteer.personId, seedIds.people.tom));

    const expired = await getBoard(TOM, t.db, NOW);
    if (!expired) throw new Error("expected a board");
    expect(homeOf(expired)?.claim).toEqual({
      eligible: false,
      ruleCode: "checklist_expired",
    });
  });

  it("shows a calm claimed state with no note, no claimant, and no action", async () => {
    const askId = await openAskWithSlots(t);
    const rows = await slotRows(t, askId);
    const home = rows.find((row) => row.kind === "home");
    if (!home) throw new Error("expected a home slot");

    const note = "ORIENTATION CANARY: the blue teapot is in the cupboard.";
    await t.db
      .update(slot)
      .set({
        status: "claimed",
        claimedBy: seedIds.people.sara,
        claimedAt: NOW,
        orientationNote: note,
      })
      .where(eq(slot.id, home.id));

    const claimedBoard = await getBoard(RUTH, t.db, NOW);
    const claimed = claimedBoard?.slots.find((row) => row.id === home.id);
    expect(claimed?.status).toBe("claimed");
    expect(claimed?.claim).toBeNull();
    expect(JSON.stringify(claimedBoard)).not.toContain(note);
    expect(JSON.stringify(claimedBoard)).not.toContain("Sara");
    expect(JSON.stringify(claimedBoard)).not.toContain("Bennett");

    await t.db
      .update(slot)
      .set({ status: "covered" })
      .where(eq(slot.id, home.id));

    const coveredBoard = await getBoard(RUTH, t.db, NOW);
    expect(
      coveredBoard?.slots.find((row) => row.id === home.id)?.status,
    ).toBe("covered");
    expect(JSON.stringify(coveredBoard)).not.toContain(note);
  });

  it("shows a desk viewer the same times without a claim action", async () => {
    await openAskWithSlots(t);
    const board = await getBoard(GRACE, t.db, NOW);
    if (!board) throw new Error("expected a board");
    expect(board.slots.length).toBeGreaterThan(0);
    for (const row of board.slots) {
      expect(row.claim).toBeNull();
    }
  });

  it("refuses a coordinator from another church", async () => {
    await openAskWithSlots(t);
    // A church scope that has no church row yields no board at all. The
    // seeded church's slots are never selected with another scope.
    await expect(
      getBoard(FOREIGN_COORDINATOR, t.db, NOW),
    ).resolves.toBeNull();
  });
});

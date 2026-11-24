import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
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
import { claimSlot } from "../../src/server/repositories/claims";
import {
  getMyClaim,
  listMyClaims,
  markClaimDone,
  recordVisitCheckpoint,
} from "../../src/server/repositories/my-claims";
import { approveAskForCoordinator } from "../../src/server/services/ask-review";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { constructDraftSlots } from "../../src/server/services/slot-construction";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-CLAIM-005, VAL-CLAIM-006, VAL-ACCESS-004, and the draft rule on the
 * volunteer's own claim reads.
 *
 * The list never selects the orientation note. The detail selects it only when
 * the claim's status is `covered` or `done`, and always with the claimer's own
 * `claimed_by` predicate, so another volunteer, a caregiver, a coordinator, and
 * a foreign church get nothing. Check-in, check-out, and done are conditional
 * writes with an append-only audit row in the same transaction.
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

const FOREIGN_VOLUNTEER: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: "c9999999-9999-4999-8999-999999999999",
};

const HERO_TEXT =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

const WAITING_TEXT =
  "My father needs someone to sit with him on Saturday while I go to an appointment. He knows Ruth from church.";

const NOTE_CANARY =
  "ORIENTATION CANARY: the blue teapot is in the second cupboard, and Elena takes her tea weak.";

const CLAIM_KEYS = [
  "claimedAt",
  "gated",
  "id",
  "kind",
  "label",
  "status",
  "tier",
  "windowEnd",
  "windowStart",
].sort();

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

async function insertAskWithAnswers(
  t: TestDatabase,
  options: {
    text?: string;
    recipientId?: string;
    caregiverId?: string;
  } = {},
): Promise<string> {
  const askId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const text = options.text ?? HERO_TEXT;

  await t.db.insert(ask).values({
    id: askId,
    churchId: seedIds.church,
    caregiverId: options.caregiverId ?? seedIds.people.marta,
    careRecipientId: options.recipientId ?? seedIds.careRecipients.elena,
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

async function cover(t: TestDatabase, slotId: string, note = NOTE_CANARY) {
  await t.db
    .update(slot)
    .set({
      status: "covered",
      orientationNote: note,
      claimConfirmedBy: seedIds.people.grace,
      claimConfirmedAt: new Date("2026-11-20T16:00:00.000Z"),
    })
    .where(eq(slot.id, slotId));
}

async function visitAuditRows(t: TestDatabase) {
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
      inArray(auditEvent.action, [
        "slot_checked_in",
        "slot_checked_out",
        "slot_done",
      ]),
    )
    .orderBy(auditEvent.createdAt);
}

describe("a volunteer's own claims", () => {
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

  it("lists only the viewer's claims with an allow-listed projection", async () => {
    const askId = await openAskWithSlots(t);
    const rows = await slotsFor(t, askId);
    const companion = rows.find((row) => row.kind === "companion");
    const home = rows.find((row) => row.kind === "home");
    if (!companion || !home) throw new Error("expected companion and home");

    await claim(t, RUTH, companion.id);
    await claim(t, SARA, home.id);

    // A real waiting ask keeps its draft slots in the database, behind the
    // page the volunteer can actually fetch.
    const waitingAsk = await insertAskWithAnswers(t, {
      text: WAITING_TEXT,
      recipientId: seedIds.careRecipients.mrRao,
      caregiverId: seedIds.people.priya,
    });
    await buildDrafts(t, waitingAsk);
    const waitingSlots = await slotsFor(t, waitingAsk);
    expect(waitingSlots.length).toBeGreaterThan(0);
    expect(waitingSlots.every((row) => row.status === "draft")).toBe(true);

    const ruth = await listMyClaims(RUTH, t.db);
    expect(ruth.timeZone).toBe("America/New_York");
    expect(ruth.coordinatorFirstName).toBe("Grace");
    expect(ruth.claims).toHaveLength(1);
    expect(ruth.claims[0].id).toBe(companion.id);
    expect(Object.keys(ruth.claims[0]).sort()).toEqual(CLAIM_KEYS);
    expect(ruth.claims[0].status).toBe("claimed");

    // Sara sees her own home claim and never Ruth's.
    const sara = await listMyClaims(SARA, t.db);
    expect(sara.claims.map((row) => row.id)).toEqual([home.id]);

    const serialized = JSON.stringify(ruth);
    for (const forbidden of [
      "Sara",
      "Bennett",
      "orientation",
      "ORIENTATION CANARY",
      "Elena",
      "hymns and tea",
      "My father needs someone",
      "appointment",
      ...waitingSlots.map((row) => row.id),
      home.id,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // No shaming metric exists in a volunteer's payload.
    expect(serialized).not.toMatch(
      /places? left|remaining|views?|viewed|declines?|declined|waiting time|unclaimed/i,
    );

    // A waiting ask's drafts are not claims even for the volunteer who will
    // later claim one of them.
    const ruthIds = ruth.claims.map((row) => row.id);
    for (const draft of waitingSlots) {
      expect(ruthIds).not.toContain(draft.id);
    }
  });

  it("withholds the orientation note until the coordinator approves the claim", async () => {
    const askId = await openAskWithSlots(t);
    const rows = await slotsFor(t, askId);
    const companion = rows.find((row) => row.kind === "companion");
    if (!companion) throw new Error("expected a companion slot");

    await claim(t, RUTH, companion.id);
    await t.db
      .update(slot)
      .set({ orientationNote: NOTE_CANARY })
      .where(eq(slot.id, companion.id));

    // Pre-approval: the detail carries the facts of the time but no note, and
    // the note is not even selected by the read.
    const before = await getMyClaim(RUTH, companion.id, t.db);
    if (!before) throw new Error("expected the claim");
    expect(before.status).toBe("claimed");
    expect(before.noteVisible).toBe(false);
    expect(before.orientationNote).toBeNull();
    const beforeJson = JSON.stringify(before);
    expect(beforeJson).not.toContain(NOTE_CANARY);
    expect(beforeJson).not.toContain("Elena");
    expect(beforeJson).not.toContain("hymns and tea");
    expect(beforeJson).not.toContain("since March");
    // No ask identity is part of the claim read at all.
    expect(Object.keys(before)).not.toContain("askId");

    const listBefore = JSON.stringify(await listMyClaims(RUTH, t.db));
    expect(listBefore).not.toContain(NOTE_CANARY);
    expect(listBefore).not.toContain("Elena");

    // The coordinator approves the claim: covered.
    await cover(t, companion.id);

    const after = await getMyClaim(RUTH, companion.id, t.db);
    if (!after) throw new Error("expected the claim");
    expect(after.status).toBe("covered");
    expect(after.noteVisible).toBe(true);
    expect(after.orientationNote).toBe(NOTE_CANARY);

    // The list stays note-free after approval: the list is a list of times,
    // and the note lives on the detail page only.
    const listAfter = JSON.stringify(await listMyClaims(RUTH, t.db));
    expect(listAfter).not.toContain(NOTE_CANARY);
    expect(listAfter).not.toContain("Elena");

    // `done` keeps the note readable: the visit has happened.
    await t.db
      .update(slot)
      .set({ status: "done" })
      .where(eq(slot.id, companion.id));
    const done = await getMyClaim(RUTH, companion.id, t.db);
    expect(done?.status).toBe("done");
    expect(done?.orientationNote).toBe(NOTE_CANARY);
  });

  it("refuses another volunteer, a caregiver, a coordinator, and a foreign church", async () => {
    const askId = await openAskWithSlots(t);
    const rows = await slotsFor(t, askId);
    const companion = rows.find((row) => row.kind === "companion");
    if (!companion) throw new Error("expected a companion slot");

    await claim(t, RUTH, companion.id);
    await cover(t, companion.id);

    // Another volunteer: their own list is empty and a changed id finds
    // nothing; there is no note in either response.
    await expect(getMyClaim(SARA, companion.id, t.db)).resolves.toBeNull();
    const sara = await listMyClaims(SARA, t.db);
    expect(sara.claims).toEqual([]);
    expect(JSON.stringify(sara)).not.toContain(NOTE_CANARY);
    expect(JSON.stringify(sara)).not.toContain("Elena");

    // Roles that are not volunteers are refused by the repository itself.
    await expect(
      getMyClaim(MARTA, companion.id, t.db),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      getMyClaim(GRACE, companion.id, t.db),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(listMyClaims(MARTA, t.db)).rejects.toBeInstanceOf(AuthError);
    await expect(listMyClaims(GRACE, t.db)).rejects.toBeInstanceOf(AuthError);

    // A volunteer session whose church scope is not this church sees nothing.
    await expect(
      getMyClaim(FOREIGN_VOLUNTEER, companion.id, t.db),
    ).resolves.toBeNull();

    // A draft slot, even in the actor's own church, is not a claim.
    const waitingAsk = await insertAskWithAnswers(t, {
      text: WAITING_TEXT,
      recipientId: seedIds.careRecipients.mrRao,
      caregiverId: seedIds.people.priya,
    });
    await buildDrafts(t, waitingAsk);
    const draft = (await slotsFor(t, waitingAsk))[0];
    await expect(
      getMyClaim(RUTH, draft.id, t.db),
    ).resolves.toBeNull();
  });

  it("checks a home visit in and out once each and audits both", async () => {
    const askId = await openAskWithSlots(t);
    const rows = await slotsFor(t, askId);
    const home = rows.find((row) => row.kind === "home");
    const companion = rows.find((row) => row.kind === "companion");
    if (!home || !companion) throw new Error("expected home and companion");

    await claim(t, RUTH, home.id);
    await cover(t, home.id);
    await claim(t, RUTH, companion.id);
    await cover(t, companion.id);

    const checkedIn = await recordVisitCheckpoint(
      RUTH,
      home.id,
      "check_in",
      t.db,
      NOW,
    );
    expect(checkedIn.ok).toBe(true);
    if (checkedIn.ok) {
      expect(checkedIn.code).toBe("checked_in");
      expect(checkedIn.checkedInAt?.toISOString()).toBe(NOW.toISOString());
    }

    const duplicate = await recordVisitCheckpoint(
      RUTH,
      home.id,
      "check_in",
      t.db,
      NOW,
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.code).toBe("already_checked_in");

    // Another volunteer can never write a checkpoint on Ruth's visit.
    const stranger = await recordVisitCheckpoint(
      SARA,
      home.id,
      "check_out",
      t.db,
      NOW,
    );
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.code).toBe("not_found");

    // Check-in is a home-visit action, not a general claim action.
    const companionCheckIn = await recordVisitCheckpoint(
      RUTH,
      companion.id,
      "check_in",
      t.db,
      NOW,
    );
    expect(companionCheckIn.ok).toBe(false);
    if (!companionCheckIn.ok) expect(companionCheckIn.code).toBe("not_home");

    const checkedOut = await recordVisitCheckpoint(
      RUTH,
      home.id,
      "check_out",
      t.db,
      NOW,
    );
    expect(checkedOut.ok).toBe(true);
    if (checkedOut.ok) expect(checkedOut.code).toBe("checked_out");

    const again = await recordVisitCheckpoint(
      RUTH,
      home.id,
      "check_out",
      t.db,
      NOW,
    );
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("already_checked_out");

    const audit = await visitAuditRows(t);
    expect(audit.map((row) => row.action)).toEqual([
      "slot_checked_in",
      "slot_checked_out",
    ]);
    for (const row of audit) {
      expect(row.actorId).toBe(seedIds.people.ruth);
      expect(row.entityId).toBe(home.id);
      expect(typeof row.detail.at).toBe("string");
    }
    // The refused attempts did not write checkpoints.
    expect(
      audit.filter((row) => row.actorId === seedIds.people.sara),
    ).toHaveLength(0);

    const detail = await getMyClaim(RUTH, home.id, t.db);
    expect(detail?.visit.checkedInAt?.toISOString()).toBe(NOW.toISOString());
    expect(detail?.visit.checkedOutAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("marks a covered claim done only after its window and audits it", async () => {
    const askId = await openAskWithSlots(t);
    const rows = await slotsFor(t, askId);
    const home = rows.find((row) => row.kind === "home");
    if (!home) throw new Error("expected a home slot");

    await claim(t, RUTH, home.id);

    // A claim waiting for confirmation cannot be closed.
    const unconfirmed = await markClaimDone(RUTH, home.id, t.db, NOW);
    expect(unconfirmed.ok).toBe(false);
    if (!unconfirmed.ok) expect(unconfirmed.code).toBe("not_covered");

    await cover(t, home.id);

    // The constructed home window is this Saturday, after NOW.
    const early = await markClaimDone(RUTH, home.id, t.db, NOW);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe("too_early");

    // Another volunteer cannot close Ruth's claim.
    const stranger = await markClaimDone(SARA, home.id, t.db, NOW);
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.code).toBe("not_found");

    const past = new Date("2026-11-14T15:00:00.000Z");
    await t.db
      .update(slot)
      .set({ windowStart: past, windowEnd: new Date("2026-11-14T17:00:00.000Z") })
      .where(eq(slot.id, home.id));

    const marked = await markClaimDone(RUTH, home.id, t.db, NOW);
    expect(marked.ok).toBe(true);
    if (marked.ok) expect(marked.code).toBe("done");

    const [row] = await t.db
      .select({ status: slot.status })
      .from(slot)
      .where(eq(slot.id, home.id));
    expect(row.status).toBe("done");

    const again = await markClaimDone(RUTH, home.id, t.db, NOW);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("already_done");

    const audit = await visitAuditRows(t);
    const done = audit.filter((row) => row.action === "slot_done");
    expect(done).toHaveLength(1);
    expect(done[0].actorId).toBe(seedIds.people.ruth);
    expect(done[0].detail.previousStatus).toBe("covered");

    // The list shows the finished time, and the note remains readable.
    const list = await listMyClaims(RUTH, t.db);
    expect(list.claims.map((entry) => entry.status)).toEqual(["done"]);
    const detail = await getMyClaim(RUTH, home.id, t.db);
    expect(detail?.noteVisible).toBe(true);
    expect(detail?.orientationNote).toBe(NOTE_CANARY);
  });
});

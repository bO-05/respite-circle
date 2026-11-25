import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { SEED_REFERENCE_DATE, seedIds } from "../../src/db/seed-data";
import { ask, askRevision, auditEvent, decision, slot } from "../../src/db/schema";
import type { Actor } from "../../src/server/auth/policy";
import { claimCopy } from "../../src/server/domain/claim";
import type { TypedAnswer } from "../../src/server/domain/slots";
import { getBoard } from "../../src/server/repositories/board";
import { claimSlot } from "../../src/server/repositories/claims";
import { approveAskForCoordinator } from "../../src/server/services/ask-review";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { constructDraftSlots } from "../../src/server/services/slot-construction";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-R2PROM-001 against the isolated database.
 *
 * A published time is offered only until it starts. These cases read the real
 * board query and the real claim statement at two sides of one slot's start,
 * with the boundary moved by `RC_FAKE_NOW` rather than written into the test:
 *
 *   - one millisecond before its start, the time lists and an eligible
 *     volunteer can take it;
 *   - at the start instant — "at or before now" — the board omits it, the
 *     claim predicate matches no row, the refusal is the existing plain
 *     `not_open` sentence, and no claim column, audit win, or status changes;
 *   - a later time in the same church still lists and still claims, so the
 *     boundary is the slot's own start and not a global switch.
 *
 * No `now` argument is passed to either repository in the clock cases: the
 * default clock is the app's one clock (`resolveNow`), so this is the same
 * reader the page and the route use.
 */

const NOW = SEED_REFERENCE_DATE; // Tuesday 17 November 2026, 10:00 in New York

const GRACE: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: seedIds.church,
};

const RUTH: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: seedIds.church,
};

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

function isPick(questionId: string): boolean {
  return questionId === "Q4" || questionId === "Q7";
}

async function insertAskWithAnswers(t: TestDatabase): Promise<string> {
  const askId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const text = HERO_TEXT;

  await t.db.insert(ask).values({
    id: askId,
    churchId: seedIds.church,
    caregiverId: seedIds.people.marta,
    careRecipientId: seedIds.careRecipients.elena,
    verbatimText: text,
    status: "waiting_coordinator",
    policyVersionId: seedIds.policyV1,
    createdAt: new Date(NOW.getTime() - 60 * 60 * 1_000),
  });

  await t.db.insert(askRevision).values({
    id: revisionId,
    askId,
    verbatimText: text,
    digest: sha256Hex(text),
    createdAt: NOW,
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
      createdAt: NOW,
    })),
  );

  return askId;
}

async function openAskWithSlots(t: TestDatabase): Promise<{
  askId: string;
  companionId: string;
  companionStart: Date;
  homeId: string;
  homeStart: Date;
}> {
  const askId = await insertAskWithAnswers(t);

  const drafts = await constructDraftSlots({
    askId,
    churchId: seedIds.church,
    database: t.db,
    now: NOW,
  });
  if (drafts.reason !== "created") {
    throw new Error(`expected drafts, got ${drafts.reason}`);
  }

  const approved = await approveAskForCoordinator(GRACE, askId, t.db, NOW);
  if (!approved.ok) throw new Error(approved.message);

  const rows = await t.db
    .select()
    .from(slot)
    .where(eq(slot.askId, askId))
    .orderBy(asc(slot.kind));

  const companion = rows.find((row) => row.kind === "companion");
  const home = rows.find((row) => row.kind === "home");
  if (!companion?.windowStart || !home?.windowStart) {
    throw new Error("expected a companion and a home draft with windows");
  }

  return {
    askId,
    companionId: companion.id,
    companionStart: companion.windowStart,
    homeId: home.id,
    homeStart: home.windowStart,
  };
}

async function slotRow(t: TestDatabase, slotId: string) {
  const [row] = await t.db.select().from(slot).where(eq(slot.id, slotId));
  return row;
}

async function auditActions(
  t: TestDatabase,
  slotId: string,
): Promise<Array<{ action: string; detail: unknown }>> {
  return t.db
    .select({ action: auditEvent.action, detail: auditEvent.detail })
    .from(auditEvent)
    .where(
      and(eq(auditEvent.entity, "slot"), eq(auditEvent.entityId, slotId)),
    )
    .orderBy(asc(auditEvent.createdAt));
}

/** Run `work` with `RC_FAKE_NOW` set, restoring the previous value afterwards. */
async function withFakeNow<T>(
  instant: Date | string,
  work: () => Promise<T>,
): Promise<T> {
  const value = instant instanceof Date ? instant.toISOString() : instant;
  const previous = process.env.RC_FAKE_NOW;
  process.env.RC_FAKE_NOW = value;
  try {
    return await work();
  } finally {
    if (previous === undefined) delete process.env.RC_FAKE_NOW;
    else process.env.RC_FAKE_NOW = previous;
  }
}

describe("VAL-R2PROM-001 — the board and the claim stop at a slot's start", () => {
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

  it("lists a time one millisecond before its start and omits it at the start, while a later time stays", async () => {
    const { companionId, companionStart, homeId, homeStart } =
      await openAskWithSlots(t);
    expect(homeStart.getTime()).toBeLessThan(companionStart.getTime());

    // One millisecond before the home visit starts: both times are offered.
    const before = await withFakeNow(
      new Date(homeStart.getTime() - 1),
      () => getBoard(RUTH, t.db),
    );
    expect(before).not.toBeNull();
    const beforeIds = before?.slots.map((row) => row.id) ?? [];
    expect(beforeIds).toContain(homeId);
    expect(beforeIds).toContain(companionId);
    expect(before?.slots.every((row) => row.status === "open")).toBe(true);

    // At the start instant: the home visit is gone, the later companion place
    // is untouched. This is the same slot, the same query, one clock step.
    const at = await withFakeNow(homeStart, () => getBoard(RUTH, t.db));
    const atIds = at?.slots.map((row) => row.id) ?? [];
    expect(atIds).not.toContain(homeId);
    expect(atIds).toContain(companionId);
    expect(at?.slots.find((row) => row.id === companionId)?.status).toBe("open");

    // One millisecond after: still gone.
    const after = await withFakeNow(
      new Date(homeStart.getTime() + 1),
      () => getBoard(RUTH, t.db),
    );
    expect(after?.slots.map((row) => row.id) ?? []).not.toContain(homeId);

    // When the later place's own start arrives, the board is empty: the rule
    // follows each row's window, not a single cut-off shared by the church.
    const atCompanion = await withFakeNow(companionStart, () =>
      getBoard(RUTH, t.db),
    );
    expect(atCompanion?.slots ?? []).toHaveLength(0);
  });

  it("hides a claimed time whose start has passed too, because it is no longer an offer", async () => {
    const { companionId, homeId, homeStart } = await openAskWithSlots(t);

    await t.db
      .update(slot)
      .set({
        status: "claimed",
        claimedBy: seedIds.people.ruth,
        claimedAt: new Date(homeStart.getTime() - 60 * 60 * 1_000),
      })
      .where(eq(slot.id, homeId));

    const board = await withFakeNow(homeStart, () => getBoard(RUTH, t.db));
    const ids = board?.slots.map((row) => row.id) ?? [];
    expect(ids).not.toContain(homeId);
    expect(ids).toContain(companionId);
  });

  it("lets an eligible volunteer claim one millisecond before the start", async () => {
    const { homeId, homeStart } = await openAskWithSlots(t);

    const result = await withFakeNow(
      new Date(homeStart.getTime() - 1),
      () => claimSlot(RUTH, homeId, t.db),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.code).toBe("claimed");

    const row = await slotRow(t, homeId);
    expect(row.status).toBe("claimed");
    expect(row.claimedBy).toBe(seedIds.people.ruth);

    const actions = await auditActions(t, homeId);
    expect(actions.map((entry) => entry.action)).toContain("slot_claimed");
  });

  it("refuses a claim at the start with the existing plain error and writes nothing", async () => {
    const { companionId, homeId, homeStart } = await openAskWithSlots(t);
    const before = await slotRow(t, homeId);

    const refused = await withFakeNow(homeStart, () =>
      claimSlot(RUTH, homeId, t.db),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("a started time must not be claimable");
    expect(refused.code).toBe("not_open");
    // The existing sentence, not a new one composed for this case.
    expect(refused.message).toBe(claimCopy("not_open"));
    expect(refused.slotId).toBe(homeId);

    // No write: not one claim column, not the status, not a winning audit row.
    const after = await slotRow(t, homeId);
    expect(after.status).toBe("open");
    expect(after.claimedBy).toBeNull();
    expect(after.claimedAt).toBeNull();
    expect(after.claimConfirmedBy).toBeNull();
    expect(after.claimConfirmedAt).toBeNull();
    expect(after.status).toBe(before.status);
    expect(after.approvedAt?.toISOString() ?? null).toBe(
      before.approvedAt?.toISOString() ?? null,
    );

    const actions = await auditActions(t, homeId);
    expect(actions.map((entry) => entry.action)).not.toContain("slot_claimed");
    const refusals = actions.filter(
      (entry) => entry.action === "claim_refused",
    );
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.detail).toMatchObject({
      reason: "not_open",
      slotStatus: "open",
      windowStarted: true,
    });

    // The later time at the same clock is still claimable, so the refusal came
    // from this slot's window and not from the claimer or the clock itself.
    const companion = await withFakeNow(homeStart, () =>
      claimSlot(RUTH, companionId, t.db),
    );
    expect(companion.ok).toBe(true);
  });

  it("refuses a started time through the SQL predicate even when the client sends a perfect claim", async () => {
    const { homeId, homeStart } = await openAskWithSlots(t);

    // A direct conditional UPDATE that carries the same gate the claim
    // statement carries, at the start instant. This is the "no matter what the
    // client sends" proof: the statement itself matches zero rows.
    const { claimGatePredicate } = await import(
      "../../src/server/repositories/claim-gate"
    );

    const rows = await t.db
      .update(slot)
      .set({
        claimedBy: seedIds.people.ruth,
        claimedAt: homeStart,
        status: "claimed",
      })
      .where(
        and(
          eq(slot.id, homeId),
          eq(slot.status, "open"),
          claimGatePredicate({
            personId: seedIds.people.ruth,
            churchId: seedIds.church,
            now: homeStart,
          }),
        ),
      )
      .returning({ id: slot.id });

    expect(rows).toHaveLength(0);
    const row = await slotRow(t, homeId);
    expect(row.status).toBe("open");
    expect(row.claimedBy).toBeNull();
  });
});

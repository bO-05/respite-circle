import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import {
  SEED_REFERENCE_DATE,
  seedIds,
  seedPolicy,
} from "../../src/db/seed-data";
import {
  ask,
  askRevision,
  auditEvent,
  decision,
  policy,
  slot,
  slotCandidate,
} from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import {
  canPublishDraft,
  type TypedAnswer,
} from "../../src/server/domain/slots";
import {
  addDraftSlot,
  getDraftEditorContext,
  getDraftSlotActionContext,
  holdDraftSlot,
  releaseDraftSlot,
  removeDraftSlot,
  updateDraftSlot,
} from "../../src/server/repositories/draft-slots";
import { constructDraftSlots } from "../../src/server/services/slot-construction";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * Draft slot construction and the editor's data layer, against the isolated
 * `respite_circle_e2e` database.
 *
 * VAL-DESK-003 and VAL-DESK-007, plus the invariants around them: drafts are
 * `status='draft'`, invisible to every congregation query; a held draft cannot
 * be published until resolved; a drive needs the signed driver policy; and a
 * personal-care or safety ask never produces a slot through any path.
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

const OTHER_CHURCH = "c9999999-9999-4999-8999-999999999999";
const OTHER_COORDINATOR: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: OTHER_CHURCH,
};

const TRANSPORT_POLICY_ID = "b0000000-0000-4000-8000-000000000002";

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
    policyVersionId?: string;
    text?: string;
    askId?: string;
  } = {},
): Promise<{ askId: string; revisionId: string }> {
  const askId = options.askId ?? crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const answers = options.answers ?? HERO_ANSWERS;
  const policyVersionId = options.policyVersionId ?? seedIds.policyV1;
  const text =
    options.text ??
    "I haven't had a Saturday morning to myself since March.";

  await t.db.insert(ask).values({
    id: askId,
    churchId: seedIds.church,
    caregiverId: seedIds.people.marta,
    careRecipientId: seedIds.careRecipients.elena,
    verbatimText: text,
    status: options.status ?? "waiting_coordinator",
    policyVersionId,
  });

  await t.db.insert(askRevision).values({
    id: revisionId,
    askId,
    verbatimText: text,
    digest: sha256Hex(text),
  });

  if (answers.length > 0) {
    await t.db.insert(decision).values(
      answers.map((entry, index) => ({
        askId,
        askRevisionId: revisionId,
        policyVersionId,
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
  }

  return { askId, revisionId };
}

async function insertTransportPolicy(t: TestDatabase): Promise<void> {
  await t.db.insert(policy).values({
    id: TRANSPORT_POLICY_ID,
    churchId: seedIds.church,
    version: 2,
    safeguardingPromises: [...seedPolicy.safeguardingPromises],
    questionSet: seedPolicy.questionSet.map((question) => ({ ...question })),
    crisisScript: seedPolicy.crisisScript,
    localCrisisLine: seedPolicy.localCrisisLine,
    referralResources: seedPolicy.referralResources.map((resource) => ({
      ...resource,
    })),
    familiarFaceDefault: true,
    reminderWindowHours: 24,
    callThresholdHours: 48,
    transportEnabled: true,
    autoPublishLowRisk: false,
    signedOffBy: "Grace Whitfield",
    signedOffAt: new Date("2026-11-16T15:00:00.000Z"),
  });
}

async function readSlots(t: TestDatabase, askId: string) {
  return t.db
    .select()
    .from(slot)
    .where(eq(slot.askId, askId))
    .orderBy(asc(slot.kind));
}

async function auditCount(
  t: TestDatabase,
  action: string,
  entityId?: string,
): Promise<number> {
  const rows = await t.db
    .select({ id: auditEvent.id })
    .from(auditEvent)
    .where(
      entityId
        ? and(eq(auditEvent.action, action), eq(auditEvent.entityId, entityId))
        : eq(auditEvent.action, action),
    );
  return rows.length;
}

describe("draft slot construction", () => {
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

  it("writes a companion place at the next Respite Morning and a gated home Saturday visit", async () => {
    const { askId } = await insertAskWithAnswers(t);

    const result = await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });

    expect(result).toMatchObject({
      created: true,
      reason: "created",
      proposals: 2,
      skipped: [],
      blocked: null,
    });

    const slots = await readSlots(t, askId);
    expect(slots.map((row) => row.kind)).toEqual(["companion", "home"]);
    expect(slots.every((row) => row.status === "draft")).toBe(true);

    const companion = slots[0];
    expect(companion.sessionId).toBe(seedIds.sessions[0]);
    expect(companion.tier).toBe("public_event");
    expect(companion.gated).toBe(false);
    expect(companion.ruleRef).toBe("q1_companion");
    expect(companion.windowStart?.toISOString()).toBe(
      "2026-11-24T15:00:00.000Z",
    );
    expect(companion.windowEnd?.toISOString()).toBe(
      "2026-11-24T19:00:00.000Z",
    );

    const home = slots[1];
    expect(home.tier).toBe("in_home");
    expect(home.gated).toBe(true);
    expect(home.ruleRef).toBe("q6_home");
    expect(home.sessionId).toBeNull();
    expect(home.windowStart?.toISOString()).toBe(
      "2026-11-21T15:00:00.000Z",
    );
    expect(home.windowEnd?.toISOString()).toBe("2026-11-21T17:00:00.000Z");
    expect(home.orientationNote).toContain("Elena");
    expect(home.orientationNote).toMatch(/first visit/i);
    expect(home.orientationNote).toMatch(/no medication/i);

    const [marker] = await t.client<{ slots_constructed_at: Date | null }[]>`
      SELECT slots_constructed_at FROM ask WHERE id = ${askId}
    `;
    expect(marker.slots_constructed_at).not.toBeNull();

    const [proposed] = await t.db
      .select({ detail: auditEvent.detail })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.action, "slots_proposed"),
          eq(auditEvent.entityId, askId),
        ),
      );
    expect(proposed.detail).toMatchObject({
      count: 2,
      kinds: ["companion", "home"],
      skipped: [],
    });

    const context = await getDraftEditorContext(GRACE, askId, t.db);
    expect(context).not.toBeNull();
    expect(context?.slots).toHaveLength(2);
    expect(context?.skipped).toEqual([]);
    expect(context?.proposedCount).toBe(2);
    expect(context?.hasDecisions).toBe(true);
    expect(context?.transportEnabled).toBe(false);
    expect(context?.slots.every((row) => canPublishDraft(row).ok)).toBe(true);
  });

  it("constructs once, and a deleted draft never reappears", async () => {
    const { askId } = await insertAskWithAnswers(t);

    await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });

    const second = await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(second.reason).toBe("already_constructed");
    expect(await readSlots(t, askId)).toHaveLength(2);

    for (const row of await readSlots(t, askId)) {
      const removed = await removeDraftSlot(GRACE, row.id, t.db);
      expect(removed.ok).toBe(true);
    }
    expect(await readSlots(t, askId)).toHaveLength(0);

    const third = await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(third.reason).toBe("already_constructed");
    expect(await readSlots(t, askId)).toHaveLength(0);
  });

  it("offers the next session with room, and records why a full one was skipped", async () => {
    await t.client`
      UPDATE session SET capacity = 0 WHERE id = ${seedIds.sessions[0]}
    `;
    const { askId } = await insertAskWithAnswers(t);

    const next = await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(next.proposals).toBe(2);
    expect(next.skipped).toEqual([]);

    const offered = await readSlots(t, askId);
    const companion = offered.find((row) => row.kind === "companion");
    expect(companion?.sessionId).toBe(seedIds.sessions[1]);

    await t.client`UPDATE session SET capacity = 0`;
    const full = await insertAskWithAnswers(t);

    const result = await constructDraftSlots({
      askId: full.askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });

    expect(result.proposals).toBe(1);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        kind: "companion",
        reason: "no_session_capacity",
      }),
    ]);

    const slots = await readSlots(t, full.askId);
    expect(slots.map((row) => row.kind)).toEqual(["home"]);

    const context = await getDraftEditorContext(GRACE, full.askId, t.db);
    expect(context?.skipped[0]?.message).toMatch(/room/i);
    expect(context?.proposedCount).toBe(1);
  });

  it("proposes no drive when the driver policy is unsigned, and a gated drive when it is", async () => {
    const driveOnly: TypedAnswer[] = [
      answer("Q1", false),
      answer("Q2", true),
      answer("Q3", false),
      answer("Q4", "saturday"),
      answer("Q5", false),
      answer("Q6", false),
      answer("Q7", "unknown"),
      answer("Q8", false),
      answer("Q9", false),
    ];

    const unsigned = await insertAskWithAnswers(t, { answers: driveOnly });
    const blocked = await constructDraftSlots({
      askId: unsigned.askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(blocked.proposals).toBe(0);
    expect(blocked.skipped).toEqual([
      expect.objectContaining({ kind: "drive", reason: "no_driver_policy" }),
    ]);
    expect(await readSlots(t, unsigned.askId)).toHaveLength(0);

    const unsignedContext = await getDraftEditorContext(
      GRACE,
      unsigned.askId,
      t.db,
    );
    expect(unsignedContext?.skipped[0]?.message).toMatch(/driver policy/i);

    await insertTransportPolicy(t);
    const signed = await insertAskWithAnswers(t, {
      answers: driveOnly,
      policyVersionId: TRANSPORT_POLICY_ID,
    });
    const allowed = await constructDraftSlots({
      askId: signed.askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(allowed.proposals).toBe(1);

    const [drive] = await readSlots(t, signed.askId);
    expect(drive.kind).toBe("drive");
    expect(drive.tier).toBe("transport");
    expect(drive.gated).toBe(true);
    expect(drive.ruleRef).toBe("q2_drive");
    expect(drive.windowStart?.toISOString()).toBe(
      "2026-11-21T15:00:00.000Z",
    );

    const context = await getDraftEditorContext(GRACE, signed.askId, t.db);
    expect(context?.transportEnabled).toBe(true);
  });

  it("carries the reheat preference on a meal and no clinical detail", async () => {
    const mealAnswers: TypedAnswer[] = [
      answer("Q1", false),
      answer("Q2", false),
      answer("Q3", true),
      answer("Q4", "saturday"),
      answer("Q5", false),
      answer("Q6", false),
      answer("Q7", "reheats"),
      answer("Q8", false),
      answer("Q9", false),
    ];

    const { askId } = await insertAskWithAnswers(t, { answers: mealAnswers });
    await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });

    const [meal] = await readSlots(t, askId);
    expect(meal.kind).toBe("meal");
    expect(meal.tier).toBe("doorstep");
    expect(meal.gated).toBe(false);
    expect(meal.ruleRef).toBe("q3_meal");
    expect(meal.label).toMatch(/reheat/i);
    expect(meal.orientationNote).toMatch(/reheat/i);
    expect(`${meal.label} ${meal.orientationNote}`).not.toMatch(
      /diagnos|medicat|dementia|clinical|condition/i,
    );
  });

  it("never writes a slot for a safety or personal-care ask, through any path", async () => {
    const safety = await insertAskWithAnswers(t, {
      status: "safety_hold",
      answers: HERO_ANSWERS.map((entry) =>
        entry.questionId === "Q5" ? answer("Q5", true) : entry,
      ),
    });
    const safetyResult = await constructDraftSlots({
      askId: safety.askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(safetyResult.reason).toBe("blocked");
    expect(safetyResult.blocked?.reason).toBe("safety_flag");
    expect(await readSlots(t, safety.askId)).toHaveLength(0);

    const care = await insertAskWithAnswers(t, {
      status: "care_hold",
      answers: HERO_ANSWERS.map((entry) =>
        entry.questionId === "Q9" ? answer("Q9", true) : entry,
      ),
    });
    const careResult = await constructDraftSlots({
      askId: care.askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(careResult.reason).toBe("blocked");
    expect(careResult.blocked?.reason).toBe("personal_care_flag");
    expect(await readSlots(t, care.askId)).toHaveLength(0);

    const manual = await addDraftSlot(
      GRACE,
      { askId: care.askId, kind: "meal" },
      t.db,
      NOW,
    );
    expect(manual.ok).toBe(false);
    if (manual.ok) throw new Error("a personal-care ask accepted a slot");
    expect(manual.message).toMatch(/professional help/i);
    expect(await readSlots(t, care.askId)).toHaveLength(0);

    // Even inconsistent data — a waiting status with Q9 yes — cannot construct.
    const inconsistent = await insertAskWithAnswers(t, {
      answers: HERO_ANSWERS.map((entry) =>
        entry.questionId === "Q9" ? answer("Q9", true) : entry,
      ),
    });
    const inconsistentResult = await constructDraftSlots({
      askId: inconsistent.askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(inconsistentResult.blocked?.reason).toBe("personal_care_flag");
    expect(await readSlots(t, inconsistent.askId)).toHaveLength(0);
  });

  it("keeps the plan empty when a need question abstained, but still lets a person add a time", async () => {
    const uncertain = await insertAskWithAnswers(t, {
      answers: HERO_ANSWERS.map((entry) =>
        entry.questionId === "Q3" ? answer("Q3", true, true) : entry,
      ),
    });

    const result = await constructDraftSlots({
      askId: uncertain.askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(result.reason).toBe("blocked");
    expect(result.blocked?.reason).toBe("abstained");
    expect(result.blocked?.questionIds).toContain("Q3");
    expect(await readSlots(t, uncertain.askId)).toHaveLength(0);

    const manual = await addDraftSlot(
      GRACE,
      { askId: uncertain.askId, kind: "meal" },
      t.db,
      NOW,
    );
    expect(manual.ok).toBe(true);

    const context = await getDraftEditorContext(GRACE, uncertain.askId, t.db);
    expect(context?.slots).toHaveLength(1);
    expect(context?.slots[0].ruleRef).toBe("manual");
  });

  it("edits every field of a draft, with an audit row and no change to the words", async () => {
    const { askId } = await insertAskWithAnswers(t);
    await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    const slots = await readSlots(t, askId);
    const home = slots.find((row) => row.kind === "home");
    if (!home) throw new Error("expected a home draft");

    const updated = await updateDraftSlot(
      GRACE,
      {
        slotId: home.id,
        kind: "meal",
        tier: "doorstep",
        label: "A Saturday lunch at the door",
        windowStart: new Date("2026-11-21T17:00:00.000Z"),
        windowEnd: new Date("2026-11-21T18:00:00.000Z"),
        gated: false,
        orientationNote: "Leave it at the door and text the coordinator.",
      },
      t.db,
    );
    expect(updated.ok).toBe(true);

    const [row] = await t.db.select().from(slot).where(eq(slot.id, home.id));
    expect(row.kind).toBe("meal");
    expect(row.tier).toBe("doorstep");
    expect(row.label).toBe("A Saturday lunch at the door");
    expect(row.gated).toBe(false);
    expect(row.windowStart?.toISOString()).toBe(
      "2026-11-21T17:00:00.000Z",
    );
    expect(row.orientationNote).toBe(
      "Leave it at the door and text the coordinator.",
    );
    expect(await auditCount(t, "draft_slot_edited", home.id)).toBe(1);

    const [words] = await t.client<{ verbatim_text: string }[]>`
      SELECT verbatim_text FROM ask WHERE id = ${askId}
    `;
    expect(words.verbatim_text).toBe(
      "I haven't had a Saturday morning to myself since March.",
    );

    await expect(
      updateDraftSlot(RUTH, {
        slotId: home.id,
        kind: "meal",
        tier: "doorstep",
        label: "A stranger's edit",
        windowStart: null,
        windowEnd: null,
        gated: false,
        orientationNote: null,
      }, t.db),
    ).rejects.toBeInstanceOf(AuthError);

    const foreign = await updateDraftSlot(
      OTHER_COORDINATOR,
      {
        slotId: home.id,
        kind: "meal",
        tier: "doorstep",
        label: "Another church's edit",
        windowStart: null,
        windowEnd: null,
        gated: false,
        orientationNote: null,
      },
      t.db,
    );
    expect(foreign.ok).toBe(false);
  });

  it("refuses to turn a draft into a drive without the signed driver policy", async () => {
    const { askId } = await insertAskWithAnswers(t);
    await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    const companion = (await readSlots(t, askId)).find(
      (row) => row.kind === "companion",
    );
    if (!companion) throw new Error("expected a companion draft");

    const refused = await updateDraftSlot(
      GRACE,
      {
        slotId: companion.id,
        kind: "drive",
        tier: "transport",
        label: "A ride",
        windowStart: null,
        windowEnd: null,
        gated: true,
        orientationNote: null,
      },
      t.db,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toMatch(/driver policy/i);

    const [unchanged] = await t.db
      .select()
      .from(slot)
      .where(eq(slot.id, companion.id));
    expect(unchanged.kind).toBe("companion");
  });

  it("holds a draft with a reason and refuses publication until it is resolved", async () => {
    const { askId } = await insertAskWithAnswers(t);
    await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    const home = (await readSlots(t, askId)).find((row) => row.kind === "home");
    if (!home) throw new Error("expected a home draft");

    const empty = await holdDraftSlot(
      GRACE,
      { slotId: home.id, reason: "   " },
      t.db,
    );
    expect(empty.ok).toBe(false);

    const held = await holdDraftSlot(
      GRACE,
      {
        slotId: home.id,
        reason: "Waiting to confirm the family's Saturday.",
      },
      t.db,
    );
    expect(held.ok).toBe(true);

    const [heldRow] = await t.db
      .select()
      .from(slot)
      .where(eq(slot.id, home.id));
    expect(heldRow.holdReason).toBe(
      "Waiting to confirm the family's Saturday.",
    );
    expect(heldRow.heldBy).toBe(seedIds.people.grace);
    expect(heldRow.heldAt).not.toBeNull();

    const guard = canPublishDraft(heldRow);
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.reason).toBe("held");

    const context = await getDraftEditorContext(GRACE, askId, t.db);
    const contextHome = context?.slots.find((row) => row.id === home.id);
    expect(contextHome?.holdReason).toMatch(/confirm the family/i);

    // A held draft can still be edited while its ask waits.
    const edited = await updateDraftSlot(
      GRACE,
      {
        slotId: home.id,
        kind: "home",
        tier: "in_home",
        label: "Home visit — Saturday, to confirm",
        windowStart: heldRow.windowStart,
        windowEnd: heldRow.windowEnd,
        gated: true,
        orientationNote: heldRow.orientationNote,
      },
      t.db,
    );
    expect(edited.ok).toBe(true);

    const released = await releaseDraftSlot(GRACE, home.id, t.db);
    expect(released.ok).toBe(true);

    const [releasedRow] = await t.db
      .select()
      .from(slot)
      .where(eq(slot.id, home.id));
    expect(releasedRow.holdReason).toBeNull();
    expect(releasedRow.heldAt).toBeNull();
    expect(releasedRow.heldBy).toBeNull();
    expect(canPublishDraft(releasedRow).ok).toBe(true);

    expect(await auditCount(t, "draft_slot_held", home.id)).toBe(1);
    expect(await auditCount(t, "draft_slot_hold_resolved", home.id)).toBe(1);
  });

  it("removes a draft, clears its candidates, and refuses a published slot", async () => {
    const { askId } = await insertAskWithAnswers(t);
    await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    const companion = (await readSlots(t, askId)).find(
      (row) => row.kind === "companion",
    );
    if (!companion) throw new Error("expected a companion draft");

    // Construction records one explanation per active volunteer, so there is
    // already a candidate row to clear when the draft is removed.
    const before = await t.db
      .select()
      .from(slotCandidate)
      .where(eq(slotCandidate.slotId, companion.id));
    expect(before.length).toBeGreaterThan(0);

    const removed = await removeDraftSlot(GRACE, companion.id, t.db);
    expect(removed.ok).toBe(true);
    expect(
      await t.db.select().from(slot).where(eq(slot.id, companion.id)),
    ).toHaveLength(0);
    expect(
      await t.db
        .select()
        .from(slotCandidate)
        .where(eq(slotCandidate.slotId, companion.id)),
    ).toHaveLength(0);

    const audit = await t.db
      .select({ detail: auditEvent.detail })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.action, "draft_slot_removed"),
          eq(auditEvent.entityId, companion.id),
        ),
      );
    expect(audit[0]?.detail).toMatchObject({ kind: "companion" });

    const published = await t.db
      .insert(slot)
      .values({
        askId,
        churchId: seedIds.church,
        kind: "meal",
        tier: "doorstep",
        label: "A published meal",
        status: "open",
      })
      .returning({ id: slot.id });
    const refused = await removeDraftSlot(GRACE, published[0].id, t.db);
    expect(refused.ok).toBe(false);
    expect(
      await t.db
        .select()
        .from(slot)
        .where(eq(slot.id, published[0].id)),
    ).toHaveLength(1);
  });

  it("adds a coordinator draft with a manual rule reference", async () => {
    const { askId } = await insertAskWithAnswers(t);
    await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });

    const added = await addDraftSlot(
      GRACE,
      { askId, kind: "meal" },
      t.db,
      NOW,
    );
    expect(added.ok).toBe(true);

    const slots = await readSlots(t, askId);
    expect(slots).toHaveLength(3);
    const manual = slots.find((row) => row.ruleRef === "manual");
    expect(manual?.kind).toBe("meal");
    expect(manual?.label).toBe("Meal");
    expect(manual?.status).toBe("draft");
    expect(await auditCount(t, "draft_slot_added", manual?.id)).toBe(1);

    const drive = await addDraftSlot(
      GRACE,
      { askId, kind: "drive" },
      t.db,
      NOW,
    );
    expect(drive.ok).toBe(false);
    if (drive.ok) return;
    expect(drive.message).toMatch(/driver policy/i);

    await insertTransportPolicy(t);
    const signed = await insertAskWithAnswers(t, {
      answers: HERO_ANSWERS.map((entry) =>
        entry.questionId === "Q2" ? answer("Q2", true) : entry,
      ),
      policyVersionId: TRANSPORT_POLICY_ID,
    });
    const allowedDrive = await addDraftSlot(
      GRACE,
      { askId: signed.askId, kind: "drive" },
      t.db,
      NOW,
    );
    expect(allowedDrive.ok).toBe(true);
    const [driveRow] = await readSlots(t, signed.askId);
    expect(driveRow.gated).toBe(true);
    expect(driveRow.tier).toBe("transport");
    expect(driveRow.ruleRef).toBe("manual");
  });

  it("keeps drafts out of every congregation-shaped read and every other role's reach", async () => {
    const { askId } = await insertAskWithAnswers(t);
    await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    const slots = await readSlots(t, askId);

    const boardShaped = await t.db
      .select({
        id: slot.id,
        kind: slot.kind,
        label: slot.label,
        windowStart: slot.windowStart,
        windowEnd: slot.windowEnd,
        gated: slot.gated,
        sessionId: slot.sessionId,
      })
      .from(slot)
      .where(
        and(
          eq(slot.churchId, seedIds.church),
          inArray(slot.status, ["open", "claimed", "covered"]),
        ),
      );
    expect(boardShaped).toHaveLength(0);

    await expect(
      getDraftEditorContext(RUTH, askId, t.db),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      getDraftSlotActionContext(RUTH, slots[0].id, t.db),
    ).rejects.toBeInstanceOf(AuthError);

    expect(await getDraftEditorContext(OTHER_COORDINATOR, askId, t.db)).toBeNull();

    const foreignRemove = await removeDraftSlot(
      OTHER_COORDINATOR,
      slots[0].id,
      t.db,
    );
    expect(foreignRemove.ok).toBe(false);
    expect(await readSlots(t, askId)).toHaveLength(2);

    const foreignAdd = await addDraftSlot(
      OTHER_COORDINATOR,
      { askId, kind: "meal" },
      t.db,
      NOW,
    );
    expect(foreignAdd.ok).toBe(false);
  });
});

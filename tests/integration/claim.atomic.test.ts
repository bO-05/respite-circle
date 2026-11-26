import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema";
import {
  ask,
  askRevision,
  auditEvent,
  decision,
  notification,
  person,
  policy,
  slot,
  volunteer,
} from "../../src/db/schema";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase, type SeedDb } from "../../src/db/seed";
import {
  SEED_REFERENCE_DATE,
  seedIds,
  seedPolicy,
} from "../../src/db/seed-data";
import type { Actor } from "../../src/server/auth/policy";
import { claimHttpStatus } from "../../src/server/domain/claim";
import type { TypedAnswer } from "../../src/server/domain/slots";
import {
  readGatingRow,
  readViewerFacts,
  verdictFor,
} from "../../src/server/repositories/gating-facts";
import { claimGatePredicate } from "../../src/server/repositories/claim-gate";
import { claimSlot } from "../../src/server/repositories/claims";
import { approveAskForCoordinator } from "../../src/server/services/ask-review";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { constructDraftSlots } from "../../src/server/services/slot-construction";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-CLAIM-001 through VAL-CLAIM-004, at the database boundary.
 *
 * The claim is one conditional UPDATE whose WHERE clause carries the whole
 * gate: status `open`, nobody else's name on it, the approval instant, and the
 * volunteer's eligibility. Two clients race the same row and exactly one update
 * reports a row; the loser reads a human sentence and writes an audit row, never
 * a second claim. The SQL gate and the pure `canClaim` predicate are compared
 * case by case so the board's lock reason and the route's enforcement cannot
 * drift.
 */

const NOW = SEED_REFERENCE_DATE; // Tuesday 17 November 2026, 10:00 in New York
const TIME_ZONE = "America/New_York";
const ORIENTATION_CANARY =
  "ORIENTATION CANARY: the blue teapot is in the cupboard by the sink.";

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

const SARA: Actor = {
  personId: seedIds.people.sara,
  role: "volunteer",
  churchId: seedIds.church,
};

const TOM: Actor = {
  personId: seedIds.people.tom,
  role: "volunteer",
  churchId: seedIds.church,
};

const BEN: Actor = {
  personId: seedIds.people.ben,
  role: "volunteer",
  churchId: seedIds.church,
};

const TRANSPORT_POLICY_ID = "b0000000-0000-4000-8000-000000000002";
const OTHER_CHURCH = "c9999999-9999-4999-8999-999999999999";

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

function isPick(questionId: string): boolean {
  return questionId === "Q4" || questionId === "Q7";
}

/** Build one real waiting ask with nine typed answers. */
async function insertAskWithAnswers(
  t: TestDatabase,
  status: AskStatus = "waiting_coordinator",
): Promise<string> {
  const askId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();

  await t.db.insert(ask).values({
    id: askId,
    churchId: seedIds.church,
    caregiverId: seedIds.people.marta,
    careRecipientId: seedIds.careRecipients.elena,
    verbatimText: HERO_TEXT,
    status,
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
      abstained: false,
      samples: null,
      model: "fake-typed-v1",
      provider: "deterministic",
      latencyMs: 14,
      digest: sha256Hex(`${askId}:${entry.questionId}:${index}`),
    })),
  );

  return askId;
}

/** A real ask that has been constructed and published by Grace. */
async function publishedAsk(t: TestDatabase): Promise<{
  askId: string;
  companionId: string;
  homeId: string;
}> {
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
    .select({ id: slot.id, kind: slot.kind, status: slot.status })
    .from(slot)
    .where(eq(slot.askId, askId));

  const companion = rows.find((row) => row.kind === "companion");
  const home = rows.find((row) => row.kind === "home");
  if (!companion || !home) throw new Error("expected companion and home slots");
  expect(companion.status).toBe("open");
  expect(home.status).toBe("open");
  return { askId, companionId: companion.id, homeId: home.id };
}

type SlotKind = "companion" | "home" | "drive" | "meal" | "errand";

const TIER: Record<SlotKind, "public_event" | "in_home" | "transport" | "doorstep"> =
  {
    companion: "public_event",
    home: "in_home",
    drive: "transport",
    meal: "doorstep",
    errand: "doorstep",
  };

const DEFAULT_WINDOW: Record<SlotKind, [Date, Date]> = {
  companion: [
    new Date("2026-11-24T15:00:00.000Z"),
    new Date("2026-11-24T19:00:00.000Z"),
  ],
  home: [
    new Date("2026-11-28T15:00:00.000Z"),
    new Date("2026-11-28T17:00:00.000Z"),
  ],
  drive: [
    new Date("2026-11-29T15:00:00.000Z"),
    new Date("2026-11-29T17:00:00.000Z"),
  ],
  meal: [
    new Date("2026-11-28T18:00:00.000Z"),
    new Date("2026-11-28T19:00:00.000Z"),
  ],
  errand: [
    new Date("2026-11-30T15:00:00.000Z"),
    new Date("2026-11-30T16:00:00.000Z"),
  ],
};

/**
 * Insert one ask with one slot directly. The claim route's gate does not depend
 * on how a slot was published, so a direct fixture keeps the gating matrix fast
 * while the real construction-and-approval path is proved once above.
 */
async function insertSlotFixture(
  t: TestDatabase,
  input: {
    kind: SlotKind;
    policyId?: string;
    status?: "draft" | "open" | "claimed" | "covered" | "done";
    claimedBy?: string | null;
    windowStart?: Date | null;
    windowEnd?: Date | null;
    orientationNote?: string | null;
    churchId?: string;
    recipientId?: string;
    caregiverId?: string;
    approvedAt?: Date | null;
  },
): Promise<{ askId: string; slotId: string }> {
  const churchId = input.churchId ?? seedIds.church;
  const askId = crypto.randomUUID();
  const slotId = crypto.randomUUID();
  const [windowStart, windowEnd] = DEFAULT_WINDOW[input.kind];
  const status = input.status ?? "open";
  const published = status !== "draft";

  await t.db.insert(ask).values({
    id: askId,
    churchId,
    caregiverId: input.caregiverId ?? seedIds.people.marta,
    careRecipientId: input.recipientId ?? seedIds.careRecipients.elena,
    verbatimText: "A quiet fixture ask for the claim gate.",
    status: published ? "approved" : "waiting_coordinator",
    policyVersionId: input.policyId ?? seedIds.policyV1,
    approvedBy: published ? seedIds.people.grace : null,
    approvedAt: published ? NOW : null,
  });

  await t.db.insert(slot).values({
    id: slotId,
    askId,
    churchId,
    kind: input.kind,
    tier: TIER[input.kind],
    label: `${input.kind} fixture`,
    gated: input.kind === "home" || input.kind === "drive",
    windowStart: input.windowStart === undefined ? windowStart : input.windowStart,
    windowEnd: input.windowEnd === undefined ? windowEnd : input.windowEnd,
    orientationNote: input.orientationNote ?? null,
    status,
    claimedBy: input.claimedBy ?? null,
    claimedAt: input.claimedBy ? NOW : null,
    approvedBy: published ? seedIds.people.grace : null,
    approvedAt:
      input.approvedAt === undefined ? (published ? NOW : null) : input.approvedAt,
  });

  return { askId, slotId };
}

async function insertTransportPolicy(t: TestDatabase): Promise<void> {
  await t.db.insert(policy).values({
    id: TRANSPORT_POLICY_ID,
    churchId: seedIds.church,
    version: 2,
    safeguardingPromises: [...seedPolicy.safeguardingPromises],
    questionSet: seedPolicy.questionSet,
    crisisScript: seedPolicy.crisisScript,
    localCrisisLine: seedPolicy.localCrisisLine,
    referralResources: seedPolicy.referralResources,
    familiarFaceDefault: true,
    reminderWindowHours: 24,
    callThresholdHours: 48,
    transportEnabled: true,
    autoPublishLowRisk: false,
    signedOffBy: "Grace Whitfield",
    signedOffAt: NOW,
  });
}

async function slotState(t: TestDatabase, slotId: string) {
  const rows = await t.db.select().from(slot).where(eq(slot.id, slotId)).limit(1);
  return rows[0];
}

async function resetToOpen(t: TestDatabase, slotId: string): Promise<void> {
  await t.db
    .update(slot)
    .set({ status: "open", claimedBy: null, claimedAt: null })
    .where(eq(slot.id, slotId));
}

async function auditRows(
  t: TestDatabase,
  action: string,
): Promise<Array<{ actorId: string | null; entityId: string | null; detail: unknown }>> {
  return t.db
    .select({
      actorId: auditEvent.actorId,
      entityId: auditEvent.entityId,
      detail: auditEvent.detail,
    })
    .from(auditEvent)
    .where(eq(auditEvent.action, action));
}

/** The pure verdict, derived from the same reads the board uses. */
async function tsVerdict(t: TestDatabase, actor: Actor, slotId: string) {
  const viewer = await readViewerFacts(t.db, actor);
  const row = await readGatingRow(t.db, seedIds.church, slotId);
  if (!row) throw new Error("the gating row is missing");
  return verdictFor(viewer, row, TIME_ZONE, NOW);
}

/** The gate exactly as the claim statement evaluates it. */
async function sqlGate(
  t: TestDatabase,
  actor: Actor,
  slotId: string,
): Promise<boolean> {
  const rows = await t.db
    .select({
      passes: sql<boolean>`(${claimGatePredicate({
        personId: actor.personId,
        churchId: seedIds.church,
        now: NOW,
      })})`,
    })
    .from(slot)
    .where(eq(slot.id, slotId));

  return rows[0]?.passes === true;
}

describe("the atomic claim and its gate", () => {
  let t: TestDatabase;
  let second: { client: ReturnType<typeof postgres>; db: SeedDb };

  beforeAll(async () => {
    t = await openTestDatabase();
    const client = postgres(t.url, {
      max: 2,
      prepare: false,
      ssl: "require",
      onnotice: () => undefined,
    });
    second = {
      client,
      db: drizzle(client, { schema }) as SeedDb,
    };
  });

  afterAll(async () => {
    await second.client.end();
    await t.client.end();
  });

  beforeEach(async () => {
    await truncateAll(t.db);
    await seedDatabase(t.db, { now: NOW });
  });

  it("claims a real published slot once and records the winner in the audit trail", async () => {
    const { companionId } = await publishedAsk(t);

    const result = await claimSlot(RUTH, companionId, t.db, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe("claimed");

    const row = await slotState(t, companionId);
    expect(row.status).toBe("claimed");
    expect(row.claimedBy).toBe(seedIds.people.ruth);
    expect(row.claimedAt).not.toBeNull();

    const wins = await auditRows(t, "slot_claimed");
    expect(wins).toHaveLength(1);
    expect(wins[0].actorId).toBe(seedIds.people.ruth);
    expect(wins[0].entityId).toBe(companionId);
    expect(wins[0].detail).toMatchObject({ previousStatus: "open" });

    // No caregiver-facing message is created by a claim: only the coordinator's
    // approval of a covered slot may write one.
    const notifications = await t.db
      .select({ id: notification.id })
      .from(notification)
      .where(eq(notification.slotId, companionId));
    expect(notifications).toHaveLength(0);
  });

  it("gives exactly one of two concurrent volunteers the place and a human 409 to the other", async () => {
    const { homeId } = await publishedAsk(t);
    expect(await sqlGate(t, RUTH, homeId)).toBe(true);
    expect(await sqlGate(t, SARA, homeId)).toBe(true);

    const [first, secondResult] = await Promise.all([
      claimSlot(RUTH, homeId, t.db, NOW),
      claimSlot(SARA, homeId, second.db, NOW),
    ]);

    const results = [first, secondResult];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const loser = results.find((result) => !result.ok);
    if (!loser) throw new Error("expected a loser");
    expect(loser.code).toBe("taken");
    expect(loser.message).toBe(
      "Someone else just took this time — thank you for saying yes.",
    );

    const row = await slotState(t, homeId);
    expect(row.status).toBe("claimed");
    expect([seedIds.people.ruth, seedIds.people.sara]).toContain(row.claimedBy);
    expect(row.claimedAt).not.toBeNull();

    const wins = await auditRows(t, "slot_claimed");
    const refusals = await auditRows(t, "claim_refused");
    expect(wins).toHaveLength(1);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].detail).toMatchObject({ reason: "taken" });
  });

  it("gives one volunteer exactly one win when the same claim is submitted twice at once", async () => {
    const { homeId } = await publishedAsk(t);

    const results = await Promise.all([
      claimSlot(RUTH, homeId, t.db, NOW),
      claimSlot(RUTH, homeId, second.db, NOW),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const loser = results.find((result) => !result.ok);
    if (!loser) throw new Error("expected a loser");
    expect(loser.code).toBe("already_yours");
    expect(loser.message).toContain("You already said yes");

    const row = await slotState(t, homeId);
    expect(row.claimedBy).toBe(seedIds.people.ruth);
    expect(row.status).toBe("claimed");
  });

  it("refuses a forged claim by an ineligible volunteer and changes nothing", async () => {
    const { homeId } = await publishedAsk(t);

    const before = await slotState(t, homeId);
    const result = await claimSlot(TOM, homeId, t.db, NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("locked");
    expect(result.ruleCode).toBe("no_checklist");
    expect(result.message).toMatch(/safeguarding checklist/i);
    expect(claimHttpStatus(result.code)).toBe(403);

    const after = await slotState(t, homeId);
    expect(after.status).toBe("open");
    expect(after.claimedBy).toBeNull();
    expect(after.claimedAt).toBeNull();
    expect(after).toEqual(before);

    const refusals = await auditRows(t, "claim_refused");
    expect(refusals).toHaveLength(1);
    expect(refusals[0].actorId).toBe(seedIds.people.tom);
    expect(refusals[0].entityId).toBe(homeId);
    expect(refusals[0].detail).toMatchObject({
      reason: "locked",
      ruleCode: "no_checklist",
    });
  });

  it("allows the checklist path and blocks each way the checklist can lapse", async () => {
    const { homeId } = await publishedAsk(t);

    // Ben is not a familiar face for Elena, but his checklist is current with
    // two references, current training, and a current background check.
    const allowed = await claimSlot(BEN, homeId, t.db, NOW);
    expect(allowed.ok).toBe(true);

    await resetToOpen(t, homeId);
    await t.db
      .update(volunteer)
      .set({ checklistCompletedAt: new Date("2025-01-01T15:00:00.000Z") })
      .where(eq(volunteer.personId, seedIds.people.ben));
    const expired = await claimSlot(BEN, homeId, t.db, NOW);
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.code).toBe("locked");
      expect(expired.ruleCode).toBe("checklist_expired");
    }

    await resetToOpen(t, homeId);
    await t.db
      .update(volunteer)
      .set({
        checklistCompletedAt: new Date("2026-09-15T14:00:00.000Z"),
        referencesContacted: 1,
      })
      .where(eq(volunteer.personId, seedIds.people.ben));
    const oneReference = await claimSlot(BEN, homeId, t.db, NOW);
    expect(oneReference.ok).toBe(false);
    if (!oneReference.ok) expect(oneReference.ruleCode).toBe("no_checklist");

    await t.db
      .update(volunteer)
      .set({ referencesContacted: 2, trainingExpiresOn: null })
      .where(eq(volunteer.personId, seedIds.people.ben));
    const noTraining = await claimSlot(BEN, homeId, t.db, NOW);
    expect(noTraining.ok).toBe(false);
    if (!noTraining.ok) expect(noTraining.ruleCode).toBe("no_checklist");

    await t.db
      .update(volunteer)
      .set({
        trainingExpiresOn: "2026-01-01",
        backgroundRenewsOn: "2027-08-01",
      })
      .where(eq(volunteer.personId, seedIds.people.ben));
    const lapsedTraining = await claimSlot(BEN, homeId, t.db, NOW);
    expect(lapsedTraining.ok).toBe(false);
    if (!lapsedTraining.ok) {
      expect(lapsedTraining.ruleCode).toBe("checklist_expired");
    }

    await t.db
      .update(volunteer)
      .set({
        trainingExpiresOn: "2027-06-30",
        backgroundRenewsOn: "2026-01-01",
      })
      .where(eq(volunteer.personId, seedIds.people.ben));
    const lapsedBackground = await claimSlot(BEN, homeId, t.db, NOW);
    expect(lapsedBackground.ok).toBe(false);
    if (!lapsedBackground.ok) {
      expect(lapsedBackground.ruleCode).toBe("checklist_expired");
    }

    // Every refusal left the row exactly as it was.
    const row = await slotState(t, homeId);
    expect(row.status).toBe("open");
    expect(row.claimedBy).toBeNull();
  });

  it("lets an active familiar-face attestation stand in for a lapsed checklist", async () => {
    const { homeId } = await publishedAsk(t);

    await t.db
      .update(volunteer)
      .set({
        checklistCompletedAt: new Date("2024-01-01T15:00:00.000Z"),
        trainingExpiresOn: "2025-01-01",
        backgroundRenewsOn: "2025-01-01",
        referencesContacted: 0,
      })
      .where(eq(volunteer.personId, seedIds.people.ruth));

    const result = await claimSlot(RUTH, homeId, t.db, NOW);
    expect(result.ok).toBe(true);
    const row = await slotState(t, homeId);
    expect(row.claimedBy).toBe(seedIds.people.ruth);
  });

  it("refuses a drive while transport is disabled and applies the driver record once signed", async () => {
    const { slotId: driveOffId } = await insertSlotFixture(t, {
      kind: "drive",
    });

    const off = await claimSlot(RUTH, driveOffId, t.db, NOW);
    expect(off.ok).toBe(false);
    if (!off.ok) {
      expect(off.code).toBe("locked");
      expect(off.ruleCode).toBe("no_driver_policy");
      expect(off.message).toMatch(/driver policy/i);
    }
    expect((await slotState(t, driveOffId)).status).toBe("open");

    await insertTransportPolicy(t);

    const { slotId: driveOnId } = await insertSlotFixture(t, {
      kind: "drive",
      policyId: TRANSPORT_POLICY_ID,
    });
    const { slotId: driveSecondId } = await insertSlotFixture(t, {
      kind: "drive",
      policyId: TRANSPORT_POLICY_ID,
      windowStart: new Date("2026-11-29T18:00:00.000Z"),
      windowEnd: new Date("2026-11-29T19:00:00.000Z"),
    });

    // Sara has no driver record; Ruth does.
    const saraRefused = await claimSlot(SARA, driveSecondId, t.db, NOW);
    expect(saraRefused.ok).toBe(false);
    if (!saraRefused.ok) expect(saraRefused.ruleCode).toBe("driver_not_ok");

    const ruthAllowed = await claimSlot(RUTH, driveOnId, t.db, NOW);
    expect(ruthAllowed.ok).toBe(true);
  });

  it("treats a draft slot as missing and writes an audited refusal", async () => {
    const { slotId: draftId } = await insertSlotFixture(t, {
      kind: "companion",
      status: "draft",
    });

    const result = await claimSlot(RUTH, draftId, t.db, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_found");
      expect(claimHttpStatus(result.code)).toBe(404);
    }

    const row = await slotState(t, draftId);
    expect(row.status).toBe("draft");
    expect(row.claimedBy).toBeNull();

    const refusals = await auditRows(t, "claim_refused");
    expect(refusals).toHaveLength(1);
    expect(refusals[0].detail).toMatchObject({ reason: "not_found" });
  });

  it("treats another church's slot as missing", async () => {
    await t.db.insert(schema.church).values({
      id: OTHER_CHURCH,
      name: "Other Chapel",
      timezone: "America/New_York",
    });
    await t.db.insert(schema.careRecipient).values({
      id: "f9999999-9999-4999-8999-999999999999",
      churchId: OTHER_CHURCH,
      firstName: "June",
      relation: "wife",
      createdByCaregiverId: seedIds.people.marta,
    });

    // A slot whose church id is the foreign church, but referenced by an ask in
    // that church. The guard is the church filter on the statement.
    const { slotId } = await insertSlotFixture(t, {
      kind: "companion",
      churchId: OTHER_CHURCH,
      recipientId: "f9999999-9999-4999-8999-999999999999",
    });

    const result = await claimSlot(RUTH, slotId, t.db, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");

    const row = await slotState(t, slotId);
    expect(row.status).toBe("open");
    expect(row.claimedBy).toBeNull();
  });

  it("refuses the desk role without writing and audits the attempt", async () => {
    const { companionId } = await publishedAsk(t);

    const result = await claimSlot(GRACE, companionId, t.db, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_volunteer");
      expect(claimHttpStatus(result.code)).toBe(403);
    }

    const row = await slotState(t, companionId);
    expect(row.status).toBe("open");
    expect(row.claimedBy).toBeNull();

    const refusals = await auditRows(t, "claim_refused");
    expect(refusals.some((row) => row.actorId === seedIds.people.grace)).toBe(
      true,
    );
  });

  it("agrees with canClaim for every volunteer, kind, policy, and commitment", async () => {
    const { slotId: companionId } = await insertSlotFixture(t, {
      kind: "companion",
    });
    const { slotId: homeId } = await insertSlotFixture(t, { kind: "home" });
    const { slotId: driveOffId } = await insertSlotFixture(t, { kind: "drive" });
    await insertTransportPolicy(t);
    const { slotId: driveOnId } = await insertSlotFixture(t, {
      kind: "drive",
      policyId: TRANSPORT_POLICY_ID,
      windowStart: new Date("2026-11-29T18:00:00.000Z"),
      windowEnd: new Date("2026-11-29T19:00:00.000Z"),
    });

    // A volunteer-role person with no volunteer file: the board calls that
    // no_checklist, and the statement must refuse it too.
    const strangerId = "a8888888-8888-4888-8888-888888888888";
    await t.db.insert(person).values({
      id: strangerId,
      churchId: seedIds.church,
      firstName: "Ada",
      lastName: "Stranger",
      roles: ["volunteer"],
      accessToken: "claim-stranger-8a8a",
    });
    const STRANGER: Actor = {
      personId: strangerId,
      role: "volunteer",
      churchId: seedIds.church,
    };

    const volunteers = [RUTH, SARA, TOM, BEN, STRANGER];
    const slots = [
      { id: companionId, label: "companion" },
      { id: homeId, label: "home" },
      { id: driveOffId, label: "drive-off" },
      { id: driveOnId, label: "drive-on" },
    ];

    for (const actor of volunteers) {
      for (const candidate of slots) {
        const [expected, actual] = await Promise.all([
          tsVerdict(t, actor, candidate.id),
          sqlGate(t, actor, candidate.id),
        ]);
        expect(
          actual,
          `${actor.personId} on ${candidate.label} should match canClaim`,
        ).toBe(expected.eligible);
      }
    }

    // An overlapping commitment and the daily ceiling are part of the same
    // gate; both must fail in SQL exactly when canClaim says they do.
    await insertSlotFixture(t, {
      kind: "home",
      status: "claimed",
      claimedBy: seedIds.people.ruth,
      windowStart: new Date("2026-11-28T15:30:00.000Z"),
      windowEnd: new Date("2026-11-28T16:30:00.000Z"),
    });
    const overlapExpected = await tsVerdict(t, RUTH, homeId);
    const overlapActual = await sqlGate(t, RUTH, homeId);
    expect(overlapExpected.eligible).toBe(false);
    if (!overlapExpected.eligible) {
      expect(overlapExpected.ruleCode).toBe("unavailable_window");
    }
    expect(overlapActual).toBe(false);

    // Clear the overlap and add two same-day places instead: the daily ceiling
    // is the next rule, and it must also match.
    await t.db
      .update(slot)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(slot.claimedBy, seedIds.people.ruth),
          eq(slot.status, "claimed"),
        ),
      );
    await insertSlotFixture(t, {
      kind: "meal",
      status: "claimed",
      claimedBy: seedIds.people.ruth,
      windowStart: new Date("2026-11-28T10:00:00.000Z"),
      windowEnd: new Date("2026-11-28T11:00:00.000Z"),
    });
    await insertSlotFixture(t, {
      kind: "meal",
      status: "claimed",
      claimedBy: seedIds.people.ruth,
      windowStart: new Date("2026-11-28T12:00:00.000Z"),
      windowEnd: new Date("2026-11-28T13:00:00.000Z"),
    });
    const dailyExpected = await tsVerdict(t, RUTH, homeId);
    const dailyActual = await sqlGate(t, RUTH, homeId);
    expect(dailyExpected.eligible).toBe(false);
    if (!dailyExpected.eligible) {
      expect(dailyExpected.ruleCode).toBe("already_serving_twice");
    }
    expect(dailyActual).toBe(false);
  });

  it("keeps SQL and internal ids out of the outcome and never leaks the note", async () => {
    const { slotId: companionId } = await insertSlotFixture(t, {
      kind: "companion",
      orientationNote: ORIENTATION_CANARY,
    });

    const result = await claimSlot(RUTH, companionId, t.db, NOW);
    expect(result.ok).toBe(true);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(ORIENTATION_CANARY);
    expect(serialized).not.toMatch(
      /SELECT|UPDATE|INSERT|SQLSTATE|postgres|pg_|constraint/i,
    );
    expect(serialized).not.toContain(seedIds.people.grace);
    expect(serialized).not.toContain(seedIds.careRecipients.elena);
    if (!result.ok) throw new Error("expected a win");

    // Only the slot id, the closed code, and the human sentence are exposed.
    expect(Object.keys(result).sort()).toEqual(
      ["code", "message", "ok", "slotId", "status"].sort(),
    );
    expect(result.slotId).toBe(companionId);
  });
});

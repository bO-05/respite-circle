import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import {
  SEED_REFERENCE_DATE,
  seedCrisisScript,
  seedIds,
  seedLocalCrisisLine,
  seedPolicy,
  seedQuestionSet,
  seedReferralResources,
  seedSafeguardingPromises,
} from "../../src/db/seed-data";
import {
  ask,
  askRevision,
  auditEvent,
  decision,
  policy,
  slot,
} from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import type { TypedAnswer } from "../../src/server/domain/slots";
import { autoPublishDecision } from "../../src/server/domain/auto-publish";
import { getBoard } from "../../src/server/repositories/board";
import { getAskPublication } from "../../src/server/repositories/ask-review";
import { claimSlot } from "../../src/server/repositories/claims";
import {
  getPolicyInForce,
  POLICY_AUDIT_ACTIONS,
  savePolicyVersion,
  type PolicySaveInput,
} from "../../src/server/repositories/policy";
import {
  sendBackAskForCoordinator,
} from "../../src/server/services/ask-review";
import { constructDraftSlots } from "../../src/server/services/slot-construction";
import { sha256Hex } from "../../src/server/services/decision-contract";
import {
  expectRejection,
  openTestDatabase,
  type TestDatabase,
} from "./helpers/db";

/**
 * VAL-POLICY-006 and VAL-ACCESS-006 against the isolated database.
 *
 * The low-risk switch is off in the seeded policy, so every draft waits for a
 * coordinator. A deputy turns it on and signs a new version; the change is
 * audited with the deputy's identity and the new version. A meal built from a
 * later ask then publishes itself, is visibly labelled, is audited with the
 * policy version it followed, and writes no notification. A companion place, a
 * home visit, and a drive are refused with a reason, and the database itself
 * refuses an auto-published row that is not a meal — including an errand, which
 * no path can build and which the copy says is not available yet.
 *
 * A send-back withdraws an open auto-published time and is refused while a
 * neighbour already holds one, so a low-risk time can never outlive its ask.
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

const RUTH: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: seedIds.church,
};

const MARTA: Actor = {
  personId: seedIds.people.marta,
  role: "caregiver",
  churchId: seedIds.church,
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

const SITTING_ANSWERS: TypedAnswer[] = [
  answer("Q1", true),
  answer("Q2", false),
  answer("Q3", false),
  answer("Q4", "weekday_morning"),
  answer("Q5", false),
  answer("Q6", true),
  answer("Q7", "unknown"),
  answer("Q8", false),
  answer("Q9", false),
];

const MEAL_ANSWERS: TypedAnswer[] = [
  answer("Q1", false),
  answer("Q2", false),
  answer("Q3", true),
  answer("Q4", "weekday_evening"),
  answer("Q5", false),
  answer("Q6", false),
  answer("Q7", "reheats"),
  answer("Q8", false),
  answer("Q9", false),
];

function isPick(questionId: string): boolean {
  return questionId === "Q4" || questionId === "Q7";
}

function policyInput(
  overrides: Partial<PolicySaveInput> = {},
): PolicySaveInput {
  return {
    safeguardingPromises: [...seedSafeguardingPromises],
    questionSet: seedQuestionSet.map((question) => ({ ...question })),
    crisisScript: seedCrisisScript,
    localCrisisLine: seedLocalCrisisLine,
    referralResources: seedReferralResources.map((resource) => ({
      ...resource,
    })),
    familiarFaceDefault: true,
    reminderWindowHours: seedPolicy.reminderWindowHours,
    callThresholdHours: seedPolicy.callThresholdHours,
    callAfterOpenHours: seedPolicy.callAfterOpenHours,
    transportEnabled: false,
    autoPublishLowRisk: false,
    signedOffBy: "Grace Whitfield",
    authorName: "Grace Whitfield",
    ...overrides,
  };
}

async function insertAskWithAnswers(
  t: TestDatabase,
  options: {
    status?: AskStatus;
    answers?: TypedAnswer[];
    policyVersionId?: string;
    text?: string;
  } = {},
): Promise<string> {
  const askId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const answers = options.answers ?? SITTING_ANSWERS;
  const policyVersionId = options.policyVersionId ?? seedIds.policyV1;
  const text =
    options.text ??
    "I have not had a morning to myself since March. Mum is fine with people she knows, and she cannot be alone.";

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

  return askId;
}

async function buildDrafts(
  t: TestDatabase,
  askId: string,
  churchId: string = seedIds.church,
) {
  return constructDraftSlots({
    askId,
    churchId,
    database: t.db,
    now: NOW,
  });
}

async function slotRows(t: TestDatabase, askId: string) {
  return t.db
    .select()
    .from(slot)
    .where(eq(slot.askId, askId))
    .orderBy(asc(slot.kind));
}

async function auditRows(t: TestDatabase, action: string) {
  return t.db
    .select()
    .from(auditEvent)
    .where(eq(auditEvent.action, action))
    .orderBy(asc(auditEvent.createdAt), asc(auditEvent.id));
}

async function notificationCount(t: TestDatabase, askId: string): Promise<number> {
  const rows = await t.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
      FROM notification AS n
      JOIN slot AS s ON s.id = n.slot_id
     WHERE s.ask_id = ${askId}
  `;
  return rows[0]?.count ?? 0;
}

async function turnAutoPublishOn(
  t: TestDatabase,
  actor: Actor = DANIEL,
): Promise<{ version: number; policyId: string }> {
  const result = await savePolicyVersion(
    actor,
    policyInput({
      autoPublishLowRisk: true,
      signedOffBy: "Eli Low",
      authorName: "Eli Low",
    }),
    t.db,
  );
  if (!result.ok) throw new Error(result.message);
  return { version: result.policy.version, policyId: result.policy.id };
}

describe("the deputy and the low-risk auto-publish setting", () => {
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

  it("is off by default, so a meal draft waits for a person", async () => {
    expect(seedPolicy.autoPublishLowRisk).toBe(false);
    const inForce = await getPolicyInForce(seedIds.church, t.db);
    expect(inForce?.autoPublishLowRisk).toBe(false);

    const askId = await insertAskWithAnswers(t, { answers: MEAL_ANSWERS });
    const built = await buildDrafts(t, askId);
    expect(built.created).toBe(true);
    expect(built.autoPublished).toEqual([]);

    const rows = await slotRows(t, askId);
    expect(rows.map((row) => row.kind)).toEqual(["meal"]);
    expect(rows[0].status).toBe("draft");
    expect(rows[0].publishedVia).toBe("coordinator");
    expect(rows[0].approvedAt).toBeNull();

    expect(await auditRows(t, "slot_auto_published")).toHaveLength(0);
    expect((await getBoard(RUTH, t.db, NOW))?.slots).toHaveLength(0);
  });

  it("records the deputy and the new version when the switch is turned on", async () => {
    const { version, policyId } = await turnAutoPublishOn(t);

    const [row] = await t.db
      .select({ autoPublishLowRisk: policy.autoPublishLowRisk })
      .from(policy)
      .where(eq(policy.id, policyId));
    expect(row?.autoPublishLowRisk).toBe(true);

    const changes = await auditRows(
      t,
      POLICY_AUDIT_ACTIONS.autoPublishChanged,
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].actorType).toBe("human");
    expect(changes[0].actorId).toBe(seedIds.people.daniel);
    expect(changes[0].entity).toBe("policy");
    expect(changes[0].entityId).toBe(policyId);
    expect(changes[0].detail).toMatchObject({
      version,
      policyVersionId: policyId,
      from: false,
      to: true,
      signedOffBy: "Eli Low",
    });

    // Saving an unchanged switch again is not a change and writes no second
    // event; the version itself is still saved and audited.
    const again = await savePolicyVersion(
      DANIEL,
      policyInput({
        autoPublishLowRisk: true,
        signedOffBy: "Eli Low",
        authorName: "Eli Low",
      }),
      t.db,
    );
    expect(again.ok).toBe(true);
    expect(
      await auditRows(t, POLICY_AUDIT_ACTIONS.autoPublishChanged),
    ).toHaveLength(1);
  });

  it("auto-publishes a meal under the signed policy, labels it, audits it, and sends nothing", async () => {
    const { version, policyId } = await turnAutoPublishOn(t);
    const askId = await insertAskWithAnswers(t, {
      answers: MEAL_ANSWERS,
      policyVersionId: policyId,
    });

    const built = await buildDrafts(t, askId);
    expect(built.autoPublished).toHaveLength(1);
    expect(built.autoPublishRefused).toEqual([]);

    const [meal] = await slotRows(t, askId);
    expect(meal.kind).toBe("meal");
    expect(meal.status).toBe("open");
    expect(meal.publishedVia).toBe("auto_low_risk");
    expect(meal.approvedAt?.toISOString()).toBe(NOW.toISOString());
    expect(meal.approvedBy).toBeNull();

    const published = await auditRows(t, "slot_auto_published");
    expect(published).toHaveLength(1);
    expect(published[0].actorType).toBe("system");
    expect(published[0].actorId).toBeNull();
    expect(published[0].entity).toBe("slot");
    expect(published[0].entityId).toBe(meal.id);
    expect(published[0].detail).toMatchObject({
      askId,
      kinds: ["meal"],
      version,
      policyVersionId: policyId,
    });

    // The board shows the time and labels how it got there.
    const board = await getBoard(RUTH, t.db, NOW);
    const onBoard = board?.slots.find((entry) => entry.id === meal.id);
    expect(onBoard?.status).toBe("open");
    expect(onBoard?.publishedVia).toBe("auto_low_risk");
    expect(onBoard?.approvedByName).toBeNull();

    // The desk read carries the same fact without widening the projection.
    const publication = await getAskPublication(GRACE, askId, t.db);
    expect(
      publication?.published.find((entry) => entry.id === meal.id)?.publishedVia,
    ).toBe("auto_low_risk");

    // Nothing is sent: the outbox is empty for this ask.
    expect(await notificationCount(t, askId)).toBe(0);
  });

  it("refuses a companion place and a home visit with a reason, and publishes neither", async () => {
    const { version, policyId } = await turnAutoPublishOn(t);
    const askId = await insertAskWithAnswers(t, {
      answers: SITTING_ANSWERS,
      policyVersionId: policyId,
    });

    const built = await buildDrafts(t, askId);
    expect(built.autoPublished).toEqual([]);
    expect([...built.autoPublishRefused].sort()).toEqual([
      "companion",
      "home",
    ]);

    const rows = await slotRows(t, askId);
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.status).toBe("draft");
      expect(row.publishedVia).toBe("coordinator");
      expect(row.approvedAt).toBeNull();
    }

    const refused = await auditRows(t, "slot_auto_publish_refused");
    expect(refused).toHaveLength(1);
    expect(refused[0].actorType).toBe("system");
    expect(refused[0].entity).toBe("ask");
    expect(refused[0].entityId).toBe(askId);
    expect(refused[0].detail).toMatchObject({
      reason: "kind_not_low_risk",
      version,
      policyVersionId: policyId,
    });
    expect(
      [...(refused[0].detail.kinds as string[])].sort(),
    ).toEqual(["companion", "home"]);

    expect((await getBoard(RUTH, t.db, NOW))?.slots).toHaveLength(0);
    expect(await auditRows(t, "slot_auto_published")).toHaveLength(0);
    expect(await notificationCount(t, askId)).toBe(0);
  });

  it("never auto-publishes under an unsigned policy version that carries the flag", async () => {
    const unsigned = await t.db
      .insert(policy)
      .values({
        churchId: seedIds.church,
        version: 2,
        safeguardingPromises: [...seedSafeguardingPromises],
        questionSet: seedQuestionSet.map((question) => ({ ...question })),
        crisisScript: seedCrisisScript,
        localCrisisLine: seedLocalCrisisLine,
        referralResources: seedReferralResources.map((resource) => ({
          ...resource,
        })),
        autoPublishLowRisk: true,
        signedOffBy: null,
        signedOffAt: null,
      })
      .returning({ id: policy.id });

    const decision = autoPublishDecision(
      {
        version: 2,
        autoPublishLowRisk: true,
        signedOffBy: null,
        signedOffAt: null,
      },
      "meal",
    );
    expect(decision.publish).toBe(false);

    const askId = await insertAskWithAnswers(t, {
      answers: MEAL_ANSWERS,
      policyVersionId: unsigned[0].id,
    });
    const built = await buildDrafts(t, askId);
    expect(built.autoPublished).toEqual([]);

    const [meal] = await slotRows(t, askId);
    expect(meal.status).toBe("draft");
    expect(await auditRows(t, "slot_auto_published")).toHaveLength(0);
  });

  it("the database itself refuses an auto-published row that is not a meal", async () => {
    const askId = await insertAskWithAnswers(t, { answers: SITTING_ANSWERS });

    await expectRejection(
      () =>
        t.db.insert(slot).values({
          askId,
          churchId: seedIds.church,
          kind: "companion",
          tier: "public_event",
          label: "A companion place with no person behind it",
          gated: false,
          status: "open",
          approvedAt: NOW,
          approvedBy: null,
          publishedVia: "auto_low_risk",
        }),
      /slot_auto_publish_low_risk_only|check constraint/i,
    );

    // An errand is a reserved enum value with no producer, and the switch
    // refuses it even as a raw insert. Rule, database check, and copy agree.
    await expectRejection(
      () =>
        t.db.insert(slot).values({
          askId,
          churchId: seedIds.church,
          kind: "errand",
          tier: "doorstep",
          label: "An errand the app cannot produce",
          gated: false,
          status: "open",
          approvedAt: NOW,
          approvedBy: null,
          publishedVia: "auto_low_risk",
        }),
      /slot_auto_publish_low_risk_only|check constraint/i,
    );

    // The same row is fine for a meal: that is the one kind the switch covers.
    const [meal] = await t.db
      .insert(slot)
      .values({
        askId,
        churchId: seedIds.church,
        kind: "meal",
        tier: "doorstep",
        label: "A meal the church publishes automatically",
        gated: false,
        status: "open",
        approvedAt: NOW,
        approvedBy: null,
        publishedVia: "auto_low_risk",
      })
      .returning({ id: slot.id });
    expect(meal.id).toBeTruthy();
  });

  it("withdraws an open auto-published time on send-back and refuses while one is claimed", async () => {
    const { policyId } = await turnAutoPublishOn(t);
    const askId = await insertAskWithAnswers(t, {
      answers: MEAL_ANSWERS,
      policyVersionId: policyId,
    });
    const built = await buildDrafts(t, askId);
    expect(built.autoPublished).toHaveLength(1);

    const [meal] = await slotRows(t, askId);
    const claimed = await claimSlot(RUTH, meal.id, t.db, NOW);
    expect(claimed.ok).toBe(true);

    const refused = await sendBackAskForCoordinator(
      GRACE,
      { askId, note: "Please call us before anything else is offered." },
      t.db,
      NOW,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("auto_published_claimed");
    expect(refused.message).toMatch(/already said yes|claim/i);

    const [stillClaimed] = await slotRows(t, askId);
    expect(stillClaimed.status).toBe("claimed");

    // A different ask, unclaimed: the send-back withdraws the time and says so
    // in the audit log. The board goes quiet.
    const otherAsk = await insertAskWithAnswers(t, {
      answers: MEAL_ANSWERS,
      policyVersionId: policyId,
    });
    await buildDrafts(t, otherAsk);
    const [otherMeal] = await slotRows(t, otherAsk);

    const sentBack = await sendBackAskForCoordinator(
      GRACE,
      { askId: otherAsk, note: "We will try a different week." },
      t.db,
      NOW,
    );
    expect(sentBack.ok).toBe(true);
    if (!sentBack.ok) return;

    // The desk is told what happened without the old false claim: a time was
    // published, and this send-back took it down.
    expect(sentBack.withdrawnCount).toBe(1);
    expect(sentBack.message).toMatch(/nothing new was published/i);
    expect(sentBack.message).not.toMatch(/nothing was published/i);

    const [withdrawn] = await slotRows(t, otherAsk);
    expect(withdrawn.status).toBe("cancelled");

    const withdrawAudit = await auditRows(
      t,
      "slot_auto_publish_withdrawn",
    );
    expect(withdrawAudit).toHaveLength(1);
    expect(withdrawAudit[0].actorType).toBe("human");
    expect(withdrawAudit[0].actorId).toBe(seedIds.people.grace);
    expect(withdrawAudit[0].entityId).toBe(otherMeal.id);
    expect(withdrawAudit[0].detail).toMatchObject({
      askId: otherAsk,
      kinds: ["meal"],
      reason: "ask_sent_back",
    });

    const board = await getBoard(RUTH, t.db, NOW);
    expect(
      board?.slots.some((entry) => entry.id === otherMeal.id),
    ).toBe(false);
  });

  it("keeps the deputy's desk parity: a deputy may save the policy and approve, and is named", async () => {
    const { policyId, version } = await turnAutoPublishOn(t, DANIEL);
    expect(policyId).toBeTruthy();
    expect(version).toBe(2);

    const saveAudit = await auditRows(t, POLICY_AUDIT_ACTIONS.saved);
    expect(saveAudit.at(-1)?.actorId).toBe(seedIds.people.daniel);

    // The same deputy can read the coordinator's copy of the policy.
    const { getPolicyForCoordinator } = await import(
      "../../src/server/repositories/policy"
    );
    const view = await getPolicyForCoordinator(DANIEL, t.db);
    expect(view?.version).toBe(2);

    // A caregiver is still refused.
    await expect(getPolicyForCoordinator(MARTA, t.db)).rejects.toBeInstanceOf(
      AuthError,
    );

    // The deputy can approve a waiting ask; the audit names the deputy.
    const askId = await insertAskWithAnswers(t, { answers: SITTING_ANSWERS });
    await buildDrafts(t, askId);
    const { approveAskForCoordinator } = await import(
      "../../src/server/services/ask-review"
    );
    const approved = await approveAskForCoordinator(DANIEL, askId, t.db, NOW);
    expect(approved.ok).toBe(true);

    const [approvalAudit] = await t.db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.action, "ask_approved"),
          eq(auditEvent.entityId, askId),
        ),
      );
    expect(approvalAudit.actorId).toBe(seedIds.people.daniel);
    const [askRow] = await t.db
      .select({ approvedBy: ask.approvedBy })
      .from(ask)
      .where(eq(ask.id, askId));
    expect(askRow.approvedBy).toBe(seedIds.people.daniel);

    expect(await notificationCount(t, askId)).toBe(0);
  });
});

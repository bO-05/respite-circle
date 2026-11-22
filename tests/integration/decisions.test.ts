import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql as rawSql } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { seedIds, seedQuestionSet } from "../../src/db/seed-data";
import { ask, askRevision, auditEvent, slot } from "../../src/db/schema";
import {
  computeDecisionDigest,
  sha256Hex,
  type QuestionId,
  type TypedAnswer,
} from "../../src/server/services/decision-contract";
import { decideForAsk } from "../../src/server/services/decide-for-ask";
import {
  createDeterministicProvider,
  type DecisionProvider,
} from "../../src/server/services/providers";
import { getDecisionsForAsk } from "../../src/server/repositories/decisions";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

async function insertAsk(
  t: TestDatabase,
  verbatimText: string,
): Promise<{ askId: string; revisionId: string }> {
  const [row] = await t.db
    .insert(ask)
    .values({
      churchId: seedIds.church,
      caregiverId: seedIds.people.marta,
      careRecipientId: seedIds.careRecipients.elena,
      verbatimText,
      status: "draft",
      policyVersionId: seedIds.policyV1,
    })
    .returning({ id: ask.id });

  const [revision] = await t.db
    .insert(askRevision)
    .values({
      askId: row.id,
      verbatimText,
      digest: sha256Hex(verbatimText),
      supersedesId: null,
    })
    .returning({ id: askRevision.id });

  return { askId: row.id, revisionId: revision.id };
}

function runFor(
  t: TestDatabase,
  askId: string,
  revisionId: string,
  provider: DecisionProvider,
  askText: string = HERO_ASK,
) {
  return decideForAsk({
    askId,
    revisionId,
    churchId: seedIds.church,
    askText,
    policy: { id: seedIds.policyV1, questionSet: seedQuestionSet },
    provider,
    database: t.db,
  });
}

const failingProvider: DecisionProvider = {
  name: "mistral",
  model: "failing-mistral",
  async call() {
    throw new Error("provider unavailable");
  },
};

describe("decision persistence and audit", () => {
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

  it("writes nine decision rows with recomputable SHA-256 digests and one audit event", async () => {
    const { askId, revisionId } = await insertAsk(t, HERO_ASK);
    const run = await runFor(t, askId, revisionId, createDeterministicProvider());

    expect(run.persisted).toBe(true);
    expect(run.decisionIds).toHaveLength(9);
    expect(run.provider).toBe("deterministic");
    expect(run.degraded).toBe(true);

    const rows = await getDecisionsForAsk(askId, t.db);
    expect(rows.map((row) => row.questionId)).toEqual([
      "Q1",
      "Q2",
      "Q3",
      "Q4",
      "Q5",
      "Q6",
      "Q7",
      "Q8",
      "Q9",
    ]);

    for (const row of rows) {
      expect(row.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(row.askRevisionId).toBe(revisionId);
      expect(row.provider).toBe("deterministic");
      expect(row.model).toBe("rule-engine-v1");
      expect(row.policyVersionId).toBe(seedIds.policyV1);
      expect(row.questionText.length).toBeGreaterThan(0);
      expect(row.confidence).toBeGreaterThanOrEqual(0);
      expect(row.confidence).toBeLessThanOrEqual(1);
      expect(row.abstained).toBe(false);
      expect(row.samples).toBe(
        (seedQuestionSet.find((question) => question.id === row.questionId)
          ?.samples ?? 1) >= 3
          ? 3
          : 1,
      );

      expect(
        computeDecisionDigest({
          askId,
          policyVersionId: row.policyVersionId,
          questionId: row.questionId as QuestionId,
          questionText: row.questionText,
          answerType: row.answerType,
          answer: row.answer as TypedAnswer,
          confidence: row.confidence,
          abstained: row.abstained,
          samples: row.samples ?? 0,
          provider: row.provider,
          model: row.model,
          latencyMs: row.latencyMs ?? 0,
          inputDigest: run.digest,
        }),
      ).toBe(row.digest);
    }

    const auditRows = await t.db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.entity, "ask"),
          eq(auditEvent.entityId, askId),
        ),
      );

    expect(auditRows).toHaveLength(1);
    const audit = auditRows[0];
    expect(audit.actorType).toBe("ai");
    expect(audit.action).toBe("ai_decision");
    expect(audit.churchId).toBe(seedIds.church);
    expect(audit.detail).toMatchObject({
      inputDigest: run.digest,
      revisionId,
      provider: "deterministic",
      model: "rule-engine-v1",
      policyVersionId: seedIds.policyV1,
      questionCount: 9,
      degraded: true,
      routingStatus: "waiting_coordinator",
      bilingualNeeded: false,
    });
    expect(typeof (audit.detail as { latencyMs?: unknown }).latencyMs).toBe(
      "number",
    );

    const [updatedAsk] = await t.db
      .select({ status: ask.status, language: ask.language })
      .from(ask)
      .where(eq(ask.id, askId));
    expect(updatedAsk.status).toBe("waiting_coordinator");
    expect(updatedAsk.language).toBe("en");
  });

  it("never copies the caregiver's words into a decision row or the audit detail", async () => {
    const { askId, revisionId } = await insertAsk(t, HERO_ASK);
    await runFor(t, askId, revisionId, createDeterministicProvider());

    const words = ["hymns", "March", "naps", "Elena", "morning to myself"];

    for (const word of words) {
      const [decisionHits] = await t.client<{ count: string }[]>`
        SELECT count(*)::text AS count
          FROM decision
         WHERE question_text ILIKE ${"%" + word + "%"}
            OR answer::text ILIKE ${"%" + word + "%"}
            OR model ILIKE ${"%" + word + "%"}
            OR provider ILIKE ${"%" + word + "%"}
      `;
      expect(decisionHits.count).toBe("0");

      const [auditHits] = await t.client<{ count: string }[]>`
        SELECT count(*)::text AS count
          FROM audit_event
         WHERE detail::text ILIKE ${"%" + word + "%"}
      `;
      expect(auditHits.count).toBe("0");
    }

    const [rawHits] = await t.client<{ count: string }[]>`
      SELECT count(*)::text AS count
        FROM audit_event
       WHERE detail::text ILIKE ${"%" + HERO_ASK.slice(0, 40) + "%"}
    `;
    expect(rawHits.count).toBe("0");
  });

  it("completes on the deterministic baseline when the provider fails after retries", async () => {
    const { askId, revisionId } = await insertAsk(t, HERO_ASK);
    const run = await runFor(t, askId, revisionId, failingProvider);

    expect(run.provider).toBe("deterministic");
    expect(run.engine).toBe("deterministic");
    expect(run.degraded).toBe(true);
    expect(run.persisted).toBe(true);

    const rows = await getDecisionsForAsk(askId, t.db);
    expect(rows).toHaveLength(9);
    expect(rows.every((row) => row.provider === "deterministic")).toBe(true);

    const [audit] = await t.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.entityId, askId));
    expect(audit.detail).toMatchObject({
      provider: "deterministic",
      degraded: true,
    });
  });

  it("routes a non-English ask to the coordinator, records abstentions, and creates no slots", async () => {
    const spanish =
      "Mi mamá necesita ayuda el sábado. No puede estar sola y yo trabajo todo el día.";
    const { askId, revisionId } = await insertAsk(t, spanish);

    const run = await decideForAsk({
      askId,
      revisionId,
      churchId: seedIds.church,
      askText: spanish,
      policy: { id: seedIds.policyV1, questionSet: seedQuestionSet },
      provider: createDeterministicProvider(),
      database: t.db,
    });

    expect(run.language.code).toBe("es");
    expect(run.routing.bilingualNeeded).toBe(true);
    expect(run.routing.slotConstructionAllowed).toBe(false);
    expect(run.provider).toBe("deterministic");

    const rows = await getDecisionsForAsk(askId, t.db);
    expect(rows).toHaveLength(9);
    expect(rows.every((row) => row.abstained)).toBe(true);
    expect(rows.every((row) => row.samples === 0)).toBe(true);

    const [updatedAsk] = await t.db
      .select({ status: ask.status, language: ask.language })
      .from(ask)
      .where(eq(ask.id, askId));
    expect(updatedAsk.status).toBe("waiting_coordinator");
    expect(updatedAsk.language).toBe("es");

    const [slotCount] = await t.db
      .select({ count: rawSql<number>`count(*)::int` })
      .from(slot)
      .where(eq(slot.askId, askId));
    expect(slotCount.count).toBe(0);

    const [audit] = await t.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.entityId, askId));
    expect(audit.detail).toMatchObject({
      bilingualNeeded: true,
      routingStatus: "waiting_coordinator",
    });
  });

  it("moves a safety ask to safety_hold and a personal-care ask to care_hold", async () => {
    const safetyText =
      "She fell last week and I am scared she will wander out of the house.";
    const safetyAsk = await insertAsk(t, safetyText);
    const safetyRun = await runFor(
      t,
      safetyAsk.askId,
      safetyAsk.revisionId,
      createDeterministicProvider(),
      safetyText,
    );
    expect(safetyRun.routing.status).toBe("safety_hold");
    expect(safetyRun.routing.slotConstructionAllowed).toBe(false);

    const [safetyRow] = await t.db
      .select({ status: ask.status })
      .from(ask)
      .where(eq(ask.id, safetyAsk.askId));
    expect(safetyRow.status).toBe("safety_hold");

    const careText = "I need help with bathing and remembering her medication.";
    const careAsk = await insertAsk(t, careText);
    const careRun = await runFor(
      t,
      careAsk.askId,
      careAsk.revisionId,
      createDeterministicProvider(),
      careText,
    );
    expect(careRun.routing.status).toBe("care_hold");
    expect(careRun.routing.slotConstructionAllowed).toBe(false);

    const [careRow] = await t.db
      .select({ status: ask.status })
      .from(ask)
      .where(eq(ask.id, careAsk.askId));
    expect(careRow.status).toBe("care_hold");

    const [slotCount] = await t.db
      .select({ count: rawSql<number>`count(*)::int` })
      .from(slot)
      .where(eq(slot.askId, safetyAsk.askId));
    expect(slotCount.count).toBe(0);
  });

  it("never moves an already-held ask back to the open queue", async () => {
    const { askId, revisionId } = await insertAsk(t, HERO_ASK);
    await t.db
      .update(ask)
      .set({ status: "safety_hold" })
      .where(eq(ask.id, askId));

    // The hero text is clear, so a fresh run would route to the queue — but a
    // hold is sticky and only a human closes it.
    await runFor(t, askId, revisionId, createDeterministicProvider());

    const [updated] = await t.db
      .select({ status: ask.status })
      .from(ask)
      .where(eq(ask.id, askId));
    expect(updated.status).toBe("safety_hold");
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { seedIds, seedQuestionSet } from "../../src/db/seed-data";
import { ask, auditEvent, decision, slot } from "../../src/db/schema";
import { getDecisionTrailForRevision } from "../../src/server/repositories/decision-trail";
import { submitAsk } from "../../src/server/services/ask-intake";
import type { QuestionId } from "../../src/server/services/decision-contract";
import type {
  DecisionProvider,
  ProviderCallInput,
  ProviderCallResult,
} from "../../src/server/services/providers";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-R2SAFE-007 — the saved record names the source of every hold.
 *
 * The unit test proves the routing with a stub provider that answers NO. This
 * one proves the same thing where a judge would read it: the `decision` row,
 * the ask status, the absence of a draft slot, the single audit event, and the
 * caregiver's own trail. A rule's answer may never be stored as the model's.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

const MARTA = {
  personId: seedIds.people.marta,
  churchId: seedIds.church,
  role: "caregiver" as const,
};

type AnswerSpec = { answer: boolean | string; confidence: number };

/** A plausible model answer that misses the safety and care signals. */
const MODEL_NO_ANSWERS: Record<QuestionId, AnswerSpec> = {
  Q1: { answer: true, confidence: 0.93 },
  Q2: { answer: false, confidence: 0.88 },
  Q3: { answer: true, confidence: 0.9 },
  Q4: { answer: "saturday", confidence: 0.9 },
  Q5: { answer: false, confidence: 0.97 },
  Q6: { answer: true, confidence: 0.84 },
  Q7: { answer: "reheats", confidence: 0.8 },
  Q8: { answer: false, confidence: 0.82 },
  Q9: { answer: false, confidence: 0.97 },
};

function stubProvider(
  overrides: Partial<Record<QuestionId, AnswerSpec>> = {},
): DecisionProvider {
  return {
    name: "mistral",
    model: "stub-model",
    async call(input: ProviderCallInput): Promise<ProviderCallResult> {
      return {
        payload: {
          decisions: input.questions.map((question) => {
            const id = question.id as QuestionId;
            const spec = overrides[id] ?? MODEL_NO_ANSWERS[id];
            return {
              questionId: id,
              answerType: typeof spec.answer === "boolean" ? "yesno" : "pick",
              answer: spec.answer,
              confidence: spec.confidence,
            };
          }),
        },
        provider: "mistral",
        model: "stub-model",
        latencyMs: 4,
      };
    },
  };
}

async function askRows(t: TestDatabase, askId: string) {
  return t.db.select().from(ask).where(eq(ask.id, askId));
}

async function decisionRows(t: TestDatabase, askId: string) {
  return t.db
    .select()
    .from(decision)
    .where(eq(decision.askId, askId));
}

async function auditRows(t: TestDatabase, askId: string) {
  // The intake writes its own ask event; the decision run writes exactly one
  // `ai_decision` event, and that is the one this test counts.
  return t.db
    .select()
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.entity, "ask"),
        eq(auditEvent.entityId, askId),
        eq(auditEvent.action, "ai_decision"),
      ),
    );
}

async function slotRows(t: TestDatabase, askId: string) {
  return t.db.select().from(slot).where(eq(slot.askId, askId));
}

describe("VAL-R2SAFE-007 — a rule hold is stored as a rule hold", () => {
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

  it("stores a safety disclosure the model missed as a rule hold with no slot", async () => {
    const text = "I'm scared of him";
    const result = await submitAsk({
      actor: MARTA,
      text,
      consent: true,
      database: t.db,
      provider: stubProvider(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [stored] = await askRows(t, result.askId);
    expect(stored.status).toBe("safety_hold");

    const rows = await decisionRows(t, result.askId);
    const q5 = rows.find((row) => row.questionId === "Q5");
    expect(q5?.answer).toBe(true);
    expect(q5?.abstained).toBe(false);
    expect(q5?.signalSource).toBe("rule");
    const q9 = rows.find((row) => row.questionId === "Q9");
    expect(q9?.signalSource).toBeNull();

    expect(await slotRows(t, result.askId)).toHaveLength(0);

    const audits = await auditRows(t, result.askId);
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({
      routingStatus: "safety_hold",
      slotConstructionAllowed: false,
      holdSources: { Q5: "rule" },
    });

    // The caregiver's own trail reads the source back from the row.
    const trail = await getDecisionTrailForRevision(
      {
        personId: seedIds.people.marta,
        churchId: seedIds.church,
        role: "caregiver",
      },
      { askId: result.askId, revisionId: result.revisionId },
      t.db,
    );
    const trailQ5 = trail?.decisions.find((row) => row.questionId === "Q5");
    expect(trailQ5?.signalSource).toBe("rule");
    expect(trailQ5?.answer).toBe(true);
  });

  it("stores a care word the model missed as a rule hold with no slot", async () => {
    const result = await submitAsk({
      actor: MARTA,
      text: "nappies",
      consent: true,
      database: t.db,
      provider: stubProvider(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [stored] = await askRows(t, result.askId);
    expect(stored.status).toBe("care_hold");

    const rows = await decisionRows(t, result.askId);
    expect(
      rows.find((row) => row.questionId === "Q9")?.signalSource,
    ).toBe("rule");
    expect(await slotRows(t, result.askId)).toHaveLength(0);

    const audits = await auditRows(t, result.askId);
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({
      routingStatus: "care_hold",
      slotConstructionAllowed: false,
      holdSources: { Q9: "rule" },
    });
  });

  it("keeps a model YES as a single model hold with one audit entry", async () => {
    const result = await submitAsk({
      actor: MARTA,
      text: "Mum has been low this week. Could someone sit with her?",
      consent: true,
      database: t.db,
      provider: stubProvider({ Q5: { answer: true, confidence: 0.92 } }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await decisionRows(t, result.askId);
    expect(rows.filter((row) => row.questionId === "Q5")).toHaveLength(1);
    const q5 = rows.find((row) => row.questionId === "Q5");
    expect(q5?.answer).toBe(true);
    expect(q5?.signalSource).toBe("model");

    const [stored] = await askRows(t, result.askId);
    expect(stored.status).toBe("safety_hold");
    expect(await slotRows(t, result.askId)).toHaveLength(0);

    const audits = await auditRows(t, result.askId);
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({
      holdSources: { Q5: "model" },
    });
  });

  it("keeps the hero ask on the ordinary route and proposes the same times", async () => {
    const result = await submitAsk({
      actor: MARTA,
      text: HERO_ASK,
      consent: true,
      database: t.db,
      provider: stubProvider(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [stored] = await askRows(t, result.askId);
    expect(stored.status).toBe("waiting_coordinator");

    const rows = await decisionRows(t, result.askId);
    expect(
      rows
        .filter((row) => row.questionId === "Q5" || row.questionId === "Q9")
        .every((row) => row.signalSource === null),
    ).toBe(true);

    const drafts = await slotRows(t, result.askId);
    expect(drafts.map((row) => row.kind).sort()).toEqual([
      "companion",
      "home",
      "meal",
    ]);

    const audits = await auditRows(t, result.askId);
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({
      routingStatus: "waiting_coordinator",
      slotConstructionAllowed: true,
      holdSources: {},
    });
  });

  it("keeps the seed question set the screen reads", () => {
    expect(seedQuestionSet.map((question) => question.id)).toEqual([
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
  });
});

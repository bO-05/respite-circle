import { describe, expect, it } from "vitest";
import { seedQuestionSet } from "@/db/seed-data";
import type { PolicyQuestion } from "@/db/schema";
import {
  applyDeterministicHoldScreen,
  HOLD_SCREEN_VERSION,
} from "@/server/domain/deterministic-screen";
import { predictSlotKinds } from "@/server/domain/calibration";
import { buildDraftSlots, type TypedAnswer } from "@/server/domain/slots";
import { decide } from "@/server/services/decide";
import type { QuestionId } from "@/server/services/decision-contract";
import type {
  DecisionProvider,
  ProviderCallInput,
  ProviderCallResult,
} from "@/server/services/providers";
import {
  AUDITED_ABUSE_PHRASES,
  AUDITED_SAFETY_PHRASES,
  AUDITED_SUICIDAL_IDEATION_PHRASES,
} from "../fixtures/audited-safety-phrases";
import { AUDITED_ASK_PERSONAL_CARE_PHRASES } from "../fixtures/personal-care-strings";

/**
 * VAL-R2SAFE-007 — a model that misses a disclosure cannot release it.
 *
 * Production prefers the live provider. The live Mistral run at b558a79
 * answered NO to "Sometimes I want to die", "I'm scared of him" and "she
 * threatened me", and missed nappies, diapers, eye drops, inhaler, accidents
 * and loo. The deterministic screen runs over the ask's own words beside the
 * model answer and may only add a hold, never remove one.
 *
 * Every phrase below runs through the real `decide()` →
 * `resolveDecisionRouting` → `buildDraftSlots` pipeline with a stub provider
 * that answers NO to Q5 and Q9 and YES to the sitting and meal questions, so a
 * slot would be proposed if the screen did not hold the ask.
 */

const QUESTIONS: PolicyQuestion[] = seedQuestionSet.map((question) => ({
  ...question,
}));

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

const TIME_ZONE = "America/New_York";
// Tuesday 17 November 2026, 10:00 in New York: the next Respite Morning is a
// week away, so a companion place is still offerable.
const NOW = new Date("2026-11-17T15:00:00.000Z");

const SESSION = {
  id: "session-1",
  startsAt: new Date("2026-11-24T15:00:00.000Z"),
  endsAt: new Date("2026-11-24T19:00:00.000Z"),
  capacity: 12,
  usedCompanionPlaces: 0,
  status: "scheduled" as const,
};

type AnswerSpec = { answer: boolean | string; confidence: number };

/** What a plausible model says when it does not see a safety or care signal. */
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

function payloadFor(
  questionIds: readonly string[],
  overrides: Partial<Record<QuestionId, AnswerSpec>> = {},
) {
  return {
    decisions: questionIds.map((questionId) => {
      const id = questionId as QuestionId;
      const spec = overrides[id] ?? MODEL_NO_ANSWERS[id];
      return {
        questionId: id,
        answerType: typeof spec.answer === "boolean" ? "yesno" : "pick",
        answer: spec.answer,
        confidence: spec.confidence,
      };
    }),
  };
}

function stubProvider(
  overrides: Partial<Record<QuestionId, AnswerSpec>> = {},
): DecisionProvider & { calls: ProviderCallInput[] } {
  const calls: ProviderCallInput[] = [];
  return {
    name: "mistral",
    model: "stub-model",
    calls,
    async call(input: ProviderCallInput): Promise<ProviderCallResult> {
      calls.push(input);
      return {
        payload: payloadFor(
          input.questions.map((question) => question.id),
          overrides,
        ),
        provider: "mistral",
        model: "stub-model",
        latencyMs: 3,
      };
    },
  };
}

async function runPipeline(
  askText: string,
  provider: DecisionProvider = stubProvider(),
) {
  const result = await decide({
    askText,
    questions: QUESTIONS,
    provider,
  });

  const answers: TypedAnswer[] = result.decisions.map((decision) => ({
    questionId: decision.questionId,
    answer: decision.answer,
    abstained: decision.abstained,
  }));

  const plan = buildDraftSlots({
    answers,
    sessions: [SESSION],
    recipientFirstName: "Elena",
    policy: { transportEnabled: true },
    now: NOW,
    timeZone: TIME_ZONE,
  });

  const decisionFor = (questionId: string) =>
    result.decisions.find((decision) => decision.questionId === questionId);

  return { result, plan, decisionFor };
}

/** VAL-R2SAFE-001/002 — the disclosure, the composite, and the request around it. */
const SAFETY_COMPOSITES = [
  "Sometimes I want to die. Could someone sit with Mum this Saturday?",
  "I wish I wasn't alive but I still need someone to sit with him on Tuesday.",
  "I don't want to be here anymore. Could someone come on Tuesday?",
  "my husband hits me. Could someone sit with me on Saturday morning?",
  "I'm not safe at home. Can someone come and sit with me on Tuesday?",
] as const;

describe("VAL-R2SAFE-007 — the screen holds every audited safety disclosure when the model says NO", () => {
  for (const phrase of AUDITED_SAFETY_PHRASES) {
    it(`holds "${phrase}" at safety_hold with nothing proposed`, async () => {
      const { result, plan, decisionFor } = await runPipeline(phrase);
      const q5 = decisionFor("Q5");

      expect(q5?.answer, phrase).toBe(true);
      expect(q5?.abstained, phrase).toBe(false);
      expect(q5?.signalSource, phrase).toBe("rule");
      expect(result.routing.status, phrase).toBe("safety_hold");
      expect(result.routing.safetyReview, phrase).toBe(true);
      expect(result.routing.slotConstructionAllowed, phrase).toBe(false);
      expect(result.holdSources.Q5, phrase).toBe("rule");
      expect(predictSlotKinds(result.decisions, result.routing), phrase).toEqual(
        [],
      );
      expect(plan.blocked?.reason, phrase).toBe("safety_flag");
      expect(plan.proposals, phrase).toEqual([]);
      expect(plan.skipped, phrase).toEqual([]);
    });
  }

  for (const phrase of SAFETY_COMPOSITES) {
    it(`holds the composite "${phrase}" and proposes nothing`, async () => {
      const { result, plan, decisionFor } = await runPipeline(phrase);

      expect(decisionFor("Q5")?.answer, phrase).toBe(true);
      expect(result.routing.status, phrase).toBe("safety_hold");
      expect(result.routing.slotConstructionAllowed, phrase).toBe(false);
      expect(plan.proposals, phrase).toEqual([]);
    });
  }

  it("imports the audited disclosure families from one fixture", () => {
    expect(AUDITED_SAFETY_PHRASES).toHaveLength(8);
    expect(AUDITED_SUICIDAL_IDEATION_PHRASES).toHaveLength(3);
    expect(AUDITED_ABUSE_PHRASES).toHaveLength(5);
  });
});

describe("VAL-R2CARE-001 — the screen holds every audited care phrase when the model says NO", () => {
  for (const phrase of AUDITED_ASK_PERSONAL_CARE_PHRASES) {
    it(`holds "${phrase}" at care_hold with nothing proposed`, async () => {
      const { result, plan, decisionFor } = await runPipeline(phrase);
      const q9 = decisionFor("Q9");

      expect(q9?.answer, phrase).toBe(true);
      expect(q9?.abstained, phrase).toBe(false);
      expect(q9?.signalSource, phrase).toBe("rule");
      expect(result.routing.status, phrase).toBe("care_hold");
      expect(result.routing.personalCareReview, phrase).toBe(true);
      expect(result.routing.slotConstructionAllowed, phrase).toBe(false);
      expect(result.holdSources.Q9, phrase).toBe("rule");
      expect(predictSlotKinds(result.decisions, result.routing), phrase).toEqual(
        [],
      );
      expect(plan.blocked?.reason, phrase).toBe("personal_care_flag");
      expect(plan.proposals, phrase).toEqual([]);
      expect(plan.skipped, phrase).toEqual([]);
    });
  }
});

describe("the screen can only add a hold, never remove one", () => {
  it("keeps a model YES as a model hold, once, with no second entry", async () => {
    const provider = stubProvider({
      Q5: { answer: true, confidence: 0.91 },
    });
    const { result, decisionFor } = await runPipeline(
      "Mum has been low this week.",
      provider,
    );

    const q5Rows = result.decisions.filter(
      (decision) => decision.questionId === "Q5",
    );
    expect(q5Rows).toHaveLength(1);
    expect(q5Rows[0].answer).toBe(true);
    expect(q5Rows[0].confidence).toBeCloseTo(0.91);
    expect(q5Rows[0].abstained).toBe(false);
    expect(q5Rows[0].signalSource).toBe("model");
    expect(result.routing.status).toBe("safety_hold");
    expect(result.routing.holdSources).toEqual({ Q5: "model" });
    expect(decisionFor("Q9")?.signalSource).toBeNull();
  });

  it("keeps a model YES for personal care as a model hold", async () => {
    const provider = stubProvider({
      Q9: { answer: true, confidence: 0.88 },
    });
    const { result, decisionFor } = await runPipeline(
      "She needs help with her medication.",
      provider,
    );

    expect(decisionFor("Q9")?.signalSource).toBe("model");
    expect(result.routing.status).toBe("care_hold");
    expect(result.routing.holdSources).toEqual({ Q9: "model" });
  });

  it("does not turn a settled NO into a hold on text the rule also declines", async () => {
    for (const phrase of [
      "I am safe at home",
      "we're safe for now",
      "no danger right now",
      "she takes her own tablets",
      "no medication needed",
    ]) {
      const { result, decisionFor, plan } = await runPipeline(phrase);
      expect(result.routing.status, phrase).toBe("waiting_coordinator");
      expect(result.routing.slotConstructionAllowed, phrase).toBe(true);
      expect(result.holdSources, phrase).toEqual({});
      expect(decisionFor("Q5")?.signalSource, phrase).not.toBe("rule");
      expect(decisionFor("Q9")?.signalSource, phrase).not.toBe("rule");
      expect(plan.blocked, phrase).toBeNull();
    }
  });

  it("keeps the hero ask on the ordinary route with the same slots as before", async () => {
    const { result, plan } = await runPipeline(HERO_ASK);

    expect(result.engine).toBe("live");
    expect(result.routing.status).toBe("waiting_coordinator");
    expect(result.routing.slotConstructionAllowed).toBe(true);
    expect(result.holdSources).toEqual({});

    // The same proposal the deterministic pipeline makes for this ask: a
    // companion place at the next Respite Morning and a gated home visit.
    expect(predictSlotKinds(result.decisions, result.routing)).toEqual([
      "companion",
      "meal",
    ]);
    expect(plan.blocked).toBeNull();
    expect(plan.proposals.map((proposal) => proposal.kind).sort()).toEqual([
      "companion",
      "home",
      "meal",
    ]);
  });

  it("leaves the seven other typed answers exactly as the model gave them", async () => {
    const { result } = await runPipeline("nappies");

    for (const questionId of ["Q1", "Q2", "Q3", "Q4", "Q6", "Q7", "Q8"]) {
      const decision = result.decisions.find(
        (entry) => entry.questionId === questionId,
      );
      const expected = MODEL_NO_ANSWERS[questionId as QuestionId];
      expect(decision?.answer, questionId).toEqual(expected.answer);
      expect(decision?.confidence, questionId).toBe(expected.confidence);
      expect(decision?.signalSource ?? null, questionId).toBeNull();
    }
  });
});

describe("applyDeterministicHoldScreen", () => {
  it("answers nothing when every decision already allows the ask", async () => {
    const { result } = await runPipeline(HERO_ASK);
    const screened = applyDeterministicHoldScreen({
      askText: HERO_ASK,
      decisions: result.decisions,
    });

    expect(screened.holdSources).toEqual({});
    expect(screened.decisions).toHaveLength(9);
  });

  it("abstains rather than guessing when the rule sees a signal and a denial", async () => {
    const text = "Sometimes I want to die, but I am safe at home for now.";
    const { result } = await runPipeline(text, stubProvider());
    const q5 = result.decisions.find((decision) => decision.questionId === "Q5");

    expect(result.routing.status).toBe("safety_hold");
    expect(result.holdSources.Q5).toBe("rule");
    expect(q5?.abstained).toBe(true);
    expect(q5?.confidence).toBeLessThan(0.6);
    expect(result.routing.slotConstructionAllowed).toBe(false);
  });

  it("names the screen version the calibration record publishes", () => {
    expect(HOLD_SCREEN_VERSION).toBe("safety-care-screen-v1");
  });
});

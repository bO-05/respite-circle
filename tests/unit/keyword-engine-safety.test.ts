import { describe, expect, it } from "vitest";
import { seedQuestionSet } from "@/db/seed-data";
import type { PolicyQuestion } from "@/db/schema";
import { mentionsPersonalCare } from "@/server/domain/keyword-engine";
import { buildDraftSlots, type TypedAnswer } from "@/server/domain/slots";
import { decide } from "@/server/services/decide";
import { createDeterministicProvider } from "@/server/services/providers";

/**
 * VAL-R2SAFE-001, VAL-R2SAFE-002, VAL-R2SAFE-003 and VAL-R2SAFE-004 — the
 * offline safety screen for plain disclosures, and the ordinary talk it must
 * not mistake for one.
 *
 * The deterministic engine is the labelled fallback whenever no model provider
 * is configured or the provider errors, and it is the engine every published
 * baseline number comes from. A disclosure it reads as a confident NO becomes
 * an ordinary ask, and plain code then proposes a slot a coordinator can
 * approve. Every phrase therefore runs through the real `decide()` →
 * `resolveDecisionRouting` → `buildDraftSlots` pipeline and must hold with
 * `slotConstructionAllowed: false` and nothing proposed.
 *
 * VAL-R2SAFE-003 is the other half: the explicit-negative rule may fire only on
 * a phrase that genuinely denies risk. "I'm not safe at home" is a disclosure,
 * not a denial, and may never carry the explicit-negative confidence.
 */

const QUESTIONS: PolicyQuestion[] = seedQuestionSet.map((question) => ({
  ...question,
}));

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

const TIME_ZONE = "America/New_York";
// Tuesday 17 November 2026, 10:00 in New York. The next Respite Morning is a
// week away, so a companion place can still be offered.
const NOW = new Date("2026-11-17T15:00:00.000Z");

const SESSION = {
  id: "session-1",
  startsAt: new Date("2026-11-24T15:00:00.000Z"),
  endsAt: new Date("2026-11-24T19:00:00.000Z"),
  capacity: 12,
  usedCompanionPlaces: 0,
  status: "scheduled" as const,
};

async function runPipeline(askText: string) {
  const result = await decide({
    askText,
    questions: QUESTIONS,
    provider: createDeterministicProvider(),
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

  const q5 = result.decisions.find((decision) => decision.questionId === "Q5");
  if (!q5) throw new Error("Q5 was not answered");

  return { result, q5, plan };
}

async function expectSafetyHold(askText: string) {
  const { result, q5, plan } = await runPipeline(askText);

  expect(q5.answer, askText).toBe(true);
  expect(q5.confidence, askText).toBeGreaterThanOrEqual(0.6);
  expect(result.routing.safetyReview, askText).toBe(true);
  expect(result.routing.status, askText).toBe("safety_hold");
  expect(result.routing.slotConstructionAllowed, askText).toBe(false);
  expect(plan.blocked?.reason, askText).toBe("safety_flag");
  expect(plan.proposals, askText).toEqual([]);
}

/** VAL-R2SAFE-001 — suicidal ideation in the words a family uses. */
const SUICIDAL_IDEATION_PHRASES = [
  "Sometimes I want to die",
  "I wish I wasn't alive",
  "I don't want to be here anymore",
] as const;

/** VAL-R2SAFE-002 — a plain disclosure of domestic abuse. */
const ABUSE_PHRASES = [
  "my husband hits me",
  "he hurt me last night",
  "I'm scared of him",
  "she threatened me",
  "I'm not safe at home",
] as const;

/** VAL-R2SAFE-001/002 — a disclosure with a request wrapped around it. */
const DISCLOSURE_COMPOSITES = [
  "Sometimes I want to die. Could someone sit with Mum this Saturday?",
  "my husband hits me. Could someone sit with me on Saturday morning?",
  "I'm not safe at home. Can someone come and sit with me on Tuesday?",
  "I wish I wasn't alive but I still need someone to sit with him on Tuesday.",
  "she threatened me and I'm scared of him. Could someone come Tuesday morning?",
] as const;

/**
 * "Not safe" in the contractions families actually type. These are the same
 * disclosure, so the positive rule must reach them and the negative rule must
 * not treat them as a denial.
 */
const DISCLOSURE_CONTRACTIONS = [
  "I don't feel safe at home",
  "she isn't safe with him",
  "they never felt safe there",
] as const;

/**
 * VAL-R2SAFE-003 — phrases that actually deny risk. Each must stay a clear NO
 * at the explicit-negative confidence, so an ordinary ask is not held.
 */
const DENIAL_PHRASES = [
  "I am safe at home",
  "we're safe for now",
  "no danger right now",
  "not unsafe",
] as const;

/**
 * VAL-R2SAFE-004 — ordinary talk of death, bereavement and old age. A husband
 * who died last year, a mother who is 93 and still alive, a frost-bitten
 * garden, a caregiver dead on her feet, and a family that talked about what
 * happens when someone dies are all descriptions of life. None of them says
 * the person answering is in danger, and holding them turns a tired caregiver
 * away from respite. Each must reach a real NO at the explicit-negative
 * confidence — not an abstention that holds the ask.
 */
const ORDINARY_TALK_OF_DEATH = [
  "my husband died last year and I haven't slept since",
  "she is 93 and still alive and loves the garden",
  "the garden died in the frost",
  "I'm dead on my feet by Friday",
  "we talked about what happens when she dies",
] as const;

/**
 * The disclosure forms the narrowing kept once bare "die" and bare "alive"
 * were removed. Each names the disclosure itself rather than the noun or verb,
 * so each must still hold on its own.
 */
const NARROWED_DISCLOSURE_FORMS = [
  "Sometimes I want to be dead",
  "I wish I was dead",
  "I could kill myself",
  "some days I think about killing myself",
] as const;

describe("VAL-R2SAFE-001 — suicidal ideation reaches the safety hold", () => {
  for (const phrase of SUICIDAL_IDEATION_PHRASES) {
    it(`answers YES, holds the ask, and proposes nothing for "${phrase}"`, async () => {
      await expectSafetyHold(phrase);
    });
  }

  it("holds a disclosure that also asks for a Saturday sit", async () => {
    await expectSafetyHold(DISCLOSURE_COMPOSITES[0]);
  });
});

describe("VAL-R2SAFE-002 — abuse disclosure reaches the safety hold", () => {
  for (const phrase of ABUSE_PHRASES) {
    it(`answers YES, holds the ask, and proposes nothing for "${phrase}"`, async () => {
      await expectSafetyHold(phrase);
    });
  }

  for (const composite of DISCLOSURE_COMPOSITES.slice(1)) {
    it(`holds the composite "${composite}"`, async () => {
      await expectSafetyHold(composite);
    });
  }

  for (const phrase of DISCLOSURE_CONTRACTIONS) {
    it(`holds the "not safe" contraction "${phrase}"`, async () => {
      await expectSafetyHold(phrase);
    });
  }
});

describe("VAL-R2SAFE-003 — a denial reads as a denial, a disclosure never does", () => {
  for (const phrase of DENIAL_PHRASES) {
    it(`answers NO at the explicit-negative confidence for "${phrase}"`, async () => {
      const { result, q5, plan } = await runPipeline(phrase);

      expect(q5.answer, phrase).toBe(false);
      // 0.86 is EXPLICIT_NEGATIVE_CONFIDENCE: a real, rule-matched denial.
      expect(q5.confidence, phrase).toBe(0.86);
      expect(result.routing.status, phrase).toBe("waiting_coordinator");
      expect(result.routing.slotConstructionAllowed, phrase).toBe(true);
      expect(plan.blocked, phrase).toBeNull();
    });
  }

  it("never gives a disclosure the explicit-negative confidence", async () => {
    for (const phrase of [
      ...SUICIDAL_IDEATION_PHRASES,
      ...ABUSE_PHRASES,
      ...DISCLOSURE_COMPOSITES,
      ...DISCLOSURE_CONTRACTIONS,
    ]) {
      const { q5 } = await runPipeline(phrase);
      expect(q5.confidence, phrase).not.toBe(0.86);
      expect(q5.answer, phrase).toBe(true);
    }
  });

  it("does not turn the plainest safety sentence into a denial", async () => {
    const { q5 } = await runPipeline("I'm not safe at home");
    expect(q5.answer).toBe(true);
    expect(q5.confidence).toBeGreaterThan(0.6);
  });
});

describe("VAL-R2SAFE-004 — ordinary talk of death and old age is not a disclosure", () => {
  for (const phrase of ORDINARY_TALK_OF_DEATH) {
    it(`answers NO at the explicit-negative confidence on the ordinary route for "${phrase}"`, async () => {
      const { result, q5, plan } = await runPipeline(phrase);

      expect(q5.answer, phrase).toBe(false);
      // 0.86 is EXPLICIT_NEGATIVE_CONFIDENCE: the rule recognised ordinary
      // talk. A default 0.78 would be a guess and a sub-0.60 answer would
      // abstain into a safety hold, which is the diversion this guards.
      expect(q5.confidence, phrase).toBe(0.86);
      expect(result.routing.safetyReview, phrase).toBe(false);
      expect(result.routing.status, phrase).toBe("waiting_coordinator");
      expect(result.routing.slotConstructionAllowed, phrase).toBe(true);
      expect(plan.blocked, phrase).toBeNull();
    });
  }

  it("still holds every disclosure phrase beside the ordinary-talk set", async () => {
    for (const phrase of [...SUICIDAL_IDEATION_PHRASES, ...ABUSE_PHRASES]) {
      const { q5, result } = await runPipeline(phrase);
      expect(q5.answer, phrase).toBe(true);
      expect(q5.confidence, phrase).not.toBe(0.86);
      expect(result.routing.status, phrase).toBe("safety_hold");
    }
  });

  it("still holds the disclosure forms the narrowing kept", async () => {
    for (const phrase of NARROWED_DISCLOSURE_FORMS) {
      await expectSafetyHold(phrase);
    }
  });
});

describe("the safety rules keep the ordinary ask and the built-in notes working", () => {
  it("keeps Marta's hero ask on the ordinary route with companion and gated home slots", async () => {
    const { result, plan } = await runPipeline(HERO_ASK);

    const answerFor = (questionId: string) =>
      result.decisions.find((decision) => decision.questionId === questionId);

    expect(answerFor("Q1")?.answer).toBe(true);
    expect(answerFor("Q2")?.answer).toBe(false);
    expect(answerFor("Q3")?.answer).toBe(false);
    expect(answerFor("Q4")?.answer).toBe("saturday");
    expect(answerFor("Q5")?.answer).toBe(false);
    expect(answerFor("Q6")?.answer).toBe(true);
    expect(answerFor("Q9")?.answer).toBe(false);

    expect(result.routing.status).toBe("waiting_coordinator");
    expect(result.routing.slotConstructionAllowed).toBe(true);
    expect(plan.blocked).toBeNull();
    expect(plan.proposals.map((proposal) => proposal.kind)).toEqual([
      "companion",
      "home",
    ]);
  });

  it("keeps the four built-in orientation notes and labels out of the personal-care screen", () => {
    const answers: TypedAnswer[] = [
      { questionId: "Q1", answer: true, abstained: false },
      { questionId: "Q2", answer: true, abstained: false },
      { questionId: "Q3", answer: true, abstained: false },
      { questionId: "Q4", answer: "saturday", abstained: false },
      { questionId: "Q5", answer: false, abstained: false },
      { questionId: "Q6", answer: true, abstained: false },
      { questionId: "Q7", answer: "reheats", abstained: false },
      { questionId: "Q8", answer: false, abstained: false },
      { questionId: "Q9", answer: false, abstained: false },
    ];

    const plan = buildDraftSlots({
      answers,
      sessions: [SESSION],
      recipientFirstName: "Elena",
      policy: { transportEnabled: true },
      now: NOW,
      timeZone: TIME_ZONE,
    });

    expect(plan.blocked).toBeNull();
    expect(plan.proposals.map((proposal) => proposal.kind)).toEqual([
      "companion",
      "home",
      "drive",
      "meal",
    ]);

    for (const proposal of plan.proposals) {
      expect(mentionsPersonalCare(proposal.orientationNote), proposal.kind).toBe(
        false,
      );
      expect(mentionsPersonalCare(proposal.label), proposal.kind).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";
import { seedQuestionSet } from "@/db/seed-data";
import type { PolicyQuestion } from "@/db/schema";
import {
  computeDecisionDigest,
  computeInputDigest,
  type QuestionId,
} from "@/server/services/decision-contract";
import { decide } from "@/server/services/decide";
import {
  createDeterministicProvider,
  resolveProviderName,
  type DecisionProvider,
  type ProviderCallInput,
  type ProviderCallResult,
} from "@/server/services/providers";

const QUESTIONS: PolicyQuestion[] = seedQuestionSet.map((question) => ({
  ...question,
}));

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

const SPANISH_ASK =
  "Mi mamá necesita ayuda el sábado. No puede estar sola y yo trabajo todo el día.";

type AnswerSpec = { answer: boolean | string; confidence: number };

const DEFAULTS: Record<QuestionId, AnswerSpec> = {
  Q1: { answer: true, confidence: 0.93 },
  Q2: { answer: false, confidence: 0.88 },
  Q3: { answer: false, confidence: 0.9 },
  Q4: { answer: "none_stated", confidence: 0.8 },
  Q5: { answer: false, confidence: 0.95 },
  Q6: { answer: true, confidence: 0.84 },
  Q7: { answer: "unknown", confidence: 0.7 },
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
      const spec = overrides[id] ?? DEFAULTS[id];
      return {
        questionId: id,
        answerType: typeof spec.answer === "boolean" ? "yesno" : "pick",
        answer: spec.answer,
        confidence: spec.confidence,
      };
    }),
  };
}

type FakeProvider = DecisionProvider & { calls: ProviderCallInput[] };

function fakeProvider(
  handler: (
    input: ProviderCallInput,
    callNumber: number,
  ) => unknown | Promise<unknown>,
): FakeProvider {
  const calls: ProviderCallInput[] = [];
  return {
    name: "mistral",
    model: "fake-mistral",
    calls,
    async call(input: ProviderCallInput): Promise<ProviderCallResult> {
      calls.push(input);
      const payload = await handler(input, calls.length);
      return {
        payload,
        provider: "mistral",
        model: "fake-mistral",
        latencyMs: 5,
      };
    },
  };
}

const unanswered = new Promise<never>(() => {
  // Never settles: the service must enforce its own timeout.
});

describe("decide()", () => {
  it("returns exactly nine typed decisions with no prose field", async () => {
    const provider = fakeProvider((input) =>
      payloadFor(input.questions.map((question) => question.id)),
    );

    const result = await decide({
      askText: HERO_ASK,
      questions: QUESTIONS,
      policyVersion: "policy-v1",
      provider,
    });

    expect(result.decisions).toHaveLength(9);
    expect(result.decisions.map((decision) => decision.questionId)).toEqual([
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
    expect(result.provider).toBe("mistral");
    expect(result.model).toBe("fake-mistral");
    expect(result.engine).toBe("live");
    expect(result.degraded).toBe(false);
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
    // The only field the screen may add is the closed provenance label on a
    // Q5/Q9 answer. Nothing else, and no key can carry prose.
    const allowedKeys = new Set([
      "abstained",
      "answer",
      "answerType",
      "confidence",
      "key",
      "questionId",
      "questionText",
      "samples",
      "signalSource",
    ]);
    for (const decision of result.decisions) {
      expect(
        Object.keys(decision).every((key) => allowedKeys.has(key)),
      ).toBe(true);
      expect(["model", "rule", null, undefined]).toContain(
        decision.signalSource,
      );
    }
    expect(
      result.decisions
        .filter((decision) => decision.signalSource !== undefined)
        .map((decision) => decision.questionId),
    ).toEqual(["Q5", "Q9"]);
  });

  it("marks answers below 0.60 as abstained and keeps the typed safe answer", async () => {
    const provider = fakeProvider((input) =>
      payloadFor(input.questions.map((question) => question.id), {
        Q1: { answer: true, confidence: 0.41 },
        Q3: { answer: true, confidence: 0.58 },
      }),
    );

    const result = await decide({
      askText: HERO_ASK,
      questions: QUESTIONS,
      provider,
    });

    const q1 = result.decisions.find((decision) => decision.questionId === "Q1");
    const q3 = result.decisions.find((decision) => decision.questionId === "Q3");
    expect(q1?.abstained).toBe(true);
    expect(q1?.confidence).toBeCloseTo(0.41);
    expect(q3?.abstained).toBe(true);
    expect(result.routing.abstentions).toEqual(["Q1", "Q3"]);
    expect(result.routing.slotConstructionAllowed).toBe(true);
  });

  it("uses three samples for Q5 and Q9, and any YES wins", async () => {
    const provider = fakeProvider((input, callNumber) => {
      const ids = input.questions.map((question) => question.id);
      if (callNumber === 1) {
        return payloadFor(ids, {
          Q5: { answer: false, confidence: 0.95 },
          Q9: { answer: false, confidence: 0.95 },
        });
      }
      if (callNumber === 2) {
        return payloadFor(ids, {
          Q5: { answer: true, confidence: 0.72 },
          Q9: { answer: false, confidence: 0.9 },
        });
      }
      return payloadFor(ids, {
        Q5: { answer: false, confidence: 0.9 },
        Q9: { answer: false, confidence: 0.9 },
      });
    });

    const result = await decide({
      askText: HERO_ASK,
      questions: QUESTIONS,
      provider,
    });

    expect(provider.calls).toHaveLength(3);
    expect(provider.calls[1].questions.map((q) => q.id)).toEqual(["Q5", "Q9"]);
    expect(provider.calls[2].questions.map((q) => q.id)).toEqual(["Q5", "Q9"]);

    const q5 = result.decisions.find((decision) => decision.questionId === "Q5");
    const q9 = result.decisions.find((decision) => decision.questionId === "Q9");
    expect(q5?.answer).toBe(true);
    expect(q5?.abstained).toBe(false);
    expect(q5?.samples).toBe(3);
    expect(q9?.answer).toBe(false);
    expect(q9?.samples).toBe(3);
    expect(result.routing.status).toBe("safety_hold");
    expect(result.routing.slotConstructionAllowed).toBe(false);
  });

  it("abstains when Q5 samples disagree without a YES, never a silent NO", async () => {
    const provider = fakeProvider((input, callNumber) => {
      const ids = input.questions.map((question) => question.id);
      if (callNumber === 1) {
        return payloadFor(ids, {
          Q5: { answer: false, confidence: 0.9 },
          Q9: { answer: false, confidence: 0.9 },
        });
      }
      if (callNumber === 2) {
        return payloadFor(ids, {
          Q5: { answer: false, confidence: 0.45 },
          Q9: { answer: false, confidence: 0.9 },
        });
      }
      return payloadFor(ids, {
        Q5: { answer: false, confidence: 0.9 },
        Q9: { answer: false, confidence: 0.9 },
      });
    });

    const result = await decide({
      askText: HERO_ASK,
      questions: QUESTIONS,
      provider,
    });

    const q5 = result.decisions.find((decision) => decision.questionId === "Q5");
    expect(q5?.abstained).toBe(true);
    expect(q5?.answer).toBe(false);
    expect(q5?.samples).toBe(3);
    expect(result.routing.status).toBe("safety_hold");
  });

  it("routes a YES on Q9 to care_hold with no slot construction", async () => {
    const provider = fakeProvider((input, callNumber) => {
      const ids = input.questions.map((question) => question.id);
      return payloadFor(ids, {
        Q9:
          callNumber >= 2
            ? { answer: true, confidence: 0.86 }
            : { answer: false, confidence: 0.8 },
      });
    });

    const result = await decide({
      askText: "I need help with bathing and her medication.",
      questions: QUESTIONS,
      provider,
    });

    expect(result.routing.status).toBe("care_hold");
    expect(result.routing.slotConstructionAllowed).toBe(false);
  });

  it("falls back to the deterministic engine when the provider rejects the schema", async () => {
    const provider = fakeProvider((input) => {
      const payload = payloadFor(input.questions.map((question) => question.id));
      return {
        ...payload,
        decisions: payload.decisions.map((decision, index) =>
          index === 0
            ? { ...decision, explanation: "A quiet morning would help her." }
            : decision,
        ),
      };
    });

    const result = await decide({
      askText: HERO_ASK,
      questions: QUESTIONS,
      provider,
    });

    expect(provider.calls).toHaveLength(2);
    expect(result.provider).toBe("deterministic");
    expect(result.engine).toBe("deterministic");
    expect(result.degraded).toBe(true);
    expect(result.decisions).toHaveLength(9);
    expect(result.decisions[0].questionId).toBe("Q1");
    expect(result.decisions[0].answer).toBe(true);
  });

  it("rejects a string confidence rather than coercing it", async () => {
    const provider = fakeProvider((input) => {
      const payload = payloadFor(input.questions.map((question) => question.id));
      const first = { ...payload.decisions[0], confidence: "0.93" };
      return {
        ...payload,
        decisions: [first, ...payload.decisions.slice(1)],
      };
    });

    const result = await decide({
      askText: HERO_ASK,
      questions: QUESTIONS,
      provider,
    });

    expect(provider.calls).toHaveLength(2);
    expect(result.provider).toBe("deterministic");
    expect(result.degraded).toBe(true);
  });

  it("times out, retries once, then completes on the deterministic engine", async () => {
    const provider = fakeProvider(() => unanswered);

    const result = await decide({
      askText: HERO_ASK,
      questions: QUESTIONS,
      provider,
      timeoutMs: 25,
    });

    expect(provider.calls).toHaveLength(2);
    expect(result.provider).toBe("deterministic");
    expect(result.engine).toBe("deterministic");
    expect(result.degraded).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.latencyMs).toBeLessThan(2_000);
    expect(result.decisions).toHaveLength(9);
  });

  it("never calls a provider for an empty or whitespace-only ask", async () => {
    const provider = fakeProvider((input) =>
      payloadFor(input.questions.map((question) => question.id)),
    );

    const result = await decide({
      askText: "   \n  ",
      questions: QUESTIONS,
      provider,
    });

    expect(provider.calls).toHaveLength(0);
    expect(result.provider).toBe("deterministic");
    expect(result.degraded).toBe(true);
    expect(result.emptyInput).toBe(true);
    expect(result.routing.status).toBe("waiting_coordinator");
    expect(result.routing.slotConstructionAllowed).toBe(false);
    expect(result.decisions.every((decision) => decision.abstained)).toBe(true);
    expect(result.decisions.every((decision) => decision.samples === 0)).toBe(true);
  });

  it("routes a non-English ask to the coordinator without calling a model", async () => {
    const provider = fakeProvider((input) =>
      payloadFor(input.questions.map((question) => question.id)),
    );

    const result = await decide({
      askText: SPANISH_ASK,
      questions: QUESTIONS,
      provider,
    });

    expect(provider.calls).toHaveLength(0);
    expect(result.language.code).toBe("es");
    expect(result.language.nonEnglish).toBe(true);
    expect(result.routing.status).toBe("waiting_coordinator");
    expect(result.routing.bilingualNeeded).toBe(true);
    expect(result.routing.slotConstructionAllowed).toBe(false);
    expect(result.decisions.every((decision) => decision.abstained)).toBe(true);
  });

  it("answers Marta's hero ask correctly on the deterministic engine", async () => {
    const result = await decide({
      askText: HERO_ASK,
      questions: QUESTIONS,
      provider: createDeterministicProvider(),
    });

    const answer = (id: QuestionId) =>
      result.decisions.find((decision) => decision.questionId === id);

    expect(answer("Q1")?.answer).toBe(true);
    expect(answer("Q2")?.answer).toBe(false);
    expect(answer("Q3")?.answer).toBe(false);
    expect(answer("Q4")?.answer).toBe("saturday");
    expect(answer("Q5")?.answer).toBe(false);
    expect(answer("Q6")?.answer).toBe(true);
    expect(answer("Q9")?.answer).toBe(false);

    expect(result.provider).toBe("deterministic");
    expect(result.model).toBe("rule-engine-v1");
    expect(result.degraded).toBe(true);
    expect(result.routing.status).toBe("waiting_coordinator");
    expect(result.routing.slotConstructionAllowed).toBe(true);
  });

  it("never throws when the provider itself throws", async () => {
    const provider = fakeProvider(() => {
      throw new Error("provider exploded");
    });

    const result = await decide({
      askText: HERO_ASK,
      questions: QUESTIONS,
      provider,
    });

    expect(result.provider).toBe("deterministic");
    expect(result.degraded).toBe(true);
    expect(result.decisions).toHaveLength(9);
  });

  it("digests the same input identically and different input differently", async () => {
    const run = () =>
      decide({
        askText: HERO_ASK,
        questions: QUESTIONS,
        policyVersion: "policy-v1",
        provider: createDeterministicProvider(),
      });

    const first = await run();
    const second = await run();
    expect(first.digest).toBe(second.digest);

    const other = await decide({
      askText: `${HERO_ASK} And some more.`,
      questions: QUESTIONS,
      policyVersion: "policy-v1",
      provider: createDeterministicProvider(),
    });
    expect(other.digest).not.toBe(first.digest);

    expect(first.digest).toBe(
      computeInputDigest({
        askText: HERO_ASK,
        questions: QUESTIONS,
        policyVersionId: "policy-v1",
      }),
    );
  });

  it("computes a 64-character decision digest from the stored fields", () => {
    const digest = computeDecisionDigest({
      askId: "ask-1",
      policyVersionId: "policy-v1",
      questionId: "Q1",
      questionText: "Would sitting with them help?",
      answerType: "yesno",
      answer: true,
      confidence: 0.93,
      abstained: false,
      samples: 1,
      provider: "mistral",
      model: "mistral-small-latest",
      latencyMs: 812,
      inputDigest: "a".repeat(64),
    });

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(
      computeDecisionDigest({
        askId: "ask-1",
        policyVersionId: "policy-v1",
        questionId: "Q1",
        questionText: "Would sitting with them help?",
        answerType: "yesno",
        answer: false,
        confidence: 0.93,
        abstained: false,
        samples: 1,
        provider: "mistral",
        model: "mistral-small-latest",
        latencyMs: 812,
        inputDigest: "a".repeat(64),
      }),
    ).not.toBe(digest);
  });
});

describe("provider selection", () => {
  it("prefers Mistral, then HuggingFace, then OpenRouter, then the rules engine", () => {
    expect(
      resolveProviderName({
        MISTRAL_API_KEY: "m",
        HF_TOKEN: "h",
        OPENROUTER_API_KEY: "o",
      }),
    ).toBe("mistral");
    expect(
      resolveProviderName({ HF_TOKEN: "h", OPENROUTER_API_KEY: "o" }),
    ).toBe("hf");
    expect(resolveProviderName({ OPENROUTER_API_KEY: "o" })).toBe("openrouter");
    expect(resolveProviderName({})).toBe("deterministic");
  });

  it("honours an explicit override and never selects a keyless provider", () => {
    expect(
      resolveProviderName({ LLM_PROVIDER: "deterministic", MISTRAL_API_KEY: "m" }),
    ).toBe("deterministic");
    expect(
      resolveProviderName({ RC_AI_PROVIDER: "fake", MISTRAL_API_KEY: "m" }),
    ).toBe("deterministic");
    expect(resolveProviderName({ LLM_PROVIDER: "mistral" })).toBe(
      "deterministic",
    );
    expect(
      resolveProviderName({ LLM_PROVIDER: "hf", HF_TOKEN: "h" }),
    ).toBe("hf");
  });

  it("uses the deterministic engine for RC_AI_PROVIDER=fake without a network call", async () => {
    const result = await decide({
      askText: HERO_ASK,
      questions: QUESTIONS,
      env: { RC_AI_PROVIDER: "fake" },
    });

    expect(result.provider).toBe("deterministic");
    expect(result.model).toBe("rule-engine-v1");
    expect(result.decisions).toHaveLength(9);
    expect(result.routing.status).toBe("waiting_coordinator");
  });
});

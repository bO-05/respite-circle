import { describe, expect, it } from "vitest";
import { z } from "zod";
import { seedQuestionSet } from "@/db/seed-data";
import {
  DECISION_MIN_CONFIDENCE,
  NineQuestionResponseSchema,
  buildResponseSchema,
  normaliseModelPayload,
  validateResponse,
} from "@/server/services/decision-contract";

function basePayload() {
  return {
    decisions: [
      { questionId: "Q1", answerType: "yesno", answer: true, confidence: 0.93 },
      { questionId: "Q2", answerType: "yesno", answer: false, confidence: 0.88 },
      { questionId: "Q3", answerType: "yesno", answer: false, confidence: 0.9 },
      { questionId: "Q4", answerType: "pick", answer: "saturday", confidence: 0.85 },
      { questionId: "Q5", answerType: "yesno", answer: false, confidence: 0.95 },
      { questionId: "Q6", answerType: "yesno", answer: true, confidence: 0.8 },
      { questionId: "Q7", answerType: "pick", answer: "unknown", confidence: 0.7 },
      { questionId: "Q8", answerType: "yesno", answer: false, confidence: 0.82 },
      { questionId: "Q9", answerType: "yesno", answer: false, confidence: 0.97 },
    ],
  };
}

describe("the typed decision contract", () => {
  it("accepts nine closed answers and no other shape", () => {
    const parsed = NineQuestionResponseSchema.safeParse(basePayload());
    expect(parsed.success).toBe(true);

    const checked = validateResponse(basePayload(), seedQuestionSet);
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.answers).toHaveLength(9);
      expect(checked.answers.map((answer) => answer.questionId)).toEqual([
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
    }
  });

  it("rejects a schema-valid payload that carries an extra prose key", () => {
    const payload = basePayload();
    const withProse = {
      decisions: payload.decisions.map((decision, index) =>
        index === 0
          ? { ...decision, explanation: "She sounds exhausted and needs a break." }
          : decision,
      ),
    };

    expect(NineQuestionResponseSchema.safeParse(withProse).success).toBe(false);
    expect(validateResponse(withProse, seedQuestionSet).ok).toBe(false);
  });

  it("rejects model prose at the top level as well", () => {
    const payload = { ...basePayload(), summary: "Marta needs a companion." };
    expect(NineQuestionResponseSchema.safeParse(payload).success).toBe(false);
    expect(validateResponse(payload, seedQuestionSet).ok).toBe(false);
  });

  it("rejects a string confidence instead of coercing it", () => {
    const payload = basePayload();
    payload.decisions[0] = {
      ...payload.decisions[0],
      confidence: "0.93" as unknown as number,
    };

    expect(NineQuestionResponseSchema.safeParse(payload).success).toBe(false);
    expect(validateResponse(payload, seedQuestionSet).ok).toBe(false);
  });

  it("rejects an answer whose type contradicts the policy question", () => {
    const payload = basePayload();
    payload.decisions[0] = {
      ...payload.decisions[0],
      answerType: "pick",
      answer: "saturday",
    };

    const checked = validateResponse(payload, seedQuestionSet);
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.issues.join(" ")).toMatch(/Q1/);
    }
  });

  it("rejects a pick value borrowed from the other pick question", () => {
    const payload = basePayload();
    payload.decisions[3] = {
      ...payload.decisions[3],
      answer: "reheats",
    };

    const checked = validateResponse(payload, seedQuestionSet);
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.issues.join(" ")).toMatch(/Q4/);
    }
  });

  it("rejects a duplicate question id and a missing one", () => {
    const duplicate = basePayload();
    duplicate.decisions[1] = { ...duplicate.decisions[1], questionId: "Q1" };
    expect(validateResponse(duplicate, seedQuestionSet).ok).toBe(false);

    const missing = basePayload();
    missing.decisions.pop();
    expect(validateResponse(missing, seedQuestionSet).ok).toBe(false);
  });

  it("normalises display labels for pick answers before validation", () => {
    const payload = basePayload();
    payload.decisions[3] = {
      ...payload.decisions[3],
      answer: "Saturday",
    };
    payload.decisions[6] = {
      ...payload.decisions[6],
      answer: "Not a meal",
    };

    const checked = validateResponse(
      normaliseModelPayload(payload),
      seedQuestionSet,
    );
    expect(checked.ok).toBe(true);
    if (checked.ok) {
      expect(checked.answers[3].answer).toBe("saturday");
      expect(checked.answers[6].answer).toBe("not_a_meal");
    }
  });

  it("builds a schema whose length matches the sampled question set", () => {
    const sampleSchema = buildResponseSchema(["Q5", "Q9"]);
    const payload = {
      decisions: [
        { questionId: "Q5", answerType: "yesno", answer: false, confidence: 0.9 },
        { questionId: "Q9", answerType: "yesno", answer: false, confidence: 0.9 },
      ],
    };

    expect(sampleSchema.safeParse(payload).success).toBe(true);
    expect(sampleSchema.safeParse(basePayload()).success).toBe(false);
  });

  it("carries no free-text field anywhere in its JSON schema", () => {
    const jsonSchema = z.toJSONSchema(NineQuestionResponseSchema);

    const stringNodes: Array<Record<string, unknown>> = [];
    const objectNodes: Array<Record<string, unknown>> = [];

    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (record.type === "string") stringNodes.push(record);
      if (record.type === "object") objectNodes.push(record);
      for (const value of Object.values(record)) {
        if (Array.isArray(value)) value.forEach(walk);
        else walk(value);
      }
    };
    walk(jsonSchema);

    expect(stringNodes.length).toBeGreaterThan(0);
    for (const node of stringNodes) {
      expect(Array.isArray(node.enum)).toBe(true);
    }
    expect(objectNodes.length).toBeGreaterThan(0);
    for (const node of objectNodes) {
      expect(node.additionalProperties).toBe(false);
    }
  });

  it("uses 0.60 as the single abstention threshold", () => {
    expect(DECISION_MIN_CONFIDENCE).toBe(0.6);
  });
});

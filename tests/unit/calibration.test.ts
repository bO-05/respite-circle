import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { seedQuestionSet } from "@/db/seed-data";
import type { PolicyQuestion } from "@/db/schema";
import {
  CALIBRATION_RESULT_FILES,
  CALIBRATION_SOURCE_LABEL,
  CalibrationHarnessError,
  combineCalibrationCases,
  parseCalibrationDataset,
  predictSlotKinds,
  scoreCalibration,
  type CalibrationCase,
  type CalibrationOutcome,
  type CalibrationRunMeta,
} from "@/server/domain/calibration";
import { renderCalibrationMarkdown } from "@/server/domain/calibration-report";
import type {
  DecisionOutcome,
  QuestionId,
  TypedAnswer,
} from "@/server/services/decision-contract";
import { decide } from "@/server/services/decide";
import { createDeterministicProvider } from "@/server/services/providers";

const BASE_META: CalibrationRunMeta = {
  source: "deterministic-baseline",
  provider: "deterministic",
  model: "rule-engine-v1",
  generatedAt: "2026-11-22T12:00:00.000Z",
  questionSet: "qset-1",
  promptVersion: "typed-9q-v1",
  gitCommit: "0123456789abcdef0123456789abcdef01234567",
  command: "npm run calibrate:baseline",
};

function caseEntry(
  id: string,
  expected: CalibrationCase["expected"],
  ask = "A fictional ask for a scoring fixture.",
): CalibrationCase {
  return { id, ask, expected };
}

function outcome(
  overrides: Partial<CalibrationOutcome> & { id: string },
): CalibrationOutcome {
  return {
    predictedKinds: [],
    safetyFlagged: false,
    personalCareFlagged: false,
    bilingual: false,
    routingStatus: "waiting_coordinator",
    abstained: false,
    abstentionCount: 0,
    samples: 3,
    latencyMs: 100,
    provider: "deterministic",
    model: "rule-engine-v1",
    degraded: false,
    providerAttempted: true,
    invalidResponse: false,
    ...overrides,
  };
}

function readDataset(relativePath: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf8"));
}

const SLOT_CASES = parseCalibrationDataset(
  readDataset("data/calibration.json"),
  "data/calibration.json",
);
const PERSONAL_CARE_CASES = parseCalibrationDataset(
  readDataset("data/personal-care-cases.json"),
  "data/personal-care-cases.json",
);

function typedDecision(
  questionId: QuestionId,
  answer: TypedAnswer,
  abstained = false,
): DecisionOutcome {
  const question = seedQuestionSet.find(
    (entry: PolicyQuestion) => entry.id === questionId,
  ) as PolicyQuestion;
  return {
    questionId,
    key: question.key,
    questionText: question.text,
    answerType: question.answerType === "pick" ? "pick" : "yesno",
    answer,
    confidence: abstained ? 0.2 : 0.9,
    abstained,
    samples: 1,
  };
}

describe("calibration scoring", () => {
  it("uses exact set equality and states the slottable denominator", () => {
    const cases = [
      caseEntry("CAL-001", {
        slottable: true,
        kinds: ["companion"],
        safety: false,
      }),
      caseEntry("CAL-002", {
        slottable: true,
        kinds: ["drive", "meal"],
        safety: false,
      }),
      caseEntry("CAL-003", {
        slottable: true,
        kinds: ["meal"],
        safety: false,
      }),
    ];
    const outcomes = [
      outcome({ id: "CAL-001", predictedKinds: ["companion"] }),
      outcome({ id: "CAL-002", predictedKinds: ["drive"] }),
      outcome({ id: "CAL-003", predictedKinds: ["meal", "drive"] }),
    ];

    const report = scoreCalibration(cases, outcomes, BASE_META);

    expect(report.scores.slotKindCorrect).toBe(1);
    expect(report.scores.slotKindDenominator).toBe(3);
    expect(report.scores.slotKindAgreement).toBeCloseTo(1 / 3, 4);
    expect(report.scores.falsePositiveKinds).toBe(1);
    expect(report.perCase.find((entry) => entry.id === "CAL-002")?.failure).toContain(
      "expected drive + meal, got drive",
    );
  });

  it("excludes safety-routed and bilingual asks from the slot-kind denominator", () => {
    const cases = [
      caseEntry("CAL-001", {
        slottable: true,
        kinds: ["companion"],
        safety: false,
      }),
      caseEntry("CAL-002", {
        slottable: false,
        kinds: ["companion"],
        safety: true,
      }),
      caseEntry("CAL-003", {
        slottable: false,
        kinds: ["companion"],
        safety: false,
        bilingual: true,
      }),
    ];
    const outcomes = [
      outcome({ id: "CAL-001", predictedKinds: ["companion"] }),
      outcome({
        id: "CAL-002",
        predictedKinds: [],
        safetyFlagged: true,
        routingStatus: "safety_hold",
      }),
      outcome({
        id: "CAL-003",
        predictedKinds: [],
        bilingual: true,
      }),
    ];

    const report = scoreCalibration(cases, outcomes, {
      ...BASE_META,
      source: "live",
      provider: "mistral",
      model: "mistral-small-latest",
    });

    expect(report.scores.slotKindDenominator).toBe(1);
    expect(report.scores.slotKindAgreement).toBe(1);
    expect(report.slottableCaseCount).toBe(1);
    expect(report.perCase.every((entry) => entry.pass)).toBe(true);
  });

  it("counts a safety hold as a recall hit and a missed flag as a miss", () => {
    const safetyCase = caseEntry(
      "CAL-010",
      { slottable: false, kinds: ["companion"], safety: true },
      "Mum fell and lay there for an hour.",
    );

    const hit = scoreCalibration(
      [safetyCase],
      [
        outcome({
          id: "CAL-010",
          safetyFlagged: true,
          routingStatus: "safety_hold",
        }),
      ],
      BASE_META,
    );
    expect(hit.scores.safetyRecall).toBe(1);

    const miss = scoreCalibration(
      [safetyCase],
      [outcome({ id: "CAL-010", predictedKinds: ["companion"] })],
      BASE_META,
    );
    expect(miss.scores.safetyRecall).toBe(0);
    expect(miss.gate.pass).toBe(false);
    expect(miss.gate.failures[0]).toContain("Safety recall 0/1");
    expect(miss.perCase[0].failure).toContain("expected a safety hold");
  });

  it("computes safety precision from every flagged case", () => {
    const cases = [
      caseEntry("CAL-020", {
        slottable: false,
        kinds: ["companion"],
        safety: true,
      }),
      caseEntry("CAL-021", {
        slottable: true,
        kinds: ["companion"],
        safety: false,
      }),
    ];
    const outcomes = [
      outcome({
        id: "CAL-020",
        safetyFlagged: true,
        routingStatus: "safety_hold",
      }),
      outcome({
        id: "CAL-021",
        safetyFlagged: true,
        routingStatus: "safety_hold",
      }),
    ];

    const report = scoreCalibration(cases, outcomes, BASE_META);

    expect(report.scores.safetyRecall).toBe(1);
    expect(report.scores.safetyFlaggedCount).toBe(2);
    expect(report.scores.safetyPrecision).toBe(0.5);
    expect(report.gate.pass).toBe(true);
  });

  it("computes personal-care recall and precision on the labelled cases", () => {
    const cases = [
      caseEntry("PC-001", {
        slottable: false,
        kinds: [],
        safety: false,
        personalCare: true,
      }),
      caseEntry("PC-002", {
        slottable: true,
        kinds: ["meal"],
        safety: false,
        personalCare: false,
      }),
      caseEntry("PC-003", {
        slottable: false,
        kinds: [],
        safety: false,
        personalCare: true,
      }),
    ];
    const outcomes = [
      outcome({
        id: "PC-001",
        personalCareFlagged: true,
        routingStatus: "care_hold",
      }),
      outcome({
        id: "PC-002",
        predictedKinds: ["meal"],
        personalCareFlagged: true,
        routingStatus: "care_hold",
      }),
      outcome({
        id: "PC-003",
        predictedKinds: [],
        personalCareFlagged: false,
      }),
    ];

    const report = scoreCalibration(cases, outcomes, BASE_META);

    expect(report.scores.personalCarePositiveCount).toBe(2);
    expect(report.scores.personalCareTruePositiveCount).toBe(1);
    expect(report.scores.personalCareRecall).toBe(0.5);
    expect(report.scores.personalCareFlaggedCount).toBe(2);
    expect(report.scores.personalCarePrecision).toBe(0.5);
    expect(report.gate.failures[0]).toContain("Personal-care recall 1/2");
  });

  it("reports abstention rate, invalid responses, mean and p95 latency from the outcomes", () => {
    const cases = ["CAL-001", "CAL-002", "CAL-003", "CAL-004"].map((id) =>
      caseEntry(id, { slottable: true, kinds: ["companion"], safety: false }),
    );
    const outcomes = [
      outcome({
        id: "CAL-001",
        predictedKinds: ["companion"],
        latencyMs: 10,
      }),
      outcome({
        id: "CAL-002",
        predictedKinds: ["companion"],
        abstained: true,
        abstentionCount: 2,
        latencyMs: 20,
        invalidResponse: true,
      }),
      outcome({
        id: "CAL-003",
        predictedKinds: ["companion"],
        latencyMs: 30,
      }),
      outcome({
        id: "CAL-004",
        predictedKinds: ["companion"],
        abstained: true,
        abstentionCount: 9,
        latencyMs: 40,
      }),
    ];

    const report = scoreCalibration(cases, outcomes, BASE_META);

    expect(report.scores.abstainedCaseCount).toBe(2);
    expect(report.scores.abstentionRate).toBe(0.5);
    expect(report.scores.providerAttemptCount).toBe(4);
    expect(report.scores.invalidResponseCount).toBe(1);
    expect(report.scores.invalidJsonRate).toBe(0.25);
    expect(report.scores.meanLatencyMs).toBe(25);
    expect(report.scores.p95LatencyMs).toBe(40);
  });

  it("labels the source and keeps live and baseline records in different files", () => {
    const cases = [
      caseEntry("CAL-001", {
        slottable: true,
        kinds: ["companion"],
        safety: false,
      }),
    ];
    const outcomes = [outcome({ id: "CAL-001", predictedKinds: ["companion"] })];

    const baseline = scoreCalibration(cases, outcomes, BASE_META);
    expect(baseline.source).toBe("deterministic-baseline");
    expect(baseline.engine).toBe("deterministic-baseline");
    const baselineMarkdown = renderCalibrationMarkdown(baseline);
    expect(baselineMarkdown).toContain("Deterministic baseline (no model calls)");
    expect(baselineMarkdown).toContain("`deterministic-baseline`");
    expect(baselineMarkdown).not.toContain("Measured with live model");

    const live = scoreCalibration(cases, outcomes, {
      ...BASE_META,
      source: "live",
      provider: "mistral",
      model: "mistral-small-latest",
    });
    expect(live.source).toBe("live");
    expect(live.engine).toBe("live");
    expect(renderCalibrationMarkdown(live)).toContain("Measured with live model");

    expect(CALIBRATION_RESULT_FILES.live.json).not.toBe(
      CALIBRATION_RESULT_FILES["deterministic-baseline"].json,
    );
    expect(CALIBRATION_RESULT_FILES.live.markdown).not.toBe(
      CALIBRATION_RESULT_FILES["deterministic-baseline"].markdown,
    );
    expect(CALIBRATION_SOURCE_LABEL["deterministic-baseline"]).toBe(
      "Deterministic baseline (no model calls)",
    );
  });

  it("refuses to score a harness mismatch", () => {
    const cases = [
      caseEntry("CAL-001", {
        slottable: true,
        kinds: ["companion"],
        safety: false,
      }),
      caseEntry("CAL-002", {
        slottable: true,
        kinds: ["meal"],
        safety: false,
      }),
    ];
    const complete = [
      outcome({ id: "CAL-001", predictedKinds: ["companion"] }),
      outcome({ id: "CAL-002", predictedKinds: ["meal"] }),
    ];

    expect(() => scoreCalibration(cases, [complete[0]], BASE_META)).toThrow(
      CalibrationHarnessError,
    );
    expect(() =>
      scoreCalibration(
        cases,
        [...complete, outcome({ id: "CAL-999" })],
        BASE_META,
      ),
    ).toThrow(/Outcomes without a case/);
    expect(() =>
      scoreCalibration(cases, [complete[0], complete[0], complete[1]], BASE_META),
    ).toThrow(/appears twice/);
    expect(() => scoreCalibration([], [], BASE_META)).toThrow(CalibrationHarnessError);
    expect(() =>
      scoreCalibration(cases, complete, { ...BASE_META, gitCommit: "" }),
    ).toThrow(CalibrationHarnessError);
    expect(() =>
      scoreCalibration(cases, complete, {
        ...BASE_META,
        source: "merged" as CalibrationRunMeta["source"],
      }),
    ).toThrow(CalibrationHarnessError);
  });
});

describe("the committed case sets", () => {
  it("carries 33 slot-kind/safety cases and 16 personal-care cases", () => {
    expect(SLOT_CASES).toHaveLength(33);
    expect(PERSONAL_CARE_CASES).toHaveLength(16);

    const combined = combineCalibrationCases(SLOT_CASES, PERSONAL_CARE_CASES);
    expect(combined).toHaveLength(49);
    expect(new Set(combined.map((entry) => entry.id)).size).toBe(49);

    expect(SLOT_CASES.filter((entry) => entry.expected.safety)).toHaveLength(7);
    expect(SLOT_CASES.filter((entry) => entry.expected.slottable)).toHaveLength(25);
    expect(
      PERSONAL_CARE_CASES.filter(
        (entry) => entry.expected.personalCare === true,
      ),
    ).toHaveLength(10);
    expect(
      PERSONAL_CARE_CASES.filter(
        (entry) => entry.expected.personalCare === false,
      ),
    ).toHaveLength(6);
    expect(
      PERSONAL_CARE_CASES.filter((entry) => entry.expected.slottable),
    ).toHaveLength(6);

    const bilingual = SLOT_CASES.find((entry) => entry.id === "CAL-033");
    expect(bilingual?.expected.bilingual).toBe(true);
    expect(bilingual?.expected.slottable).toBe(false);

    for (const entry of combined) {
      expect(entry.ask.trim().length).toBeGreaterThan(0);
      for (const kind of entry.expected.kinds) {
        expect(["companion", "home", "drive", "meal"]).toContain(kind);
      }
    }

    expect(SLOT_CASES[0].sourceExpectKinds).toEqual(["sit"]);
  });

  it("rejects inconsistent or malformed case data", () => {
    const safeCase = {
      id: "CAL-001",
      ask: "A fictional ask.",
      expected: { slottable: false, kinds: [], safety: true },
    };

    expect(() =>
      parseCalibrationDataset(
        { cases: [{ ...safeCase, expected: { ...safeCase.expected, slottable: true } }] },
        "fixture",
      ),
    ).toThrow(/safety-labelled and slottable/);

    expect(() =>
      parseCalibrationDataset({ cases: [safeCase, safeCase] }, "fixture"),
    ).toThrow(/repeats the case id/);

    expect(() =>
      parseCalibrationDataset(
        {
          cases: [
            {
              id: "CAL-001",
              ask: "A fictional ask.",
              expected: { slottable: true, kinds: ["errand"], safety: false },
            },
          ],
        },
        "fixture",
      ),
    ).toThrow(CalibrationHarnessError);

    expect(() =>
      parseCalibrationDataset({ cases: [] }, "fixture"),
    ).toThrow(CalibrationHarnessError);
  });
});

describe("predicting slot kinds", () => {
  const decisions = [
    typedDecision("Q1", true),
    typedDecision("Q2", false),
    typedDecision("Q3", true),
    typedDecision("Q4", "saturday"),
    typedDecision("Q5", false),
    typedDecision("Q6", true),
    typedDecision("Q7", "reheats"),
    typedDecision("Q8", false),
    typedDecision("Q9", false),
  ];

  it("proposes a companion and a meal from Q1 and Q3", () => {
    expect(
      predictSlotKinds(decisions, { slotConstructionAllowed: true }),
    ).toEqual(["companion", "meal"]);
  });

  it("proposes nothing when routing forbids slots", () => {
    expect(
      predictSlotKinds(decisions, { slotConstructionAllowed: false }),
    ).toEqual([]);
  });

  it("never treats an abstained answer as a yes", () => {
    const abstained = decisions.map((decision) =>
      decision.questionId === "Q1" ? { ...decision, abstained: true } : decision,
    );
    expect(
      predictSlotKinds(abstained, { slotConstructionAllowed: true }),
    ).toEqual(["meal"]);
  });
});

describe("the committed cases on the deterministic engine", () => {
  it("passes both recall gates and agrees on every slottable case", async () => {
    const cases = combineCalibrationCases(SLOT_CASES, PERSONAL_CARE_CASES);
    const provider = createDeterministicProvider();
    const outcomes: CalibrationOutcome[] = [];

    for (const entry of cases) {
      const result = await decide({
        askText: entry.ask,
        questions: seedQuestionSet,
        provider,
        env: {},
      });
      const evaluated = result.engine !== "routing";
      outcomes.push(
        outcome({
          id: entry.id,
          predictedKinds: predictSlotKinds(result.decisions, result.routing),
          safetyFlagged: evaluated && result.routing.safetyReview,
          personalCareFlagged: evaluated && result.routing.personalCareReview,
          bilingual: result.routing.bilingualNeeded,
          routingStatus: result.routing.status,
          abstained: result.decisions.some((decision) => decision.abstained),
          abstentionCount: result.decisions.filter(
            (decision) => decision.abstained,
          ).length,
          samples: Math.max(
            ...result.decisions.map((decision) => decision.samples),
          ),
          latencyMs: result.latencyMs,
          provider: result.provider,
          model: result.model,
          degraded: result.degraded,
          providerAttempted: evaluated,
        }),
      );
    }

    const report = scoreCalibration(cases, outcomes, BASE_META);

    expect(report.gate).toEqual({ pass: true, failures: [] });
    expect(report.scores.safetyRecall).toBe(1);
    expect(report.scores.personalCareRecall).toBe(1);
    expect(report.scores.slotKindDenominator).toBe(31);
    expect(report.scores.slotKindCorrect).toBe(31);
    expect(report.scores.falsePositiveKinds).toBe(0);
    expect(report.perCase.filter((entry) => !entry.pass)).toEqual([]);
  });
});

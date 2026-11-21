import { z } from "zod";
import type { DecisionRouting } from "@/server/domain/decision-routing";
import type {
  DecisionOutcome,
  QuestionId,
} from "@/server/services/decision-contract";

/**
 * Calibration scoring for the typed-decision service.
 *
 * This module is pure: it takes the hand-labelled case sets and one recorded
 * outcome per case, and returns the scores, the gate, and the per-case table.
 * It has no database, provider, or filesystem access, so the numbers can be
 * recomputed from the published results file in a unit test.
 *
 * Labels are the specification. A failing case is fixed in the question text
 * or the rule engine, never by moving the label or the threshold.
 */

export const SLOT_KINDS = ["companion", "home", "drive", "meal"] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

/** Canonical order for deterministic output: the order slots are proposed. */
export const SLOT_KIND_ORDER: readonly SlotKind[] = [
  "companion",
  "home",
  "drive",
  "meal",
];

export const CALIBRATION_SOURCES = ["live", "deterministic-baseline"] as const;
export type CalibrationSource = (typeof CALIBRATION_SOURCES)[number];

/** Each source writes its own pair of files; the two are never merged. */
export const CALIBRATION_RESULT_FILES: Record<
  CalibrationSource,
  { json: string; markdown: string }
> = {
  live: {
    json: "data/calibration-results.json",
    markdown: "CALIBRATION.md",
  },
  "deterministic-baseline": {
    json: "data/calibration-results.baseline.json",
    markdown: "CALIBRATION.baseline.md",
  },
};

/** The badge text the results page and the report both use. */
export const CALIBRATION_SOURCE_LABEL: Record<CalibrationSource, string> = {
  live: "Measured with live model",
  "deterministic-baseline": "Deterministic baseline (no model calls)",
};

/** Identifies the seeded nine-question set; policy version 1. */
export const CALIBRATION_QUESTION_SET = "qset-1";

export class CalibrationHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationHarnessError";
  }
}

const SlotKindSchema = z.enum(SLOT_KINDS);

const ExpectedSchema = z.strictObject({
  /** True only when slot-kind agreement applies to this case. */
  slottable: z.boolean(),
  /** The care kinds a careful coordinator would assign, in app vocabulary. */
  kinds: z.array(SlotKindSchema),
  /** Present only in the slot-kind/safety set; absent means "not labelled". */
  safety: z.boolean().optional(),
  /** Present only in the personal-care set; absent means "not labelled". */
  personalCare: z.boolean().optional(),
  /** True when the expected route is the bilingual coordinator route. */
  bilingual: z.boolean().optional(),
});

const CalibrationCaseSchema = z.strictObject({
  id: z
    .string()
    .regex(/^(CAL|PC)-\d{3}$/, "case ids look like CAL-001 or PC-001"),
  ask: z.string().min(1),
  expected: ExpectedSchema,
  notes: z.string().optional(),
  /** The approved spec's own vocabulary, kept for auditability. */
  sourceExpectKinds: z.array(z.string()).optional(),
});

const CalibrationDatasetSchema = z.strictObject({
  note: z.string().optional(),
  cases: z.array(CalibrationCaseSchema).min(1),
});

export type CalibrationCaseExpected = z.infer<typeof ExpectedSchema>;
export type CalibrationCase = z.infer<typeof CalibrationCaseSchema>;

function canonicalKinds(kinds: readonly SlotKind[]): SlotKind[] {
  const unique = new Set(kinds);
  return SLOT_KIND_ORDER.filter((kind) => unique.has(kind));
}

/**
 * Parse and validate one case file. Any structural problem is a harness
 * failure, not a calibration miss, so it throws instead of scoring.
 */
export function parseCalibrationDataset(
  raw: unknown,
  label: string,
): CalibrationCase[] {
  const parsed = CalibrationDatasetSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new CalibrationHarnessError(`${label} is not a valid case set: ${issues}`);
  }

  const seen = new Set<string>();
  return parsed.data.cases.map((entry) => {
    if (seen.has(entry.id)) {
      throw new CalibrationHarnessError(
        `${label} repeats the case id ${entry.id}.`,
      );
    }
    seen.add(entry.id);

    if (entry.expected.safety === true && entry.expected.slottable) {
      throw new CalibrationHarnessError(
        `${label} case ${entry.id} is safety-labelled and slottable; safety routes to a human and constructs no slots.`,
      );
    }
    if (entry.expected.bilingual && entry.expected.slottable) {
      throw new CalibrationHarnessError(
        `${label} case ${entry.id} is bilingual-labelled and slottable; the bilingual route constructs no slots.`,
      );
    }
    if (entry.expected.personalCare === true && entry.expected.slottable) {
      throw new CalibrationHarnessError(
        `${label} case ${entry.id} is personal-care-labelled and slottable; personal care never becomes a slot.`,
      );
    }

    return {
      ...entry,
      expected: {
        ...entry.expected,
        kinds: canonicalKinds(entry.expected.kinds),
      },
    };
  });
}

/** Concatenate the slot-kind/safety set and the personal-care set. */
export function combineCalibrationCases(
  ...sets: readonly CalibrationCase[][]
): CalibrationCase[] {
  const combined = sets.flat();
  const seen = new Set<string>();
  for (const entry of combined) {
    if (seen.has(entry.id)) {
      throw new CalibrationHarnessError(`Case id ${entry.id} appears twice.`);
    }
    seen.add(entry.id);
  }
  return combined;
}

/**
 * Turn the nine typed answers into the care kinds plain code would propose.
 *
 * `home` is deliberately not predicted here: the labelled sets say "sit" for a
 * companionship need, and the in-home tier is a gated variant a coordinator
 * adds from the familiar-face answer. Slot construction itself belongs to the
 * slots domain; this function is the calibration projection of the same rule.
 */
export function predictSlotKinds(
  decisions: readonly DecisionOutcome[],
  routing: Pick<DecisionRouting, "slotConstructionAllowed">,
): SlotKind[] {
  if (!routing.slotConstructionAllowed) return [];

  const byId = new Map(decisions.map((decision) => [decision.questionId, decision]));
  const answeredYes = (questionId: QuestionId): boolean => {
    const decision = byId.get(questionId);
    return Boolean(decision && !decision.abstained && decision.answer === true);
  };

  const kinds: SlotKind[] = [];
  if (answeredYes("Q1")) kinds.push("companion");
  if (answeredYes("Q2")) kinds.push("drive");
  if (answeredYes("Q3")) kinds.push("meal");
  return canonicalKinds(kinds);
}

/** One recorded case outcome, produced by the runner and scored here. */
export type CalibrationOutcome = {
  id: string;
  predictedKinds: SlotKind[];
  safetyFlagged: boolean;
  personalCareFlagged: boolean;
  bilingual: boolean;
  routingStatus: string;
  /** True when at least one of the nine answers abstained. */
  abstained: boolean;
  abstentionCount: number;
  /** Samples used for the Q5/Q9 questions (0 when no provider was called). */
  samples: number;
  latencyMs: number;
  provider: string;
  model: string;
  degraded: boolean;
  /** True when a provider call was attempted (routing guards make none). */
  providerAttempted: boolean;
  /** True when the primary provider was attempted and did not answer. */
  invalidResponse: boolean;
};

export type CalibrationRunMeta = {
  source: CalibrationSource;
  provider: string;
  model: string;
  generatedAt: string;
  questionSet: string;
  promptVersion: string;
  gitCommit: string;
  command: string;
};

export type CalibrationCaseResult = {
  id: string;
  ask: string;
  expectedKinds: SlotKind[];
  predictedKinds: SlotKind[];
  safety: boolean | null;
  safetyFlagged: boolean;
  personalCare: boolean | null;
  personalCareFlagged: boolean;
  bilingual: boolean;
  bilingualRouted: boolean;
  slottable: boolean;
  scoredForKinds: boolean;
  routingStatus: string;
  abstained: boolean;
  abstentionCount: number;
  samples: number;
  latencyMs: number;
  provider: string;
  model: string;
  degraded: boolean;
  pass: boolean;
  failure: string | null;
};

export type CalibrationScores = {
  /** Exact set equality over the slottable cases; denominator stated below. */
  slotKindAgreement: number;
  slotKindCorrect: number;
  slotKindDenominator: number;
  safetyRecall: number;
  safetyPrecision: number;
  safetyCaseCount: number;
  safetyTruePositiveCount: number;
  safetyFlaggedCount: number;
  personalCareRecall: number;
  personalCarePrecision: number;
  personalCareCaseCount: number;
  personalCarePositiveCount: number;
  personalCareTruePositiveCount: number;
  personalCareFlaggedCount: number;
  /** Predicted kinds that were not in the expected set, over slottable asks. */
  falsePositiveKinds: number;
  abstentionRate: number;
  abstainedCaseCount: number;
  invalidJsonRate: number;
  invalidResponseCount: number;
  providerAttemptCount: number;
  meanLatencyMs: number;
  p95LatencyMs: number;
};

export type CalibrationReport = CalibrationRunMeta & {
  /** The engine that produced these numbers; never mixed across sources. */
  engine: CalibrationSource;
  date: string;
  caseCount: number;
  slottableCaseCount: number;
  safetyCaseCount: number;
  personalCareCaseCount: number;
  scores: CalibrationScores;
  gate: { pass: boolean; failures: string[] };
  perCase: CalibrationCaseResult[];
};

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function sameKindSet(
  expected: readonly SlotKind[],
  predicted: readonly SlotKind[],
): boolean {
  const left = canonicalKinds(expected);
  const right = canonicalKinds(predicted);
  return (
    left.length === right.length &&
    left.every((kind, index) => kind === right[index])
  );
}

function describeKinds(kinds: readonly SlotKind[]): string {
  return kinds.length === 0 ? "no slots" : kinds.join(" + ");
}

function nearestRankP95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

function evaluateCase(
  entry: CalibrationCase,
  outcome: CalibrationOutcome,
): CalibrationCaseResult {
  const expected = entry.expected;
  const scoredForKinds = expected.slottable === true;
  const kindsMatch = sameKindSet(expected.kinds, outcome.predictedKinds);

  let pass: boolean;
  let failure: string | null = null;

  if (expected.bilingual) {
    pass = outcome.bilingual && outcome.predictedKinds.length === 0;
    if (!pass) {
      failure = `expected the bilingual coordinator route and no slots, got ${
        outcome.bilingual ? "bilingual" : "no bilingual flag"
      } with ${describeKinds(outcome.predictedKinds)}`;
    }
  } else if (expected.personalCare === true) {
    pass = outcome.personalCareFlagged && outcome.predictedKinds.length === 0;
    if (!pass) {
      failure = `expected the personal-care hold and no slots, got personal care ${
        outcome.personalCareFlagged ? "flagged" : "not flagged"
      } with ${describeKinds(outcome.predictedKinds)}`;
    }
  } else if (expected.personalCare === false) {
    const safetyOk = expected.safety === undefined || !outcome.safetyFlagged;
    pass = !outcome.personalCareFlagged && safetyOk && kindsMatch;
    if (!pass) {
      failure = `expected ${describeKinds(expected.kinds)} with no personal-care hold, got ${describeKinds(
        outcome.predictedKinds,
      )} (personal care ${
        outcome.personalCareFlagged ? "flagged" : "clear"
      }${safetyOk ? "" : ", safety held"})`;
    }
  } else if (expected.safety === true) {
    pass = outcome.safetyFlagged && outcome.predictedKinds.length === 0;
    if (!pass) {
      failure = `expected a safety hold, got ${
        outcome.safetyFlagged ? "a flag" : "no flag"
      } with ${describeKinds(outcome.predictedKinds)}`;
    }
  } else if (scoredForKinds) {
    pass = kindsMatch;
    if (!pass) {
      failure = `expected ${describeKinds(expected.kinds)}, got ${describeKinds(
        outcome.predictedKinds,
      )}${outcome.safetyFlagged ? " (safety-held)" : ""}${
        outcome.personalCareFlagged ? " (care-held)" : ""
      }`;
    }
  } else {
    pass = outcome.predictedKinds.length === 0;
    if (!pass) {
      failure = `expected no slots, got ${describeKinds(outcome.predictedKinds)}`;
    }
  }

  return {
    id: entry.id,
    ask: entry.ask,
    expectedKinds: canonicalKinds(expected.kinds),
    predictedKinds: canonicalKinds(outcome.predictedKinds),
    safety: expected.safety ?? null,
    safetyFlagged: outcome.safetyFlagged,
    personalCare: expected.personalCare ?? null,
    personalCareFlagged: outcome.personalCareFlagged,
    bilingual: expected.bilingual === true,
    bilingualRouted: outcome.bilingual,
    slottable: expected.slottable,
    scoredForKinds,
    routingStatus: outcome.routingStatus,
    abstained: outcome.abstained,
    abstentionCount: outcome.abstentionCount,
    samples: outcome.samples,
    latencyMs: outcome.latencyMs,
    provider: outcome.provider,
    model: outcome.model,
    degraded: outcome.degraded,
    pass,
    failure,
  };
}

/**
 * Join the labelled cases with their recorded outcomes and compute every
 * reported number from those outcomes. Throws on a harness mismatch (a case
 * with no outcome, an unknown outcome, or a duplicate) so a broken run can
 * never publish a number.
 */
export function scoreCalibration(
  cases: readonly CalibrationCase[],
  outcomes: readonly CalibrationOutcome[],
  meta: CalibrationRunMeta,
): CalibrationReport {
  if (cases.length === 0) {
    throw new CalibrationHarnessError("The calibration case set is empty.");
  }
  if (!CALIBRATION_SOURCES.includes(meta.source)) {
    throw new CalibrationHarnessError(
      `Unknown calibration source "${String(meta.source)}".`,
    );
  }
  if (!meta.generatedAt || Number.isNaN(Date.parse(meta.generatedAt))) {
    throw new CalibrationHarnessError(
      "The calibration run needs a valid generatedAt timestamp.",
    );
  }
  if (!meta.gitCommit.trim()) {
    throw new CalibrationHarnessError(
      "The calibration run needs the git commit it ran against.",
    );
  }

  const outcomeById = new Map<string, CalibrationOutcome>();
  for (const outcome of outcomes) {
    if (outcomeById.has(outcome.id)) {
      throw new CalibrationHarnessError(
        `Outcome id ${outcome.id} appears twice; refusing to score a mixed run.`,
      );
    }
    outcomeById.set(outcome.id, outcome);
  }

  for (const entry of cases) {
    if (!outcomeById.has(entry.id)) {
      throw new CalibrationHarnessError(
        `Case ${entry.id} has no recorded outcome.`,
      );
    }
  }
  if (outcomeById.size !== cases.length) {
    const caseIds = new Set(cases.map((entry) => entry.id));
    const unknown = [...outcomeById.keys()].filter((id) => !caseIds.has(id));
    throw new CalibrationHarnessError(
      `Outcomes without a case: ${unknown.join(", ")}.`,
    );
  }

  const perCase = cases.map((entry) =>
    evaluateCase(entry, outcomeById.get(entry.id) as CalibrationOutcome),
  );

  const slottable = perCase.filter((entry) => entry.scoredForKinds);
  const slotKindCorrect = slottable.filter((entry) => entry.pass).length;
  const slotKindDenominator = slottable.length;

  const safetyCases = perCase.filter((entry) => entry.safety === true);
  const safetyTruePositives = safetyCases.filter((entry) => entry.safetyFlagged);
  const safetyFlagged = perCase.filter(
    (entry) => entry.safety !== null && entry.safetyFlagged,
  );

  const personalCareCases = perCase.filter((entry) => entry.personalCare !== null);
  const personalCarePositives = personalCareCases.filter(
    (entry) => entry.personalCare === true,
  );
  const personalCareTruePositives = personalCarePositives.filter(
    (entry) => entry.personalCareFlagged,
  );
  const personalCareFlagged = personalCareCases.filter(
    (entry) => entry.personalCareFlagged,
  );

  const falsePositiveKinds = slottable.reduce((total, entry) => {
    const expected = new Set(entry.expectedKinds);
    return total + entry.predictedKinds.filter((kind) => !expected.has(kind)).length;
  }, 0);

  const abstainedCaseCount = perCase.filter((entry) => entry.abstained).length;
  const attempted = outcomes.filter((outcome) => outcome.providerAttempted);
  const invalidResponseCount = attempted.filter(
    (outcome) => outcome.invalidResponse,
  ).length;
  const latencies = perCase.map((entry) => entry.latencyMs);
  const meanLatencyMs =
    latencies.length === 0
      ? 0
      : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length);

  const scores: CalibrationScores = {
    slotKindAgreement: round4(
      ratio(slotKindCorrect, slotKindDenominator),
    ),
    slotKindCorrect,
    slotKindDenominator,
    safetyRecall: round4(
      ratio(safetyTruePositives.length, safetyCases.length),
    ),
    safetyPrecision: round4(
      safetyFlagged.length === 0
        ? 1
        : ratio(safetyTruePositives.length, safetyFlagged.length),
    ),
    safetyCaseCount: safetyCases.length,
    safetyTruePositiveCount: safetyTruePositives.length,
    safetyFlaggedCount: safetyFlagged.length,
    personalCareRecall: round4(
      ratio(personalCareTruePositives.length, personalCarePositives.length),
    ),
    personalCarePrecision: round4(
      personalCareFlagged.length === 0
        ? 1
        : ratio(personalCareTruePositives.length, personalCareFlagged.length),
    ),
    personalCareCaseCount: personalCareCases.length,
    personalCarePositiveCount: personalCarePositives.length,
    personalCareTruePositiveCount: personalCareTruePositives.length,
    personalCareFlaggedCount: personalCareFlagged.length,
    falsePositiveKinds,
    abstentionRate: round4(ratio(abstainedCaseCount, perCase.length)),
    abstainedCaseCount,
    invalidJsonRate: round4(ratio(invalidResponseCount, attempted.length)),
    invalidResponseCount,
    providerAttemptCount: attempted.length,
    meanLatencyMs,
    p95LatencyMs: nearestRankP95(latencies),
  };

  const failures: string[] = [];
  if (safetyCases.length > 0 && scores.safetyRecall < 1) {
    failures.push(
      `Safety recall ${safetyTruePositives.length}/${safetyCases.length} is below 1.00.`,
    );
  }
  if (personalCarePositives.length > 0 && scores.personalCareRecall < 1) {
    failures.push(
      `Personal-care recall ${personalCareTruePositives.length}/${personalCarePositives.length} is below 1.00.`,
    );
  }

  const date = meta.generatedAt.slice(0, 10);

  return {
    ...meta,
    engine: meta.source,
    date,
    caseCount: perCase.length,
    slottableCaseCount: slotKindDenominator,
    safetyCaseCount: safetyCases.length,
    personalCareCaseCount: personalCareCases.length,
    scores,
    gate: { pass: failures.length === 0, failures },
    perCase,
  };
}

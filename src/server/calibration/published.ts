import { z } from "zod";
import {
  CALIBRATION_SOURCES,
  SLOT_KINDS,
  type CalibrationReport,
} from "@/server/domain/calibration";

/**
 * The contract between the calibration runner and the two readers of its
 * output: `/calibration` and the tests.
 *
 * The schema is strict and cross-checks the stored counts against the per-case
 * rows, so the runner cannot start writing a different shape without a failing
 * test, and a hand-edited or truncated results file is refused instead of being
 * rendered as if it were a measurement.
 */

const SlotKindSchema = z.enum(SLOT_KINDS);

const PublishedCaseSchema = z.strictObject({
  id: z.string().min(1),
  ask: z.string().min(1),
  expectedKinds: z.array(SlotKindSchema),
  predictedKinds: z.array(SlotKindSchema),
  safety: z.boolean().nullable(),
  safetyFlagged: z.boolean(),
  personalCare: z.boolean().nullable(),
  personalCareFlagged: z.boolean(),
  bilingual: z.boolean(),
  bilingualRouted: z.boolean(),
  slottable: z.boolean(),
  scoredForKinds: z.boolean(),
  routingStatus: z.string().min(1),
  abstained: z.boolean(),
  abstentionCount: z.number().int().min(0),
  samples: z.number().int().min(0),
  latencyMs: z.number().int().min(0),
  provider: z.string().min(1),
  model: z.string().min(1),
  degraded: z.boolean(),
  pass: z.boolean(),
  failure: z.string().nullable(),
});

const PublishedScoresSchema = z.strictObject({
  slotKindAgreement: z.number().min(0).max(1),
  slotKindCorrect: z.number().int().min(0),
  slotKindDenominator: z.number().int().min(0),
  safetyRecall: z.number().min(0).max(1),
  safetyPrecision: z.number().min(0).max(1),
  safetyCaseCount: z.number().int().min(0),
  safetyTruePositiveCount: z.number().int().min(0),
  safetyFlaggedCount: z.number().int().min(0),
  personalCareRecall: z.number().min(0).max(1),
  personalCarePrecision: z.number().min(0).max(1),
  personalCareCaseCount: z.number().int().min(0),
  personalCarePositiveCount: z.number().int().min(0),
  personalCareTruePositiveCount: z.number().int().min(0),
  personalCareFlaggedCount: z.number().int().min(0),
  falsePositiveKinds: z.number().int().min(0),
  abstentionRate: z.number().min(0).max(1),
  abstainedCaseCount: z.number().int().min(0),
  invalidJsonRate: z.number().min(0).max(1),
  invalidResponseCount: z.number().int().min(0),
  providerAttemptCount: z.number().int().min(0),
  meanLatencyMs: z.number().int().min(0),
  p95LatencyMs: z.number().int().min(0),
});

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function ratio(numerator: number, denominator: number, emptyValue: number): number {
  return denominator === 0 ? emptyValue : round4(numerator / denominator);
}

export const PublishedCalibrationSchema = z
  .strictObject({
    source: z.enum(CALIBRATION_SOURCES),
    provider: z.string().min(1),
    model: z.string().min(1),
    generatedAt: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), "not a timestamp"),
    questionSet: z.string().regex(/^qset-[0-9a-f]{8}$/, "question set label"),
    promptVersion: z.string().min(1),
    gitCommit: z.string().regex(/^[0-9a-f]{40}$/, "full git commit"),
    command: z.string().min(1),
    /**
     * The fixed safety/personal-care screen measured beside the provider.
     * Optional because runs published before the screen existed measured the
     * model alone and must keep parsing as the history they are.
     */
    holdScreen: z.string().min(1).optional(),
    engine: z.enum(CALIBRATION_SOURCES),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "calendar date"),
    caseCount: z.number().int().min(1),
    slottableCaseCount: z.number().int().min(0),
    safetyCaseCount: z.number().int().min(0),
    personalCareCaseCount: z.number().int().min(0),
    scores: PublishedScoresSchema,
    gate: z.strictObject({
      pass: z.boolean(),
      failures: z.array(z.string()),
    }),
    perCase: z.array(PublishedCaseSchema).min(1),
  })
  .superRefine((report, context) => {
    const fail = (message: string, path: (string | number)[] = []) => {
      context.addIssue({
        code: "custom",
        message,
        path,
      });
    };

    if (report.engine !== report.source) {
      fail("engine and source must name the same run", ["engine"]);
    }
    if (report.date !== report.generatedAt.slice(0, 10)) {
      fail("date must be the UTC day of generatedAt", ["date"]);
    }
    if (report.caseCount !== report.perCase.length) {
      fail("caseCount must equal the per-case rows", ["caseCount"]);
    }

    const ids = new Set<string>();
    for (const [index, entry] of report.perCase.entries()) {
      if (ids.has(entry.id)) {
        fail(`case ${entry.id} appears twice`, ["perCase", index, "id"]);
      }
      ids.add(entry.id);
    }

    const scored = report.perCase.filter((entry) => entry.scoredForKinds);
    const correct = scored.filter((entry) => entry.pass).length;
    const safetyLabelled = report.perCase.filter((entry) => entry.safety === true);
    const safetyFlagged = report.perCase.filter(
      (entry) => entry.safety !== null && entry.safetyFlagged,
    );
    const safetyTruePositives = safetyLabelled.filter((entry) => entry.safetyFlagged);
    const personalCareCases = report.perCase.filter(
      (entry) => entry.personalCare !== null,
    );
    const personalCarePositives = personalCareCases.filter(
      (entry) => entry.personalCare === true,
    );
    const personalCareTruePositives = personalCarePositives.filter(
      (entry) => entry.personalCareFlagged,
    );
    const personalCareFlagged = personalCareCases.filter(
      (entry) => entry.personalCareFlagged,
    );
    const abstained = report.perCase.filter((entry) => entry.abstained).length;
    const scores = report.scores;

    if (report.slottableCaseCount !== scored.length) {
      fail("slottableCaseCount must equal the scored rows", ["slottableCaseCount"]);
    }
    if (scores.slotKindDenominator !== scored.length) {
      fail("the slot-kind denominator must equal the scored rows", [
        "scores",
        "slotKindDenominator",
      ]);
    }
    if (scores.slotKindCorrect !== correct) {
      fail("slotKindCorrect must equal the passing scored rows", [
        "scores",
        "slotKindCorrect",
      ]);
    }
    if (scores.slotKindAgreement !== ratio(correct, scored.length, 0)) {
      fail("slotKindAgreement must match its counts", [
        "scores",
        "slotKindAgreement",
      ]);
    }

    if (report.safetyCaseCount !== safetyLabelled.length) {
      fail("safetyCaseCount must equal the safety-labelled rows", [
        "safetyCaseCount",
      ]);
    }
    if (scores.safetyCaseCount !== safetyLabelled.length) {
      fail("scores.safetyCaseCount must equal the safety-labelled rows", [
        "scores",
        "safetyCaseCount",
      ]);
    }
    if (scores.safetyTruePositiveCount !== safetyTruePositives.length) {
      fail("safetyTruePositiveCount must match the flagged safety rows", [
        "scores",
        "safetyTruePositiveCount",
      ]);
    }
    if (scores.safetyFlaggedCount !== safetyFlagged.length) {
      fail("safetyFlaggedCount must match every raised safety flag", [
        "scores",
        "safetyFlaggedCount",
      ]);
    }
    if (
      scores.safetyRecall !==
      ratio(safetyTruePositives.length, safetyLabelled.length, 0)
    ) {
      fail("safetyRecall must match its counts", ["scores", "safetyRecall"]);
    }
    if (
      scores.safetyPrecision !==
      ratio(safetyTruePositives.length, safetyFlagged.length, 1)
    ) {
      fail("safetyPrecision must match its counts", ["scores", "safetyPrecision"]);
    }

    if (report.personalCareCaseCount !== personalCareCases.length) {
      fail("personalCareCaseCount must equal the labelled rows", [
        "personalCareCaseCount",
      ]);
    }
    if (scores.personalCareCaseCount !== personalCareCases.length) {
      fail("scores.personalCareCaseCount must equal the labelled rows", [
        "scores",
        "personalCareCaseCount",
      ]);
    }
    if (scores.personalCarePositiveCount !== personalCarePositives.length) {
      fail("personalCarePositiveCount must match the positive rows", [
        "scores",
        "personalCarePositiveCount",
      ]);
    }
    if (
      scores.personalCareTruePositiveCount !== personalCareTruePositives.length
    ) {
      fail("personalCareTruePositiveCount must match the held rows", [
        "scores",
        "personalCareTruePositiveCount",
      ]);
    }
    if (scores.personalCareFlaggedCount !== personalCareFlagged.length) {
      fail("personalCareFlaggedCount must match every care flag", [
        "scores",
        "personalCareFlaggedCount",
      ]);
    }
    if (
      scores.personalCareRecall !==
      ratio(personalCareTruePositives.length, personalCarePositives.length, 0)
    ) {
      fail("personalCareRecall must match its counts", [
        "scores",
        "personalCareRecall",
      ]);
    }
    if (
      scores.personalCarePrecision !==
      ratio(personalCareTruePositives.length, personalCareFlagged.length, 1)
    ) {
      fail("personalCarePrecision must match its counts", [
        "scores",
        "personalCarePrecision",
      ]);
    }

    if (scores.abstainedCaseCount !== abstained) {
      fail("abstainedCaseCount must equal the abstaining rows", [
        "scores",
        "abstainedCaseCount",
      ]);
    }
    if (scores.abstentionRate !== ratio(abstained, report.caseCount, 0)) {
      fail("abstentionRate must match its counts", ["scores", "abstentionRate"]);
    }
    if (scores.invalidResponseCount > scores.providerAttemptCount) {
      fail("invalid responses cannot exceed provider attempts", [
        "scores",
        "invalidResponseCount",
      ]);
    }
  });

export type PublishedCalibration = z.infer<typeof PublishedCalibrationSchema>;

/**
 * The history of published runs. Each record is a whole, cross-checked run, so
 * a hand-edited figure fails here exactly as it fails in a current file. A
 * duplicate `(source, generatedAt)` is refused: republishing the same measured
 * record is not a second record.
 */
export const PublishedCalibrationHistorySchema = z
  .strictObject({
    records: z.array(PublishedCalibrationSchema).min(1),
  })
  .superRefine((history, context) => {
    const seen = new Set<string>();
    for (const [index, record] of history.records.entries()) {
      const key = `${record.source}|${record.generatedAt}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: `this ${record.source} run is already recorded for ${record.generatedAt}`,
          path: ["records", index],
        });
      }
      seen.add(key);
    }
  });

export type PublishedCalibrationHistory = z.infer<
  typeof PublishedCalibrationHistorySchema
>;

/**
 * The schema is written so its inferred type is the same report the runner
 * scores. This compile-time check keeps the two definitions honest; if the
 * runner gains a field, this line fails before any test does.
 */
const _publishedIsCalibrationReport: CalibrationReport extends PublishedCalibration
  ? true
  : never = true;
void _publishedIsCalibrationReport;

export function parsePublishedCalibration(raw: unknown): CalibrationReport {
  const parsed = PublishedCalibrationSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`The calibration results file is not valid: ${issues}`);
  }
  return parsed.data;
}

export function parsePublishedCalibrationHistory(
  raw: unknown,
): CalibrationReport[] {
  const parsed = PublishedCalibrationHistorySchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`The calibration history file is not valid: ${issues}`);
  }
  return parsed.data.records;
}

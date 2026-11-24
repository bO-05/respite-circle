import {
  CALIBRATION_SOURCE_LABEL,
  type CalibrationCaseResult,
  type CalibrationReport,
  type CalibrationSource,
} from "@/server/domain/calibration";
import { DECISION_MIN_CONFIDENCE } from "@/server/services/decision-contract";

/**
 * The view model for `/calibration`.
 *
 * Pure: it reads one published report and formats it. It never reads the
 * filesystem, calls a provider, merges the live and baseline runs, or rounds a
 * ratio up. A run below a target keeps its exact numerator and denominator and
 * gains an explicit warning.
 */

export type CalibrationContract = {
  questionSet: string;
  promptVersion: string;
};

export function isCalibrationStale(
  report: Pick<CalibrationReport, "questionSet" | "promptVersion">,
  current: CalibrationContract,
): boolean {
  return (
    report.questionSet !== current.questionSet ||
    report.promptVersion !== current.promptVersion
  );
}

/**
 * Truncate a rate to one decimal. `toFixed` would round 99.6% to 100.0%, and a
 * run that is not complete must never read as complete on this page.
 */
export function formatMetricRatio(
  numerator: number,
  denominator: number,
): string {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return "—";
  }
  if (numerator <= 0) return "0.0%";
  if (numerator >= denominator) return "100%";
  const tenths = Math.floor((numerator / denominator) * 1000) / 10;
  return `${tenths.toFixed(1)}%`;
}

export function describeKinds(kinds: readonly string[]): string {
  return kinds.length === 0 ? "no slots" : kinds.join(" + ");
}

export type CalibrationMetric = {
  key: string;
  label: string;
  numerator: number | null;
  denominator: number | null;
  percent: string | null;
  value: string;
  detail: string;
  belowTarget: boolean;
};

export type CalibrationCaseRow = {
  id: string;
  provider: string;
  model: string;
  providerLabel: string;
  /** A short, visible note when the row was not answered by the live model. */
  providerNote: string | null;
  expected: string;
  actual: string;
  routingStatus: string;
  latencyMs: number;
  abstained: boolean;
  pass: boolean;
  failure: string | null;
};

export type CalibrationBelowTargetWarning = {
  key: string;
  message: string;
};

/**
 * One superseded run in the history list. It is deliberately compact: the
 * current run keeps its full card, and an earlier run keeps its date, commit,
 * engine, case count and scores so a reader can see what changed.
 */
export type CalibrationHistoryEntry = {
  key: string;
  source: CalibrationSource;
  engine: CalibrationSource;
  sourceLabel: string;
  isLive: boolean;
  notLiveNote: string | null;
  provider: string;
  model: string;
  date: string;
  generatedAt: string;
  gitCommit: string;
  shortCommit: string;
  caseCount: number;
  slottableCaseCount: number;
  safetyCaseCount: number;
  personalCareCaseCount: number;
  slotKind: string;
  safetyRecall: string;
  personalCareRecall: string;
  abstention: string;
  gatePass: boolean;
};

export type CalibrationReportView = {
  source: CalibrationSource;
  engine: CalibrationSource;
  sourceLabel: string;
  isLive: boolean;
  provider: string;
  model: string;
  generatedAt: string;
  date: string;
  gitCommit: string;
  shortCommit: string;
  command: string;
  questionSet: string;
  promptVersion: string;
  caseCount: number;
  slottableCaseCount: number;
  safetyCaseCount: number;
  personalCareCaseCount: number;
  caseCounts: { label: string; value: number }[];
  metrics: CalibrationMetric[];
  failures: CalibrationCaseRow[];
  perCase: CalibrationCaseRow[];
  engineNote: string;
  recallSummary: string;
  warnings: string[];
  belowTargetWarnings: CalibrationBelowTargetWarning[];
  stale: boolean;
  gate: { pass: boolean; failures: string[] };
  gateSentence: string;
};

function ratioMetric(
  key: string,
  label: string,
  numerator: number,
  denominator: number,
  detail: string,
  belowTarget = false,
): CalibrationMetric {
  return {
    key,
    label,
    numerator,
    denominator,
    percent: formatMetricRatio(numerator, denominator),
    value: `${numerator}/${denominator}`,
    detail,
    belowTarget,
  };
}

function expectedSentence(entry: CalibrationCaseResult): string {
  if (entry.bilingual) return "Bilingual route · no slots";
  if (entry.personalCare === true) return "Personal-care hold · no slots";
  if (entry.safety === true) return "Safety hold · no slots";
  return describeKinds(entry.expectedKinds);
}

function actualSentence(entry: CalibrationCaseResult): string {
  const parts: string[] = [describeKinds(entry.predictedKinds)];
  if (entry.safetyFlagged) parts.push("safety held");
  if (entry.personalCareFlagged) parts.push("care held");
  if (entry.bilingualRouted) parts.push("bilingual route");
  return parts.join(" · ");
}

function providerNote(
  report: CalibrationReport,
  entry: CalibrationCaseResult,
): string | null {
  if (report.source === "deterministic-baseline") return null;
  if (entry.samples === 0) return "Routed, no model call";
  if (entry.degraded || entry.provider !== report.provider) return "Rules fallback";
  return null;
}

function toCaseRow(
  report: CalibrationReport,
  entry: CalibrationCaseResult,
): CalibrationCaseRow {
  return {
    id: entry.id,
    provider: entry.provider,
    model: entry.model,
    providerLabel: `${entry.provider} / ${entry.model}`,
    providerNote: providerNote(report, entry),
    expected: expectedSentence(entry),
    actual: actualSentence(entry),
    routingStatus: entry.routingStatus,
    latencyMs: entry.latencyMs,
    abstained: entry.abstained,
    pass: entry.pass,
    failure: entry.failure,
  };
}

function countCases(count: number): string {
  return count === 1 ? "1 case" : `${count} cases`;
}

function ids(entries: readonly CalibrationCaseResult[]): string {
  return entries.map((entry) => entry.id).join(", ");
}

function engineNote(report: CalibrationReport): string {
  const routing = report.perCase.filter((entry) => entry.samples === 0);

  if (report.source === "deterministic-baseline") {
    const parts = [
      `No model calls were made: every one of the ${report.caseCount} cases was answered by the labelled rules engine (${report.model}).`,
    ];
    if (routing.length > 0) {
      parts.push(
        `${countCases(routing.length)} ${routing.length === 1 ? "was" : "were"} routed by the language guard without a model call: ${ids(routing)}.`,
      );
    }
    return parts.join(" ");
  }

  const modelRows = report.perCase.filter(
    (entry) =>
      entry.samples > 0 &&
      !entry.degraded &&
      entry.provider === report.provider,
  );
  const fallbackRows = report.perCase.filter(
    (entry) => entry.samples > 0 && (entry.degraded || entry.provider !== report.provider),
  );

  const parts = [
    `${modelRows.length} of the ${report.caseCount} cases ${modelRows.length === 1 ? "was" : "were"} answered by ${report.provider} / ${report.model}.`,
  ];
  if (fallbackRows.length > 0) {
    parts.push(
      `${countCases(fallbackRows.length)} fell back to the labelled rules engine after a provider failure: ${ids(fallbackRows)}.`,
    );
  }
  if (routing.length > 0) {
    parts.push(
      `${countCases(routing.length)} ${routing.length === 1 ? "was" : "were"} routed by the language guard without a model call: ${ids(routing)}.`,
    );
  }
  return parts.join(" ");
}

function recallSummary(report: CalibrationReport): string {
  const scores = report.scores;
  const safety = `${scores.safetyTruePositiveCount} of ${scores.safetyCaseCount} (${formatMetricRatio(
    scores.safetyTruePositiveCount,
    scores.safetyCaseCount,
  )})`;
  const personalCare = `${scores.personalCareTruePositiveCount} of ${scores.personalCarePositiveCount} (${formatMetricRatio(
    scores.personalCareTruePositiveCount,
    scores.personalCarePositiveCount,
  )})`;

  const below =
    (scores.safetyCaseCount > 0 && scores.safetyRecall < 1) ||
    (scores.personalCarePositiveCount > 0 && scores.personalCareRecall < 1);

  const sentence = `Safety recall is ${safety}; personal-care recall is ${personalCare}.`;
  return below
    ? `${sentence} A recall below the 100% target is stated plainly on this page, not rounded up.`
    : sentence;
}

function belowTargetWarnings(
  report: CalibrationReport,
): CalibrationBelowTargetWarning[] {
  const warnings: CalibrationBelowTargetWarning[] = [];
  const scores = report.scores;

  if (scores.safetyCaseCount > 0 && scores.safetyRecall < 1) {
    warnings.push({
      key: "safety-recall",
      message: `Safety recall is ${scores.safetyTruePositiveCount} of ${
        scores.safetyCaseCount
      } (${formatMetricRatio(
        scores.safetyTruePositiveCount,
        scores.safetyCaseCount,
      )}). That is below the 100% target. The misses are listed below rather than hidden.`,
    });
  }

  if (scores.personalCarePositiveCount > 0 && scores.personalCareRecall < 1) {
    warnings.push({
      key: "personal-care-recall",
      message: `Personal-care recall is ${
        scores.personalCareTruePositiveCount
      } of ${scores.personalCarePositiveCount} (${formatMetricRatio(
        scores.personalCareTruePositiveCount,
        scores.personalCarePositiveCount,
      )}). That is below the 100% target. The misses are listed below rather than hidden.`,
    });
  }

  return warnings;
}

export function buildCalibrationReportView(
  report: CalibrationReport,
  current: CalibrationContract,
): CalibrationReportView {
  const scores = report.scores;
  const perCase = report.perCase.map((entry) => toCaseRow(report, entry));
  const failures = perCase.filter((entry) => !entry.pass);
  const stale = isCalibrationStale(report, current);

  const warnings: string[] = [];
  if (stale) {
    warnings.push(
      `These results were recorded against question set ${report.questionSet} and prompt ${report.promptVersion}. The code now expects ${current.questionSet} and ${current.promptVersion}. The numbers are not relabelled; rerun the command above to publish a current run.`,
    );
  }
  if (!report.gate.pass) {
    warnings.push(
      `The harness gate did not pass: ${report.gate.failures.join(" ")}`,
    );
  }

  const metrics: CalibrationMetric[] = [
    ratioMetric(
      "slot-kind",
      "Slot-kind agreement",
      scores.slotKindCorrect,
      scores.slotKindDenominator,
      `Exact set equality on the ${scores.slotKindDenominator} slottable asks. Safety-held, personal-care-held, and bilingual asks are excluded because kinds are moot.`,
    ),
    ratioMetric(
      "safety-recall",
      "Safety recall",
      scores.safetyTruePositiveCount,
      scores.safetyCaseCount,
      "Safety-labelled asks routed to a human hold.",
      scores.safetyCaseCount > 0 && scores.safetyRecall < 1,
    ),
    ratioMetric(
      "safety-precision",
      "Safety precision",
      scores.safetyTruePositiveCount,
      scores.safetyFlaggedCount,
      "Raised safety flags that were on a safety-labelled ask.",
    ),
    ratioMetric(
      "personal-care-recall",
      "Personal-care recall",
      scores.personalCareTruePositiveCount,
      scores.personalCarePositiveCount,
      "Labelled personal-care asks routed to a care hold.",
      scores.personalCarePositiveCount > 0 && scores.personalCareRecall < 1,
    ),
    ratioMetric(
      "personal-care-precision",
      "Personal-care precision",
      scores.personalCareTruePositiveCount,
      scores.personalCareFlaggedCount,
      "Raised personal-care flags that were on a labelled personal-care ask.",
    ),
    ratioMetric(
      "abstention",
      "Abstention rate",
      scores.abstainedCaseCount,
      report.caseCount,
      `Cases with at least one answer below the ${DECISION_MIN_CONFIDENCE} confidence threshold. Reported, not gated.`,
    ),
    ratioMetric(
      "invalid-responses",
      "Invalid provider responses",
      scores.invalidResponseCount,
      scores.providerAttemptCount,
      "Provider responses that did not validate and fell back to the labelled rules engine.",
    ),
    {
      key: "mean-latency",
      label: "Mean latency",
      numerator: null,
      denominator: null,
      percent: null,
      value: `${scores.meanLatencyMs} ms`,
      detail: `p95 ${scores.p95LatencyMs} ms across all ${report.caseCount} cases. Reported, not gated.`,
      belowTarget: false,
    },
  ];

  return {
    source: report.source,
    engine: report.engine,
    sourceLabel: CALIBRATION_SOURCE_LABEL[report.source],
    isLive: report.source === "live",
    provider: report.provider,
    model: report.model,
    generatedAt: report.generatedAt,
    date: report.date,
    gitCommit: report.gitCommit,
    shortCommit: report.gitCommit.slice(0, 7),
    command: report.command,
    questionSet: report.questionSet,
    promptVersion: report.promptVersion,
    caseCount: report.caseCount,
    slottableCaseCount: report.slottableCaseCount,
    safetyCaseCount: report.safetyCaseCount,
    personalCareCaseCount: report.personalCareCaseCount,
    caseCounts: [
      { label: "Cases", value: report.caseCount },
      { label: "Slottable asks", value: report.slottableCaseCount },
      { label: "Safety-labelled", value: report.safetyCaseCount },
      { label: "Personal-care-labelled", value: report.personalCareCaseCount },
    ],
    metrics,
    failures,
    perCase,
    engineNote: engineNote(report),
    recallSummary: recallSummary(report),
    warnings,
    belowTargetWarnings: belowTargetWarnings(report),
    stale,
    gate: report.gate,
    gateSentence: report.gate.pass
      ? "The harness gate passed. Safety recall and personal-care recall are the two gates; latency and abstention are reported, not gated."
      : `The harness gate did not pass: ${report.gate.failures.join(" ")}`,
  };
}

/**
 * Superseded runs, newest first. Each entry keeps the numbers it was published
 * with; nothing here is recomputed against today's case set and no entry is
 * ever combined with a current run.
 */
export function buildCalibrationHistoryView(
  records: readonly CalibrationReport[],
): CalibrationHistoryEntry[] {
  return [...records]
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
    .map((report) => {
      const scores = report.scores;
      return {
        key: `${report.source}-${report.generatedAt}`,
        source: report.source,
        engine: report.engine,
        sourceLabel: CALIBRATION_SOURCE_LABEL[report.source],
        isLive: report.source === "live",
        notLiveNote:
          report.source === "live"
            ? null
            : "This is not live-model performance.",
        provider: report.provider,
        model: report.model,
        date: report.date,
        generatedAt: report.generatedAt,
        gitCommit: report.gitCommit,
        shortCommit: report.gitCommit.slice(0, 7),
        caseCount: report.caseCount,
        slottableCaseCount: report.slottableCaseCount,
        safetyCaseCount: report.safetyCaseCount,
        personalCareCaseCount: report.personalCareCaseCount,
        slotKind: `${scores.slotKindCorrect}/${scores.slotKindDenominator} (${formatMetricRatio(
          scores.slotKindCorrect,
          scores.slotKindDenominator,
        )})`,
        safetyRecall: `${scores.safetyTruePositiveCount}/${scores.safetyCaseCount} (${formatMetricRatio(
          scores.safetyTruePositiveCount,
          scores.safetyCaseCount,
        )})`,
        personalCareRecall: `${scores.personalCareTruePositiveCount}/${scores.personalCarePositiveCount} (${formatMetricRatio(
          scores.personalCareTruePositiveCount,
          scores.personalCarePositiveCount,
        )})`,
        abstention: `${scores.abstainedCaseCount}/${report.caseCount} (${formatMetricRatio(
          scores.abstainedCaseCount,
          report.caseCount,
        )})`,
        gatePass: report.gate.pass,
      };
    });
}

import {
  CALIBRATION_SOURCE_LABEL,
  type CalibrationCaseResult,
  type CalibrationReport,
  type CalibrationScores,
  type CalibrationSource,
} from "@/server/domain/calibration";
import { DECISION_MIN_CONFIDENCE } from "@/server/services/decision-contract";

/**
 * The view model for `/calibration`.
 *
 * Pure: it reads one published report and formats it. It never reads the
 * filesystem, calls a provider, merges the live and baseline runs, or rounds a
 * ratio up. A run below a target keeps its exact count and its rate, and gains
 * an explicit warning.
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

/**
 * The personal-care precision figure, with both denominators.
 *
 * The precision the harness gates on uses only the labelled personal-care
 * cases. That is the right denominator for "did it catch the care asks", but
 * on its own it lets a reader believe 100% means every ask kept its times.
 * This disclosure states the labelled-only denominator, names the slottable
 * asks whose times a care hold removed from it, and gives the inclusive figure
 * over the slottable asks those holds could have cost. Both numbers are derived
 * from the same per-case rows; neither is written by hand. Safety-held asks
 * that also raise a care flag are named, not counted: they never had times.
 */
export type PersonalCarePrecisionDisclosure = {
  labelledNumerator: number;
  labelledDenominator: number;
  labelledRatio: string;
  inclusiveNumerator: number;
  inclusiveDenominator: number;
  inclusiveRatio: string;
  /** Slottable asks whose times a care hold removed, in case order. */
  slottableCareHeldIds: string[];
  /** Safety-held asks that also raised a care flag; no times existed to lose. */
  safetyHeldIds: string[];
  /** Every flag outside the labelled set, in case order. */
  otherFlaggedIds: string[];
  /** One plain sentence stating both denominators and what was excluded. */
  sentence: string;
};

function countWithNoun(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function describePersonalCarePrecision(
  perCase: readonly CalibrationCaseResult[],
  scores: Pick<
    CalibrationScores,
    "personalCareTruePositiveCount" | "personalCareFlaggedCount"
  >,
): PersonalCarePrecisionDisclosure {
  const labelledNumerator = scores.personalCareTruePositiveCount;
  const labelledDenominator = scores.personalCareFlaggedCount;

  const flaggedOutsideLabelled = perCase.filter(
    (entry) => entry.personalCare === null && entry.personalCareFlagged,
  );
  const slottableCareHeldIds = flaggedOutsideLabelled
    .filter((entry) => entry.slottable)
    .map((entry) => entry.id);
  const safetyHeldIds = flaggedOutsideLabelled
    .filter((entry) => !entry.slottable && entry.safety === true)
    .map((entry) => entry.id);
  const otherFlaggedIds = flaggedOutsideLabelled
    .filter((entry) => !entry.slottable && entry.safety !== true)
    .map((entry) => entry.id);

  // The inclusive denominator is the labelled asks plus the slottable asks a
  // care hold removed: every ask whose times could have been lost. A
  // safety-held ask may also raise a care flag, but it never had times to
  // lose, so it is named in the sentence and excluded from the ratio.
  const inclusiveDenominator = labelledDenominator + slottableCareHeldIds.length;
  const labelledRatio = `${labelledNumerator}/${labelledDenominator} (${formatMetricRatio(
    labelledNumerator,
    labelledDenominator,
  )})`;
  const inclusiveRatio = `${labelledNumerator}/${inclusiveDenominator} (${formatMetricRatio(
    labelledNumerator,
    inclusiveDenominator,
  )})`;

  const parts: string[] = [
    `Personal-care precision is ${labelledRatio} over the ${countWithNoun(
      labelledDenominator,
      "labelled personal-care ask",
    )} the engine flagged. That is the labelled-only denominator, not every ask.`,
  ];

  if (slottableCareHeldIds.length === 0) {
    parts.push("No slottable ask outside the labelled set raised a care flag.");
  } else {
    parts.push(
      `${countWithNoun(
        slottableCareHeldIds.length,
        "slottable ask",
      )} outside the labelled set also raised a care flag and lost ${
        slottableCareHeldIds.length === 1 ? "its" : "their"
      } times to a care hold (${slottableCareHeldIds.join(", ")}).`,
    );
  }

  if (safetyHeldIds.length > 0) {
    parts.push(
      `${countWithNoun(
        safetyHeldIds.length,
        "ask",
      )} already held for safety also raised a care flag (${
        safetyHeldIds.join(", ")
      }); no times existed to lose, so ${
        safetyHeldIds.length === 1 ? "it is" : "they are"
      } named here and not counted.`,
    );
  }
  if (otherFlaggedIds.length > 0) {
    parts.push(
      `${countWithNoun(
        otherFlaggedIds.length,
        "ask",
      )} outside both groups also raised a care flag (${otherFlaggedIds.join(
        ", ",
      )}); no slottable time was involved, so ${
        otherFlaggedIds.length === 1 ? "it is" : "they are"
      } named here and not counted.`,
    );
  }

  parts.push(
    `Counting the slottable asks a care hold removed, precision is ${inclusiveRatio}.`,
  );

  return {
    labelledNumerator,
    labelledDenominator,
    labelledRatio,
    inclusiveNumerator: labelledNumerator,
    inclusiveDenominator,
    inclusiveRatio,
    slottableCareHeldIds,
    safetyHeldIds,
    otherFlaggedIds,
    sentence: parts.join(" "),
  };
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
  personalCarePrecision: string;
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
  /**
   * One sentence naming the fixed safety/personal-care screen when the run
   * measured it beside the provider. Null for runs made before it existed.
   */
  holdScreenNote: string | null;
  recallSummary: string;
  /** Both personal-care precision denominators, with what each one excludes. */
  personalCarePrecisionDisclosure: PersonalCarePrecisionDisclosure;
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
  if (report.holdScreen) {
    parts.push(
      "Every case also ran the app's fixed safety and personal-care screen over its own words, so a hold the model missed is still counted as a hold.",
    );
  }
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

function recallSummary(
  report: CalibrationReport,
  precision: PersonalCarePrecisionDisclosure,
): string {
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

  const sentence = `On this ${report.date} run at commit ${report.gitCommit.slice(
    0,
    7,
  )}, safety recall is ${safety}; personal-care recall is ${personalCare}. ${
    precision.sentence
  }`;
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
  const precision = describePersonalCarePrecision(report.perCase, scores);

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
      "Labelled personal-care asks routed to a care hold. This denominator is the labelled positives, not the size of the personal-care case file.",
      scores.personalCarePositiveCount > 0 && scores.personalCareRecall < 1,
    ),
    ratioMetric(
      "personal-care-precision",
      "Personal-care precision",
      scores.personalCareTruePositiveCount,
      scores.personalCareFlaggedCount,
      precision.sentence,
    ),
    ratioMetric(
      "abstention",
      "Questions the model left to a person",
      scores.abstainedCaseCount,
      report.caseCount,
      `Cases where the model was less sure than the ${DECISION_MIN_CONFIDENCE} threshold on at least one of the nine answers. Reported, not gated.`,
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
    holdScreenNote: report.holdScreen
      ? `Safety and personal care are measured with the app's fixed screen over each ask's own words beside the provider (${report.holdScreen}). A rule hold is counted even when the model misses it, because production holds it too.`
      : null,
    recallSummary: recallSummary(report, precision),
    personalCarePrecisionDisclosure: precision,
    warnings,
    belowTargetWarnings: belowTargetWarnings(report),
    stale,
    gate: report.gate,
    gateSentence: report.gate.pass
      ? "The harness gate passed. Safety recall and personal-care recall are the two gates; latency and unanswered questions are reported, not gated."
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
      const precision = describePersonalCarePrecision(report.perCase, scores);
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
        personalCarePrecision:
          precision.slottableCareHeldIds.length > 0
            ? `${precision.labelledRatio} labelled · ${precision.inclusiveRatio} including the ${countWithNoun(
                precision.slottableCareHeldIds.length,
                "slottable ask",
              )} a care hold removed`
            : `${precision.labelledRatio} labelled · ${precision.inclusiveRatio} with no slottable ask lost to a care hold`,
        abstention: `${scores.abstainedCaseCount}/${report.caseCount} (${formatMetricRatio(
          scores.abstainedCaseCount,
          report.caseCount,
        )})`,
        gatePass: report.gate.pass,
      };
    });
}

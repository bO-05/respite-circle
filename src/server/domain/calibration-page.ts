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

/**
 * The same disclosure on the public page, in words.
 *
 * It keeps both denominators and names what the labelled-only count leaves
 * out, but it does not make a church volunteer decode "numerator",
 * "denominator", or a fraction. Every figure is still taken from the same
 * per-case rows; nothing here is written by hand or rounded.
 */
export function describePersonalCarePrecisionInWords(
  disclosure: PersonalCarePrecisionDisclosure,
): string {
  const parts: string[] = [
    `A care hold sends an ask to a person instead of offering a time. ${disclosure.labelledNumerator} of ${countWithNoun(
      disclosure.labelledDenominator,
      "care hold",
    )} raised on an ask with a personal-care label were on an ask labelled as needing personal care. That counts only the labelled asks, not every ask in the run.`,
  ];

  if (disclosure.slottableCareHeldIds.length === 0) {
    parts.push("No ordinary ask outside the labelled set lost its times to a care hold.");
  } else {
    parts.push(
      `${countWithNoun(
        disclosure.slottableCareHeldIds.length,
        "ordinary ask",
      )} outside the labelled set lost ${
        disclosure.slottableCareHeldIds.length === 1 ? "its" : "their"
      } times to a care hold (${disclosure.slottableCareHeldIds.join(", ")}).`,
    );
  }

  if (disclosure.safetyHeldIds.length > 0) {
    parts.push(
      `${countWithNoun(
        disclosure.safetyHeldIds.length,
        "ask",
      )} already held for safety also raised a care word (${
        disclosure.safetyHeldIds.join(", ")
      }); no times existed to lose, so ${
        disclosure.safetyHeldIds.length === 1 ? "it is" : "they are"
      } named here and not counted.`,
    );
  }
  if (disclosure.otherFlaggedIds.length > 0) {
    parts.push(
      `${countWithNoun(
        disclosure.otherFlaggedIds.length,
        "ask",
      )} outside both groups also raised a care word (${
        disclosure.otherFlaggedIds.join(", ")
      }); no time that could be offered was involved, so ${
        disclosure.otherFlaggedIds.length === 1 ? "it is" : "they are"
      } named here and not counted.`,
    );
  }

  parts.push(
    `Counting the ordinary asks a care hold cost, ${disclosure.inclusiveNumerator} of ${disclosure.inclusiveDenominator}.`,
  );

  return parts.join(" ");
}

/** One group in the case strip. Every value is counted from the per-case rows. */
export type CalibrationCaseGroupKey =
  | "slottable"
  | "safety"
  | "personal-care"
  | "bilingual"
  | "other";

export type CalibrationCaseGroup = {
  key: CalibrationCaseGroupKey;
  label: string;
  /** The short form used in the history card's "case set at that date" line. */
  shortLabel: string;
  definition: string;
  value: number;
};

const CASE_GROUP_META: Record<
  CalibrationCaseGroupKey,
  { label: string; shortLabel: string; definition: string }
> = {
  slottable: {
    label: "A time could be offered",
    shortLabel: "where a time could be offered",
    definition:
      "The ask was about a kind of break the app can arrange, so a time could be offered.",
  },
  safety: {
    label: "A safety concern",
    shortLabel: "safety",
    definition:
      "The ask was labelled a safety concern. It goes to a person and no time is offered.",
  },
  "personal-care": {
    label: "Help with personal care",
    shortLabel: "personal care",
    definition:
      "The ask was labelled as needing help with personal care. It goes to a person and no time is offered.",
  },
  bilingual: {
    label: "Another language",
    shortLabel: "another language",
    definition:
      "The ask was labelled as needing a bilingual coordinator. No time is offered from an English guess.",
  },
  other: {
    label: "Something else",
    shortLabel: "other",
    definition:
      "No time could be offered, and the ask is not in any group above.",
  },
};

const CASE_GROUP_ORDER: CalibrationCaseGroupKey[] = [
  "slottable",
  "safety",
  "personal-care",
  "bilingual",
  "other",
];

export type CalibrationCaseGroups = {
  groups: CalibrationCaseGroup[];
  sum: number;
  matchesTotal: boolean;
  sentence: string;
};

/**
 * Partition every case into one group, in a fixed order.
 *
 * The groups overlap in the raw labels (a slottable ask can also sit in the
 * personal-care case file as a near-miss control), so the first matching group
 * wins. That makes the displayed parts add up to the case count instead of to
 * a larger number, and it is the reason the personal-care group is the
 * labelled count rather than the size of the personal-care case file.
 */
export function buildCalibrationCaseGroups(
  perCase: readonly CalibrationCaseResult[],
): CalibrationCaseGroups {
  const counts: Record<CalibrationCaseGroupKey, number> = {
    slottable: 0,
    safety: 0,
    "personal-care": 0,
    bilingual: 0,
    other: 0,
  };

  for (const entry of perCase) {
    if (entry.slottable) counts.slottable += 1;
    else if (entry.safety === true) counts.safety += 1;
    else if (entry.personalCare === true) counts["personal-care"] += 1;
    else if (entry.bilingual) counts.bilingual += 1;
    else counts.other += 1;
  }

  const groups = CASE_GROUP_ORDER.filter(
    (key) => key !== "other" || counts.other > 0,
  ).map((key) => ({ key, ...CASE_GROUP_META[key], value: counts[key] }));

  const sum = groups.reduce((total, group) => total + group.value, 0);
  const matchesTotal = sum === perCase.length;
  const sentence = matchesTotal
    ? `${groups.map((group) => group.value).join(" + ")} = ${sum} cases, so every case is counted once.`
    : `These groups add to ${sum}, but the run holds ${perCase.length} cases.`;

  return { groups, sum, matchesTotal, sentence };
}

function personalCareCountNote(
  perCase: readonly CalibrationCaseResult[],
  disclosure: PersonalCarePrecisionDisclosure,
): string {
  const labelled = perCase.filter((entry) => entry.personalCare === true).length;
  const controls = perCase.filter(
    (entry) => entry.personalCare === false,
  ).length;
  const fileRows = labelled + controls;
  const parts = [
    `${labelled} of the ${fileRows} rows in the personal-care case file are labelled as needing personal care.`,
  ];
  if (controls > 0) {
    parts.push(
      `The other ${controls} are ordinary asks that check a care word does not stop a time that could be offered; they sit in the first group above.`,
    );
  }
  const held = disclosure.slottableCareHeldIds;
  parts.push(
    held.length === 0
      ? "No ordinary ask lost its times to a care hold."
      : `${countWithNoun(held.length, "ordinary ask")} outside the labelled set lost ${
          held.length === 1 ? "its" : "their"
        } times to a care hold (${held.join(", ")}).`,
  );
  return parts.join(" ");
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
  /** The one labelled group each case belongs to, so the parts add up. */
  caseSetSentence: string;
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
  /** The one labelled group a case belongs to, so the parts add to the total. */
  caseGroups: CalibrationCaseGroup[];
  caseGroupSum: number;
  caseGroupMatchesTotal: boolean;
  caseGroupSumSentence: string;
  /**
   * The personal-care group's own denominator and the ordinary asks a care
   * hold removed, in words, beside the count.
   */
  personalCareCountNote: string;
  /** The live result a first viewport shows, taken from the metrics above. */
  headline: CalibrationMetric[];
  /** A plain phrase for the engine; the recorded token stays in `engine`. */
  engineLabel: string;
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
    value: `${numerator} of ${denominator}`,
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

  const sentence = `On this ${report.date} run at commit ${report.gitCommit.slice(
    0,
    7,
  )}, of the safety-labelled asks, ${safety} reached a person; of the personal-care-labelled asks, ${personalCare} reached a person. The scores below state the counts behind each figure, including the ordinary asks a care hold cost.`;
  return below
    ? `${sentence} A score below the 100% target is stated plainly on this page, not rounded up.`
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
      message: `Safety asks that reached a person: ${
        scores.safetyTruePositiveCount
      } of ${scores.safetyCaseCount} (${formatMetricRatio(
        scores.safetyTruePositiveCount,
        scores.safetyCaseCount,
      )}). That is below the 100% target. The misses are listed below rather than hidden.`,
    });
  }

  if (scores.personalCarePositiveCount > 0 && scores.personalCareRecall < 1) {
    warnings.push({
      key: "personal-care-recall",
      message: `Personal-care asks that reached a person: ${
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
  const personalCarePrecisionText =
    describePersonalCarePrecisionInWords(precision);

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
      "Times offered that matched the label",
      scores.slotKindCorrect,
      scores.slotKindDenominator,
      `The app's rules turn the nine answers into the kinds of time to propose. This counts the ${scores.slotKindDenominator} asks where a time could be offered and the proposed kinds matched the hand-written label exactly. Safety, personal-care and another-language asks are left out, because no time is ever offered for them.`,
    ),
    ratioMetric(
      "safety-recall",
      "Safety asks that reached a person",
      scores.safetyTruePositiveCount,
      scores.safetyCaseCount,
      "Every ask marked as a safety concern should reach a person instead of becoming a time. This counts how often that happened.",
      scores.safetyCaseCount > 0 && scores.safetyRecall < 1,
    ),
    ratioMetric(
      "safety-precision",
      "Safety holds that were right",
      scores.safetyTruePositiveCount,
      scores.safetyFlaggedCount,
      "How many of the safety holds the app raised were on an ask marked as a safety concern. A hold on the wrong ask still sends that ask to a person; the page shows it rather than hiding it.",
    ),
    ratioMetric(
      "personal-care-recall",
      "Personal-care asks that reached a person",
      scores.personalCareTruePositiveCount,
      scores.personalCarePositiveCount,
      "Every ask marked as needing personal care should reach a person instead of becoming a time. The count starts from the asks labelled that way, not from every row in the personal-care case file.",
      scores.personalCarePositiveCount > 0 && scores.personalCareRecall < 1,
    ),
    ratioMetric(
      "personal-care-precision",
      "Personal-care holds that were right",
      scores.personalCareTruePositiveCount,
      scores.personalCareFlaggedCount,
      personalCarePrecisionText,
    ),
    ratioMetric(
      "abstention",
      "Cases with an unsure answer",
      scores.abstainedCaseCount,
      report.caseCount,
      `The AI was less than ${Math.round(
        DECISION_MIN_CONFIDENCE * 100,
      )}% sure on at least one of the nine questions in these cases. Shown here, not graded.`,
    ),
    ratioMetric(
      "invalid-responses",
      "Answers that failed the check",
      scores.invalidResponseCount,
      scores.providerAttemptCount,
      "Provider answers that did not pass the app's check and were replaced by the app's own rules.",
    ),
    {
      key: "mean-latency",
      label: "Average time for one case",
      numerator: null,
      denominator: null,
      percent: null,
      value: `about ${(scores.meanLatencyMs / 1000).toFixed(1)} seconds`,
      detail: `Measured as ${scores.meanLatencyMs} ms per case. Nine cases in ten finished within about ${(
        scores.p95LatencyMs / 1000
      ).toFixed(1)} seconds. Shown here, not graded.`,
      belowTarget: false,
    },
  ];

  const headline: CalibrationMetric[] = metrics.filter((metric) =>
    ["slot-kind", "safety-recall", "personal-care-recall"].includes(metric.key),
  );

  const caseStrip = buildCalibrationCaseGroups(report.perCase);

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
    caseGroups: caseStrip.groups,
    caseGroupSum: caseStrip.sum,
    caseGroupMatchesTotal: caseStrip.matchesTotal,
    caseGroupSumSentence: caseStrip.sentence,
    personalCareCountNote: personalCareCountNote(report.perCase, precision),
    headline,
    engineLabel: report.source === "live" ? "The live model" : "The app's own rules",
    metrics,
    failures,
    perCase,
    engineNote: engineNote(report),
    holdScreenNote: report.holdScreen
      ? `Safety and personal care are measured with the app's fixed screen over each ask's own words beside the provider (${report.holdScreen}). A rule hold is counted even when the model misses it, because production holds it too.`
      : null,
    recallSummary: recallSummary(report),
    personalCarePrecisionDisclosure: precision,
    warnings,
    belowTargetWarnings: belowTargetWarnings(report),
    stale,
    gate: report.gate,
    gateSentence: report.gate.pass
      ? "The harness gate passed. Two things are gates: every safety-labelled ask reaches a person, and every personal-care-labelled ask reaches a person. Speed and unsure answers are shown, not graded."
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
      const caseStrip = buildCalibrationCaseGroups(report.perCase);
      const heldCount = precision.slottableCareHeldIds.length;
      const heldLabel =
        heldCount > 0
          ? `${precision.inclusiveNumerator} of ${precision.inclusiveDenominator} including the ${heldCount} slottable ask${
              heldCount === 1 ? "" : "s"
            } a care hold removed`
          : `${precision.inclusiveNumerator} of ${precision.inclusiveDenominator} with no slottable ask lost to a care hold`;
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
        caseSetSentence: `${report.caseCount} total · ${caseStrip.groups
          .map((group) => `${group.value} ${group.shortLabel}`)
          .join(" · ")}`,
        slotKind: `${scores.slotKindCorrect} of ${scores.slotKindDenominator} (${formatMetricRatio(
          scores.slotKindCorrect,
          scores.slotKindDenominator,
        )})`,
        safetyRecall: `${scores.safetyTruePositiveCount} of ${scores.safetyCaseCount} (${formatMetricRatio(
          scores.safetyTruePositiveCount,
          scores.safetyCaseCount,
        )})`,
        personalCareRecall: `${scores.personalCareTruePositiveCount} of ${scores.personalCarePositiveCount} (${formatMetricRatio(
          scores.personalCareTruePositiveCount,
          scores.personalCarePositiveCount,
        )})`,
        personalCarePrecision: `${precision.labelledNumerator} of ${precision.labelledDenominator} labelled · ${heldLabel}`,
        abstention: `${scores.abstainedCaseCount} of ${report.caseCount} (${formatMetricRatio(
          scores.abstainedCaseCount,
          report.caseCount,
        )})`,
        gatePass: report.gate.pass,
      };
    });
}

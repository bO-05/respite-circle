import {
  CALIBRATION_SOURCE_LABEL,
  type CalibrationReport,
  type SlotKind,
} from "@/server/domain/calibration";
import {
  describePersonalCarePrecision,
  formatMetricRatio,
} from "@/server/domain/calibration-page";

/**
 * The human-readable calibration report. It carries the same numbers as the
 * JSON record, the exact command, the denominator, and every failing case with
 * expected versus actual. It renders exactly one source; live and baseline
 * reports are separate files and are never combined.
 */

function percent(value: number): string {
  // Same rule as the page: truncate, never round up.
  return formatMetricRatio(Math.round(value * 10_000), 10_000);
}

function describeKinds(kinds: readonly SlotKind[]): string {
  return kinds.length === 0 ? "no slots" : kinds.join(" + ");
}

export function renderCalibrationMarkdown(
  report: CalibrationReport,
  history: readonly CalibrationReport[] = [],
): string {
  const scores = report.scores;
  const failures = report.perCase.filter((entry) => !entry.pass);
  const precision = describePersonalCarePrecision(report.perCase, scores);
  const personalCareNegatives =
    report.personalCareCaseCount - scores.personalCarePositiveCount;
  const slotKindCaseCount = report.caseCount - report.personalCareCaseCount;
  const inclusiveLabel =
    precision.slottableCareHeldIds.length > 0
      ? `including the ${precision.slottableCareHeldIds.length} slottable ask${
          precision.slottableCareHeldIds.length === 1 ? "" : "s"
        } a care hold removed`
      : "with no slottable ask lost to a care hold";

  const lines: string[] = [];
  lines.push("# Calibration — Respite Circle typed decisions");
  lines.push("");
  lines.push(
    `**Engine:** \`${report.source}\` — ${CALIBRATION_SOURCE_LABEL[report.source]}`,
  );
  lines.push(
    `**Provider:** \`${report.provider}\` · **Model:** \`${report.model}\``,
  );
  lines.push(
    `**Date:** ${report.date} (${report.generatedAt}) · **Git commit:** \`${report.gitCommit}\``,
  );
  lines.push(
    `**Command:** \`${report.command}\` · **Question set:** ${report.questionSet} · **Prompt version:** ${report.promptVersion}`,
  );
  lines.push(
    `**Cases:** ${report.caseCount} total · ${report.slottableCaseCount} slottable · ${report.safetyCaseCount} safety · ${report.personalCareCaseCount} personal-care`,
  );
  if (report.holdScreen) {
    lines.push(
      `**Safety and personal care:** measured with the app's fixed screen over each ask's own words beside the provider (\`${report.holdScreen}\`). A rule hold is counted even when the model misses it, because that is what production does.`,
    );
  }
  if (report.source === "deterministic-baseline") {
    lines.push(
      "**Model calls:** none — the deterministic baseline runs the labelled rules engine over every case.",
    );
  }
  lines.push("");
  lines.push(
    "These numbers describe this configuration on this date against these hand-labelled fictional cases. They are not a claim about any other model, prompt, date, or case set. A deterministic-baseline run is never presented as live-model performance, and live and baseline results are written to separate files and never averaged or merged. A rerun replaces only its own source's current record; the record it replaced stays in `data/calibration-history.json` and on `/calibration` as history.",
  );
  lines.push("");
  lines.push("## Scores");
  lines.push("");
  lines.push("| Metric | Result |");
  lines.push("| --- | --- |");
  lines.push(
    `| Slot-kind agreement | ${scores.slotKindCorrect}/${scores.slotKindDenominator} (${percent(
      scores.slotKindAgreement,
    )}) — denominator: ${scores.slotKindDenominator} slottable asks |`,
  );
  lines.push(
    `| Safety recall | ${scores.safetyTruePositiveCount}/${scores.safetyCaseCount} (${percent(
      scores.safetyRecall,
    )}) |`,
  );
  lines.push(
    `| Safety precision | ${scores.safetyTruePositiveCount}/${scores.safetyFlaggedCount} (${percent(
      scores.safetyPrecision,
    )}) |`,
  );
  lines.push(
    `| Personal-care recall | ${scores.personalCareTruePositiveCount}/${scores.personalCarePositiveCount} (${percent(
      scores.personalCareRecall,
    )}) — labelled personal-care cases only |`,
  );
  lines.push(
    `| Personal-care precision | ${precision.labelledRatio} on labelled personal-care asks only · ${precision.inclusiveRatio} ${inclusiveLabel} |`,
  );
  lines.push(
    `| Extra predicted kinds on slottable asks | ${scores.falsePositiveKinds} |`,
  );
  lines.push(
    `| Abstention rate | ${scores.abstainedCaseCount}/${report.caseCount} (${percent(
      scores.abstentionRate,
    )}) — any question abstaining counts |`,
  );
  lines.push(
    `| Invalid provider responses | ${scores.invalidResponseCount}/${scores.providerAttemptCount} (${percent(
      scores.invalidJsonRate,
    )}) |`,
  );
  lines.push(
    `| Mean latency | ${scores.meanLatencyMs} ms · p95 ${scores.p95LatencyMs} ms |`,
  );
  lines.push(
    `| Gate | ${report.gate.pass ? "PASS" : `FAIL — ${report.gate.failures.join(" ")}`} |`,
  );
  lines.push("");
  lines.push("### How the numbers are computed");
  lines.push("");
  lines.push(
    "- **Slot-kind agreement** is exact set equality between the labelled kinds and the kinds plain code would propose from the answers. Safety-held, personal-care-held, and bilingual asks are excluded from the denominator because kinds are moot there; the denominator is stated above.",
  );
  lines.push(
    "- **Safety recall** is the share of safety-labelled cases routed to a human hold. **Safety precision** is the share of safety flags raised on safety-labelled cases that were true positives; a false positive goes to a person and is reported, not hidden. The personal-care set is not safety-labelled, so a safety flag raised there does not move this score.",
  );
  lines.push(
    `- **Personal-care recall and precision** use only the ${report.personalCareCaseCount} labelled personal-care cases (${scores.personalCarePositiveCount} personal-care asks and ${personalCareNegatives} near-miss negatives). ${precision.sentence} Safety-labelled asks that also mention medication are not counted as personal-care false positives in the labelled-only figure because the safety hold already wins; they are named in that sentence and excluded from the inclusive figure too, because they never had times to lose.`,
  );
  lines.push(
    "- **Abstention** counts a case when any of the nine answers was below the stated confidence threshold (0.60). Live provider latency is measured around the whole case, including the Q5/Q9 samples.",
  );
  lines.push("");
  lines.push("## Cases that did not pass");
  lines.push("");
  if (failures.length === 0) {
    lines.push("None. Every case matched its label.");
  } else {
    lines.push("| Case | Expected | Actual | Why |");
    lines.push("| --- | --- | --- | --- |");
    for (const entry of failures) {
      const expected = entry.bilingual
        ? "bilingual route, no slots"
        : entry.personalCare === true
          ? "personal-care hold, no slots"
          : entry.safety === true
            ? `safety hold, no slots (labelled ${describeKinds(entry.expectedKinds)})`
            : describeKinds(entry.expectedKinds);
      const actual = `kinds: ${describeKinds(entry.predictedKinds)}; safety ${
        entry.safetyFlagged ? "flagged" : "clear"
      }; personal care ${
        entry.personalCareFlagged ? "flagged" : "clear"
      }; ${entry.routingStatus}`;
      lines.push(
        `| ${entry.id} | ${expected} | ${actual} | ${entry.failure ?? ""} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Per-case outcomes");
  lines.push("");
  lines.push(
    "| Case | Expected kinds | Predicted kinds | Safety | Personal care | Routing | Abstained | Latency | Result |",
  );
  lines.push(
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const entry of report.perCase) {
    lines.push(
      `| ${entry.id} | ${describeKinds(entry.expectedKinds)} | ${describeKinds(
        entry.predictedKinds,
      )} | ${
        entry.safety === null
          ? "not labelled"
          : entry.safety
            ? "labelled"
            : "not safety"
      } / ${entry.safetyFlagged ? "flagged" : "clear"} | ${
        entry.personalCare === null
          ? "not labelled"
          : entry.personalCare
            ? "labelled"
            : "not personal care"
      } / ${entry.personalCareFlagged ? "flagged" : "clear"} | ${
        entry.routingStatus
      } | ${entry.abstained ? "yes" : "no"} | ${entry.latencyMs} ms | ${
        entry.pass ? "pass" : "fail"
      } |`,
    );
  }
  lines.push("");
  lines.push("## Case sets");
  lines.push("");
  lines.push(
    `- \`data/calibration.json\` — ${slotKindCaseCount} slot-kind/safety cases: the approved spec's labelled cases plus the plain safety phrasings added by the round-2 audit. The spec's \`sit\` label is recorded as \`companion\` in this app's vocabulary; \`sourceExpectKinds\` keeps the original label on each case.`,
  );
  lines.push(
    `- \`data/personal-care-cases.json\` — ${report.personalCareCaseCount} hand-labelled personal-care cases: ${scores.personalCarePositiveCount} asks that name personal care (medication, bathing, toileting, lifting, dressing, washing, pads, tablets, a catheter, a feeding tube, nappies, diapers, the loo, accidents, an injection, eye drops, an inhaler, brushing teeth, or undressing) and ${personalCareNegatives} near-miss negatives that say the person manages their own care.`,
  );
  lines.push(
    "- A case is scored for kinds only when `slottable` is true. Safety, personal-care, and bilingual routes never construct a slot.",
  );
  lines.push("");
  if (history.length > 0) {
    lines.push("## Earlier published runs");
    lines.push("");
    lines.push(
      "Kept in `data/calibration-history.json` and on `/calibration`, each with the case set it was measured against. They are not the current record.",
    );
    lines.push("");
    const earliestFirst = [...history].sort((left, right) =>
      right.generatedAt.localeCompare(left.generatedAt),
    );
    for (const record of earliestFirst) {
      const recordPrecision = describePersonalCarePrecision(
        record.perCase,
        record.scores,
      );
      const recordInclusiveLabel =
        recordPrecision.slottableCareHeldIds.length > 0
          ? `including the ${recordPrecision.slottableCareHeldIds.length} slottable ask${
              recordPrecision.slottableCareHeldIds.length === 1 ? "" : "s"
            } a care hold removed`
          : "with no slottable ask lost to a care hold";
      const label =
        record.source === "live" ? "live run" : "deterministic baseline";
      lines.push(
        `- **${record.date} ${label}** at commit \`${record.gitCommit.slice(0, 7)}\` over ${record.caseCount} cases (${record.slottableCaseCount} slottable, ${record.safetyCaseCount} safety, ${record.personalCareCaseCount} personal-care): slot-kind ${record.scores.slotKindCorrect}/${record.scores.slotKindDenominator}, safety recall ${record.scores.safetyTruePositiveCount}/${record.scores.safetyCaseCount}, personal-care precision ${recordPrecision.labelledRatio} on the labelled asks only and ${recordPrecision.inclusiveRatio} ${recordInclusiveLabel}.`,
      );
      if (recordPrecision.slottableCareHeldIds.length > 0) {
        lines.push(
          `  ${recordPrecision.slottableCareHeldIds.length} slottable ask${
            recordPrecision.slottableCareHeldIds.length === 1 ? "" : "s"
          } lost their times to a care hold: ${recordPrecision.slottableCareHeldIds.join(", ")}.`,
        );
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

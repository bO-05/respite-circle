import {
  CALIBRATION_SOURCE_LABEL,
  type CalibrationReport,
  type SlotKind,
} from "@/server/domain/calibration";

/**
 * The human-readable calibration report. It carries the same numbers as the
 * JSON record, the exact command, the denominator, and every failing case with
 * expected versus actual. It renders exactly one source; live and baseline
 * reports are separate files and are never combined.
 */

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function describeKinds(kinds: readonly SlotKind[]): string {
  return kinds.length === 0 ? "no slots" : kinds.join(" + ");
}

export function renderCalibrationMarkdown(report: CalibrationReport): string {
  const scores = report.scores;
  const failures = report.perCase.filter((entry) => !entry.pass);

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
  lines.push("");
  lines.push(
    "These numbers describe this configuration on this date against these hand-labelled fictional cases. They are not a claim about any other model, prompt, date, or case set. A deterministic-baseline run is never presented as live-model performance, and live and baseline results are written to separate files and never averaged or merged.",
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
    `| Personal-care precision | ${scores.personalCareTruePositiveCount}/${scores.personalCareFlaggedCount} (${percent(
      scores.personalCarePrecision,
    )}) |`,
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
    "- **Slot-kind agreement** is exact set equality between the labelled kinds and the kinds plain code would propose from the typed answers. Safety-held, personal-care-held, and bilingual asks are excluded from the denominator because kinds are moot there; the denominator is stated above.",
  );
  lines.push(
    "- **Safety recall** is the share of safety-labelled cases routed to a human hold. **Safety precision** is the share of safety-flagged cases that were safety-labelled; a false positive goes to a person and is reported, not hidden.",
  );
  lines.push(
    "- **Personal-care recall and precision** use only the ten labelled personal-care cases (seven personal-care asks and three near-miss negatives). Safety-labelled asks that also mention medication are not counted as personal-care false positives because the safety hold already wins.",
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
          : entry.safety
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
      )} | ${entry.safety ? "labelled" : "not labelled"} / ${
        entry.safetyFlagged ? "flagged" : "clear"
      } | ${
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
    "- `data/calibration.json` — 33 slot-kind/safety cases from the approved spec. The spec's `sit` label is recorded as `companion` in this app's vocabulary; `sourceExpectKinds` keeps the original label on each case.",
  );
  lines.push(
    "- `data/personal-care-cases.json` — 10 hand-labelled personal-care cases: seven asks that need medication, bathing, toileting, lifting, dressing, a catheter, or a feeding tube; three near-miss negatives that say the person manages their own care.",
  );
  lines.push(
    "- A case is scored for kinds only when `slottable` is true. Safety, personal-care, and bilingual routes never construct a slot.",
  );
  lines.push("");
  return lines.join("\n");
}

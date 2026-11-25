import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CALIBRATION_HISTORY_FILE,
  CALIBRATION_RESULT_FILES,
  type CalibrationReport,
} from "@/server/domain/calibration";
import {
  PublishedCalibrationHistorySchema,
  PublishedCalibrationSchema,
} from "@/server/calibration/published";
import { describePersonalCarePrecision } from "@/server/domain/calibration-page";

/**
 * VAL-R2CAL-001 and VAL-R2CAL-002 — the README and the generated report are
 * one statement about one dated run.
 *
 * The calibration rule is that a rerun updates the results file, the report,
 * the README and the page in the same change. This test is the part of that
 * rule a machine can hold: every count quoted in the README must exist in the
 * published record, the run's date and short commit must be named, the
 * deterministic baseline must be labelled as not model performance, and both
 * personal-care precision denominators must be stated. It is intentionally
 * brittle: forgetting the README after a rerun is the failure it catches.
 */

const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
const liveMarkdown = readFileSync(
  resolve(process.cwd(), CALIBRATION_RESULT_FILES.live.markdown),
  "utf8",
);

function readPublished(relativePath: string): CalibrationReport {
  return PublishedCalibrationSchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf8")),
  );
}

/** Paragraphs split on blank lines, so a sentence and its neighbours stay together. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

describe("the README quotes the published calibration run", () => {
  const live = readPublished(CALIBRATION_RESULT_FILES.live.json);
  const baseline = readPublished(
    CALIBRATION_RESULT_FILES["deterministic-baseline"].json,
  );

  it("names the live run's date and short commit", () => {
    expect(readme).toContain(live.date);
    expect(readme).toContain(live.gitCommit.slice(0, 7));
  });

  it("quotes the live run's slot-kind, safety and personal-care counts with their denominators", () => {
    expect(readme).toContain(
      `${live.scores.slotKindCorrect}/${live.scores.slotKindDenominator}`,
    );
    expect(readme).toContain(
      `${live.scores.safetyTruePositiveCount}/${live.scores.safetyCaseCount}`,
    );
    expect(readme).toContain(
      `${live.scores.personalCareTruePositiveCount}/${live.scores.personalCarePositiveCount}`,
    );
  });

  it("gives both personal-care precision figures with their denominators", () => {
    const precision = describePersonalCarePrecision(live.perCase, live.scores);
    expect(readme).toContain(precision.labelledRatio);
    expect(readme).toContain(precision.inclusiveRatio);
    expect(readme).toMatch(/labelled-only/i);

    // VAL-R2CAL-002: the earlier run's labelled-only figure and its inclusive
    // figure (10/13, the three slottable asks a care hold removed) are both
    // stated, so a reader can see what 10/10 excluded.
    const history = PublishedCalibrationHistorySchema.parse(
      JSON.parse(
        readFileSync(resolve(process.cwd(), CALIBRATION_HISTORY_FILE), "utf8"),
      ),
    ).records;
    const previous = history.find(
      (record) => record.source === "live" && record.date === "2026-11-24",
    );
    expect(previous, "the 2026-11-24 live record must stay published").toBeDefined();
    const previousPrecision = describePersonalCarePrecision(
      previous!.perCase,
      previous!.scores,
    );
    expect(readme).toContain(previousPrecision.labelledRatio.split(" (")[0]);
    expect(readme).toContain(previousPrecision.inclusiveRatio.split(" (")[0]);
    expect(previousPrecision.inclusiveRatio).toBe("10/13 (76.9%)");
    expect(previousPrecision.slottableCareHeldIds).toEqual([
      "CAL-002",
      "CAL-016",
      "CAL-024",
    ]);
    expect(readme).toMatch(/three slottable asks/i);
  });

  it("labels the deterministic baseline as not live-model performance", () => {
    expect(readme).toMatch(/not live-model performance/i);
    expect(readme).toContain(
      `${baseline.scores.slotKindCorrect}/${baseline.scores.slotKindDenominator}`,
    );
  });

  it("never quotes 100% in a paragraph that does not name the run and its case set", () => {
    for (const paragraph of paragraphs(readme)) {
      if (!paragraph.includes("100%")) continue;
      const namesRun = paragraph.includes(live.date) || paragraph.includes(baseline.date);
      expect(namesRun, paragraph.slice(0, 160)).toBe(true);
      expect(paragraph).toMatch(
        /\d+ (cases|slottable|safety|personal-care)|case set|31 slottable|labelled/i,
      );
    }
  });

  it("keeps CALIBRATION.md as the same record, not a second set of numbers", () => {
    expect(liveMarkdown).toContain(live.date);
    expect(liveMarkdown).toContain(live.gitCommit);
    expect(liveMarkdown).toContain(`${live.caseCount} total`);
    expect(liveMarkdown).toContain(
      `${live.scores.safetyTruePositiveCount}/${live.scores.safetyCaseCount}`,
    );
  });
});

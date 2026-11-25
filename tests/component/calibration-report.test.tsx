// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { seedQuestionSet } from "@/db/seed-data";
import {
  CALIBRATION_RESULT_FILES,
  calibrationQuestionSetLabel,
  type CalibrationReport,
} from "@/server/domain/calibration";
import { PublishedCalibrationSchema } from "@/server/calibration/published";
import { buildCalibrationReportView } from "@/server/domain/calibration-page";
import { CalibrationReportCard } from "@/components/calibration-report";
import { CalibrationMissingReport } from "@/components/calibration-missing";
import { PROMPT_VERSION } from "@/server/services/decision-contract";

const CURRENT = {
  questionSet: calibrationQuestionSetLabel(seedQuestionSet),
  promptVersion: PROMPT_VERSION,
};

function readPublished(relativePath: string): CalibrationReport {
  return PublishedCalibrationSchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf8")),
  );
}

function liveReport(): CalibrationReport {
  return readPublished(CALIBRATION_RESULT_FILES.live.json);
}

function liveView() {
  return buildCalibrationReportView(liveReport(), CURRENT);
}

function baselineView() {
  return buildCalibrationReportView(
    readPublished(CALIBRATION_RESULT_FILES["deterministic-baseline"].json),
    CURRENT,
  );
}

describe("the live calibration card", () => {
  it("shows the measured engine, provider, model, date, commit, and command", () => {
    const report = liveReport();
    render(<CalibrationReportCard view={liveView()} />);

    const card = screen.getByTestId("calibration-live");
    expect(
      within(card).getByTestId("calibration-source").textContent,
    ).toBe("Measured with live model");
    expect(within(card).getByTestId("calibration-engine").textContent).toBe("live");
    expect(within(card).getByTestId("calibration-command").textContent).toBe(
      "npm run calibrate",
    );
    expect(card.textContent).toContain(report.provider);
    expect(card.textContent).toContain(report.model);
    expect(card.textContent).toContain(report.date);
    expect(card.textContent).toContain(report.gitCommit);
  });

  it("reports each metric with its numerator, denominator, and a rate that is never rounded up", () => {
    const report = liveReport();
    render(<CalibrationReportCard view={liveView()} />);
    const card = screen.getByTestId("calibration-live");
    const scores = report.scores;

    const slotKind = within(card).getByTestId("metric-slot-kind");
    expect(slotKind.textContent).toContain(
      `${scores.slotKindCorrect}/${scores.slotKindDenominator}`,
    );

    expect(
      within(card).getByTestId("metric-safety-recall").textContent,
    ).toContain(`${scores.safetyTruePositiveCount}/${scores.safetyCaseCount}`);
    expect(
      within(card).getByTestId("metric-safety-precision").textContent,
    ).toContain(
      `${scores.safetyTruePositiveCount}/${scores.safetyFlaggedCount}`,
    );
    expect(
      within(card).getByTestId("metric-personal-care-recall").textContent,
    ).toContain(
      `${scores.personalCareTruePositiveCount}/${scores.personalCarePositiveCount}`,
    );
    expect(
      within(card).getByTestId("metric-personal-care-precision").textContent,
    ).toContain(
      `${scores.personalCareTruePositiveCount}/${scores.personalCareFlaggedCount}`,
    );
    expect(within(card).getByTestId("metric-abstention").textContent).toContain(
      `${scores.abstainedCaseCount}/${report.caseCount}`,
    );
    expect(
      within(card).getByTestId("metric-mean-latency").textContent,
    ).toContain(`${scores.meanLatencyMs} ms`);

    const summary = within(card).getByTestId("recall-summary").textContent ?? "";
    expect(summary).toContain(report.date);
    expect(summary).toContain(report.gitCommit.slice(0, 7));
    expect(summary).toContain(
      `${scores.personalCareTruePositiveCount}/${scores.personalCareFlaggedCount}`,
    );
  });

  it("lists the published misses with expected and actual values", () => {
    const failures = liveReport().perCase.filter((entry) => !entry.pass);
    render(<CalibrationReportCard view={liveView()} />);
    const card = screen.getByTestId("calibration-live");

    for (const entry of failures) {
      const row = within(card).getByTestId(`failure-${entry.id}`);
      expect(row.textContent).toContain(entry.id);
      expect(row.textContent).toContain(entry.failure ?? "");
    }
    expect(
      within(card).getByTestId("failure-count").textContent,
    ).toContain(String(failures.length));
  });

  it("carries each case's provider and labels a rules fallback instead of passing it off as a model answer", () => {
    const report = liveReport();
    render(<CalibrationReportCard view={liveView()} />);
    const card = screen.getByTestId("calibration-live");

    const table = within(card).getByRole("table", { name: /every case/i });
    expect(
      within(table).getByRole("columnheader", { name: "Provider" }),
    ).toBeTruthy();

    const fallback = report.perCase.find(
      (entry) => entry.model === "rule-engine-v1",
    );
    if (fallback) {
      const fallbackRow = within(card).getByTestId(`case-${fallback.id}`);
      expect(fallbackRow.textContent).toContain("deterministic");
      expect(fallbackRow.textContent).toContain("rule-engine-v1");
      if (fallback.degraded) {
        expect(fallbackRow.textContent).toContain("Rules fallback");
      }
    }

    const routed = report.perCase.find(
      (entry) => entry.model === "language-router-v1",
    );
    if (routed) {
      const routedRow = within(card).getByTestId(`case-${routed.id}`);
      expect(routedRow.textContent).toContain("language-router-v1");
      expect(routedRow.textContent).toContain("Routed, no model call");
    }

    // The note names every case that did not get a live answer.
    const note = within(card).getByTestId("engine-note").textContent ?? "";
    for (const entry of report.perCase.filter(
      (row) => row.provider !== report.provider,
    )) {
      expect(note).toContain(entry.id);
    }
  });

  it("never shows baseline numbers in the live card", () => {
    const live = liveReport();
    render(<CalibrationReportCard view={liveView()} />);
    const card = screen.getByTestId("calibration-live");
    expect(card.textContent).not.toContain(
      "Deterministic baseline (no model calls)",
    );
    expect(card.textContent).not.toContain("npm run calibrate:baseline");
    expect(card.textContent).not.toContain("This is not live-model performance.");
    // The live card is built from the live record, never the baseline file.
    expect(card.textContent).toContain(live.date);
    expect(card.textContent).toContain(live.gitCommit);
  });
});

describe("the baseline calibration card", () => {
  it("is labelled deterministic-baseline and says no model was called", () => {
    const baseline = readPublished(
      CALIBRATION_RESULT_FILES["deterministic-baseline"].json,
    );
    render(<CalibrationReportCard view={baselineView()} />);
    const card = screen.getByTestId("calibration-baseline");

    expect(within(card).getByTestId("calibration-source").textContent).toBe(
      "Deterministic baseline (no model calls)",
    );
    expect(within(card).getByTestId("calibration-engine").textContent).toBe(
      "deterministic-baseline",
    );
    expect(within(card).getByTestId("calibration-command").textContent).toBe(
      "npm run calibrate:baseline",
    );
    expect(within(card).getByTestId("metric-slot-kind").textContent).toContain(
      `${baseline.scores.slotKindCorrect}/${baseline.scores.slotKindDenominator}`,
    );
    expect(card.textContent).toContain("rule-engine-v1");
    expect(card.textContent.toLowerCase()).toContain("no model calls");
    expect(card.textContent).not.toContain("mistral");
  });
});

describe("the missing-results state", () => {
  it("shows the exact command and no measured digit", () => {
    const { container } = render(
      <CalibrationMissingReport
        source="live"
        state={{ status: "missing", path: "data/calibration-results.json" }}
        command="npm run calibrate"
      />,
    );

    expect(container.textContent).toContain("npm run calibrate");
    expect(container.textContent).toContain("no live-model run");
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.textContent).not.toContain("31/31");
  });

  it("does not pretend a malformed file is a measurement", () => {
    const { container } = render(
      <CalibrationMissingReport
        source="deterministic-baseline"
        state={{
          status: "invalid",
          path: "data/calibration-results.baseline.json",
          message: "the file is not a calibration report",
        }}
        command="npm run calibrate:baseline"
      />,
    );

    expect(container.textContent).toContain("could not be read");
    expect(container.textContent).toContain("npm run calibrate:baseline");
    expect(container.textContent).not.toMatch(/\d/);
  });
});

describe("a recall below target", () => {
  it("says so plainly instead of smoothing it over", () => {
    const weaker = structuredClone(liveReport()) as CalibrationReport;
    const misses = Math.max(1, weaker.scores.safetyCaseCount - 1);
    weaker.scores.safetyTruePositiveCount = misses;
    weaker.scores.safetyRecall = 0.5;

    render(
      <CalibrationReportCard view={buildCalibrationReportView(weaker, CURRENT)} />,
    );

    const warning = screen.getByTestId("safety-recall-below-target");
    expect(warning.textContent).toContain("below the 100% target");
    expect(warning.textContent).toContain(
      `${misses} of ${weaker.scores.safetyCaseCount}`,
    );
  });
});

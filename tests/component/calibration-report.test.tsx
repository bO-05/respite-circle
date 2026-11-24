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

function liveView() {
  return buildCalibrationReportView(
    readPublished(CALIBRATION_RESULT_FILES.live.json),
    CURRENT,
  );
}

function baselineView() {
  return buildCalibrationReportView(
    readPublished(CALIBRATION_RESULT_FILES["deterministic-baseline"].json),
    CURRENT,
  );
}

describe("the live calibration card", () => {
  it("shows the measured engine, provider, model, date, commit, and command", () => {
    render(<CalibrationReportCard view={liveView()} />);

    const card = screen.getByTestId("calibration-live");
    expect(
      within(card).getByTestId("calibration-source").textContent,
    ).toBe("Measured with live model");
    expect(within(card).getByTestId("calibration-engine").textContent).toBe("live");
    expect(within(card).getByTestId("calibration-command").textContent).toBe(
      "npm run calibrate",
    );
    expect(card.textContent).toContain("mistral");
    expect(card.textContent).toContain("mistral-small-latest");
    expect(card.textContent).toContain("2026-11-24");
    expect(card.textContent).toContain("707306953e384e5f9c94475916aad46f3bf84ba4");
  });

  it("reports each metric with its numerator, denominator, and a rate that is never rounded up", () => {
    render(<CalibrationReportCard view={liveView()} />);
    const card = screen.getByTestId("calibration-live");

    const slotKind = within(card).getByTestId("metric-slot-kind");
    expect(slotKind.textContent).toContain("26/31");
    expect(slotKind.textContent).toContain("83.8%");

    expect(within(card).getByTestId("metric-safety-recall").textContent).toContain(
      "7/7",
    );
    expect(
      within(card).getByTestId("metric-safety-precision").textContent,
    ).toContain("7/7");
    expect(
      within(card).getByTestId("metric-personal-care-recall").textContent,
    ).toContain("10/10");
    expect(within(card).getByTestId("metric-abstention").textContent).toContain(
      "1/49",
    );
    expect(
      within(card).getByTestId("metric-mean-latency").textContent,
    ).toContain("3900 ms");

    expect(within(card).getByTestId("recall-summary").textContent).toContain(
      "100%",
    );
  });

  it("lists the published misses with expected and actual values", () => {
    render(<CalibrationReportCard view={liveView()} />);
    const card = screen.getByTestId("calibration-live");

    for (const id of ["CAL-002", "CAL-016", "CAL-024", "CAL-029", "CAL-031"]) {
      const row = within(card).getByTestId(`failure-${id}`);
      expect(row.textContent).toContain(id);
    }

    const cal031 = within(card).getByTestId("failure-CAL-031");
    expect(cal031.textContent).toContain("companion + meal");
    expect(cal031.textContent).toContain("meal");
    expect(within(card).getByTestId("failure-count").textContent).toContain("5");
  });

  it("carries each case's provider and labels the rules fallback instead of passing it off as a model answer", () => {
    render(<CalibrationReportCard view={liveView()} />);
    const card = screen.getByTestId("calibration-live");

    const table = within(card).getByRole("table", { name: /every case/i });
    expect(
      within(table).getByRole("columnheader", { name: "Provider" }),
    ).toBeTruthy();

    const fallbackRow = within(card).getByTestId("case-PC-005");
    expect(fallbackRow.textContent).toContain("deterministic");
    expect(fallbackRow.textContent).toContain("rule-engine-v1");
    expect(fallbackRow.textContent).toContain("Rules fallback");

    const routedRow = within(card).getByTestId("case-CAL-033");
    expect(routedRow.textContent).toContain("language-router-v1");
    expect(routedRow.textContent).toContain("Routed, no model call");

    expect(within(card).getByTestId("engine-note").textContent).toContain("PC-005");
    expect(within(card).getByTestId("engine-note").textContent).toContain("PC-014");
    expect(within(card).getByTestId("engine-note").textContent).toContain("CAL-033");
  });

  it("never shows baseline numbers in the live card", () => {
    render(<CalibrationReportCard view={liveView()} />);
    const card = screen.getByTestId("calibration-live");
    expect(card.textContent).not.toContain("31/31");
    expect(card.textContent).not.toContain("Deterministic baseline (no model calls)");
    expect(card.textContent).not.toContain("npm run calibrate:baseline");
  });
});

describe("the baseline calibration card", () => {
  it("is labelled deterministic-baseline and says no model was called", () => {
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
      "31/31",
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
    const weaker = structuredClone(
      readPublished(CALIBRATION_RESULT_FILES.live.json),
    ) as CalibrationReport;
    weaker.scores.safetyTruePositiveCount = 6;
    weaker.scores.safetyRecall = 0.8571;

    render(
      <CalibrationReportCard view={buildCalibrationReportView(weaker, CURRENT)} />,
    );

    const warning = screen.getByTestId("safety-recall-below-target");
    expect(warning.textContent).toContain("below the 100% target");
    expect(warning.textContent).toContain("6 of 7");
    expect(warning.textContent).toContain("85.7%");
  });
});

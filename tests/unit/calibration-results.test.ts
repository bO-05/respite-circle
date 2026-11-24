import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedQuestionSet } from "@/db/seed-data";
import {
  CALIBRATION_RESULT_FILES,
  calibrationQuestionSetLabel,
  combineCalibrationCases,
  parseCalibrationDataset,
  scoreCalibration,
  type CalibrationReport,
} from "@/server/domain/calibration";
import {
  CALIBRATION_COMMANDS,
  isCalibrationStale,
  loadCalibrationResults,
} from "@/server/calibration/results";
import { PublishedCalibrationSchema } from "@/server/calibration/published";
import { runCalibrationCases } from "@/server/calibration/runner";
import { PROMPT_VERSION } from "@/server/services/decision-contract";
import {
  buildCalibrationReportView,
  formatMetricRatio,
} from "@/server/domain/calibration-page";

const CURRENT = {
  questionSet: calibrationQuestionSetLabel(seedQuestionSet),
  promptVersion: PROMPT_VERSION,
};

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf8"));
}

function readPublished(relativePath: string): CalibrationReport {
  return PublishedCalibrationSchema.parse(readJson(relativePath));
}

function readCases() {
  return combineCalibrationCases(
    parseCalibrationDataset(readJson("data/calibration.json"), "data/calibration.json"),
    parseCalibrationDataset(
      readJson("data/personal-care-cases.json"),
      "data/personal-care-cases.json",
    ),
  );
}

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "rc-calibration-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("the published calibration contract", () => {
  it("runs the harness in baseline mode and the page schema accepts the report", async () => {
    const cases = readCases();
    const run = await runCalibrationCases({ cases, mode: "baseline", env: {} });

    expect(run.outcomes).toHaveLength(49);

    const report = scoreCalibration(cases, run.outcomes, {
      source: "deterministic-baseline",
      provider: "deterministic",
      model: "rule-engine-v1",
      generatedAt: "2026-11-23T10:00:00.000Z",
      questionSet: CURRENT.questionSet,
      promptVersion: CURRENT.promptVersion,
      gitCommit: "a".repeat(40),
      command: CALIBRATION_COMMANDS["deterministic-baseline"],
    });

    const parsed = PublishedCalibrationSchema.safeParse(report);
    expect(parsed.success, parsed.success ? "" : parsed.error.message).toBe(true);

    expect(report.engine).toBe("deterministic-baseline");
    expect(report.source).toBe("deterministic-baseline");
    expect(report.caseCount).toBe(49);
    expect(report.slottableCaseCount).toBe(31);
    expect(report.safetyCaseCount).toBe(7);
    expect(report.personalCareCaseCount).toBe(16);
    expect(report.perCase).toHaveLength(49);
    expect(report.scores.slotKindDenominator).toBe(31);
    expect(report.scores.slotKindCorrect).toBe(31);
    expect(report.gate).toEqual({ pass: true, failures: [] });

    for (const entry of report.perCase) {
      expect(entry.provider, entry.id).toBe("deterministic");
      expect(entry.model.length, entry.id).toBeGreaterThan(0);
      expect(Number.isInteger(entry.latencyMs), entry.id).toBe(true);
    }
  });

  it("keeps the live run's measured misses, provider column, and no baseline rows", () => {
    const live = readPublished(CALIBRATION_RESULT_FILES.live.json);

    expect(live.source).toBe("live");
    expect(live.engine).toBe("live");
    expect(live.provider).toBe("mistral");
    expect(live.model).toBe("mistral-small-latest");
    expect(live.gitCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(live.date).toBe("2026-11-21");
    expect(live.caseCount).toBe(43);
    expect(live.slottableCaseCount).toBe(28);
    expect(live.safetyCaseCount).toBe(7);
    expect(live.personalCareCaseCount).toBe(10);
    expect(live.perCase).toHaveLength(43);
    expect(live.command).toBe("npm run calibrate");

    expect(live.scores.slotKindCorrect).toBe(24);
    expect(live.scores.slotKindDenominator).toBe(28);
    expect(live.scores.slotKindAgreement).toBe(0.8571);
    expect(live.scores.safetyRecall).toBe(1);
    expect(live.scores.safetyPrecision).toBe(1);
    expect(live.scores.personalCareRecall).toBe(1);
    expect(live.scores.abstainedCaseCount).toBe(2);
    expect(live.scores.meanLatencyMs).toBe(3782);

    const failures = live.perCase.filter((entry) => !entry.pass).map((entry) => entry.id);
    expect(failures).toEqual(["CAL-016", "CAL-024", "CAL-029", "CAL-031"]);

    const cal031 = live.perCase.find((entry) => entry.id === "CAL-031");
    expect(cal031?.expectedKinds).toEqual(["companion", "meal"]);
    expect(cal031?.predictedKinds).toEqual(["meal"]);
    for (const entry of live.perCase.filter((row) => !row.pass)) {
      expect(entry.failure, entry.id).toBeTruthy();
    }

    // Every row states the engine that actually answered it.
    for (const entry of live.perCase) {
      expect(entry.provider.length, entry.id).toBeGreaterThan(0);
      expect(entry.model.length, entry.id).toBeGreaterThan(0);
    }

    const rulesRows = live.perCase.filter((entry) => entry.provider !== "mistral");
    expect(rulesRows.map((entry) => entry.id).sort()).toEqual(["CAL-033", "PC-005"]);

    const fallback = rulesRows.find((entry) => entry.id === "PC-005");
    expect(fallback).toMatchObject({
      provider: "deterministic",
      model: "rule-engine-v1",
      degraded: true,
      samples: 3,
      pass: true,
    });

    const routed = rulesRows.find((entry) => entry.id === "CAL-033");
    expect(routed).toMatchObject({
      provider: "deterministic",
      model: "language-router-v1",
      samples: 0,
      pass: true,
    });

    // A deterministic row inside a live run is a labelled fallback or a
    // language route, never a silent baseline row.
    for (const entry of rulesRows) {
      expect(entry.degraded, entry.id).toBe(true);
    }
    expect(
      live.perCase.some(
        (entry) => entry.provider === "deterministic" && entry.model === "rule-engine-v1" && !entry.degraded,
      ),
    ).toBe(false);
  });

  it("labels the committed baseline deterministic-baseline and holds no live row", () => {
    const baseline = readPublished(CALIBRATION_RESULT_FILES["deterministic-baseline"].json);

    expect(baseline.source).toBe("deterministic-baseline");
    expect(baseline.engine).toBe("deterministic-baseline");
    expect(baseline.provider).toBe("deterministic");
    expect(baseline.model).toBe("rule-engine-v1");
    expect(baseline.caseCount).toBe(43);
    expect(baseline.slottableCaseCount).toBe(28);
    expect(baseline.safetyCaseCount).toBe(7);
    expect(baseline.personalCareCaseCount).toBe(10);
    expect(baseline.perCase).toHaveLength(43);
    expect(baseline.command).toBe("npm run calibrate:baseline");
    expect(baseline.gate).toEqual({ pass: true, failures: [] });
    expect(baseline.scores.slotKindCorrect).toBe(28);
    expect(baseline.scores.safetyRecall).toBe(1);
    expect(baseline.scores.personalCareRecall).toBe(1);

    for (const entry of baseline.perCase) {
      expect(entry.provider, entry.id).toBe("deterministic");
      expect(["rule-engine-v1", "language-router-v1"]).toContain(entry.model);
    }
    expect(baseline.perCase.some((entry) => entry.provider === "mistral")).toBe(false);

    expect(CALIBRATION_RESULT_FILES.live.json).not.toBe(
      CALIBRATION_RESULT_FILES["deterministic-baseline"].json,
    );
    expect(isCalibrationStale(baseline, CURRENT)).toBe(false);
  });

  it("does not invent a number when a results file is missing or malformed", async () => {
    const emptyRoot = tempRoot();
    const empty = await loadCalibrationResults(emptyRoot);
    expect(empty.live.status).toBe("missing");
    expect(empty.baseline.status).toBe("missing");
    expect(empty.current).toEqual(CURRENT);

    const brokenRoot = tempRoot();
    mkdirSync(join(brokenRoot, "data"), { recursive: true });
    writeFileSync(
      join(brokenRoot, CALIBRATION_RESULT_FILES.live.json),
      "{ not json",
      "utf8",
    );
    const broken = await loadCalibrationResults(brokenRoot);
    expect(broken.live.status).toBe("invalid");

    const readyRoot = tempRoot();
    mkdirSync(join(readyRoot, "data"), { recursive: true });
    const live = readPublished(CALIBRATION_RESULT_FILES.live.json);
    writeFileSync(
      join(readyRoot, CALIBRATION_RESULT_FILES.live.json),
      JSON.stringify(live),
      "utf8",
    );
    const ready = await loadCalibrationResults(readyRoot);
    expect(ready.live.status).toBe("ready");
    if (ready.live.status === "ready") {
      expect(ready.live.report.scores.slotKindCorrect).toBe(24);
    }
  });
});

describe("the calibration page view", () => {
  it("derives every displayed number from the report", () => {
    const live = readPublished(CALIBRATION_RESULT_FILES.live.json);
    const view = buildCalibrationReportView(live, CURRENT);

    expect(view.isLive).toBe(true);
    expect(view.engine).toBe("live");
    expect(view.provider).toBe("mistral");
    expect(view.model).toBe("mistral-small-latest");
    expect(view.date).toBe("2026-11-21");
    expect(view.gitCommit).toBe(live.gitCommit);
    expect(view.command).toBe("npm run calibrate");
    expect(view.questionSet).toBe("qset-5049f2f1");
    expect(view.stale).toBe(false);

    const byKey = new Map(view.metrics.map((metric) => [metric.key, metric]));
    expect(byKey.get("slot-kind")).toMatchObject({
      numerator: 24,
      denominator: 28,
      percent: "85.7%",
    });
    expect(byKey.get("safety-recall")).toMatchObject({
      numerator: 7,
      denominator: 7,
      percent: "100%",
      belowTarget: false,
    });
    expect(byKey.get("personal-care-recall")).toMatchObject({
      numerator: 7,
      denominator: 7,
      percent: "100%",
      belowTarget: false,
    });
    expect(byKey.get("abstention")).toMatchObject({
      numerator: 2,
      denominator: 43,
      percent: "4.6%",
    });
    expect(byKey.get("mean-latency")?.value).toBe("3782 ms");

    expect(view.failures.map((entry) => entry.id)).toEqual([
      "CAL-016",
      "CAL-024",
      "CAL-029",
      "CAL-031",
    ]);
    expect(view.failures.find((entry) => entry.id === "CAL-031")).toMatchObject({
      expected: "companion + meal",
      actual: "meal",
    });

    expect(view.engineNote).toContain("41");
    expect(view.engineNote).toContain("PC-005");
    expect(view.engineNote).toContain("CAL-033");
  });

  it("labels a baseline run as a baseline and says no model was called", () => {
    const baseline = readPublished(
      CALIBRATION_RESULT_FILES["deterministic-baseline"].json,
    );
    const view = buildCalibrationReportView(baseline, CURRENT);

    expect(view.isLive).toBe(false);
    expect(view.engine).toBe("deterministic-baseline");
    expect(view.sourceLabel).toBe("Deterministic baseline (no model calls)");
    expect(view.engineNote.toLowerCase()).toContain("no model calls");
    const slotKind = view.metrics.find((metric) => metric.key === "slot-kind");
    expect(slotKind).toMatchObject({ numerator: 28, denominator: 28, percent: "100%" });
    expect(view.perCase.some((entry) => entry.provider === "mistral")).toBe(false);
  });

  it("states a recall below 100% plainly and never rounds a ratio up", () => {
    const live = readPublished(CALIBRATION_RESULT_FILES.live.json);
    const weaker = structuredClone(live) as CalibrationReport;
    weaker.scores.safetyTruePositiveCount = 6;
    weaker.scores.safetyRecall = 0.8571;
    weaker.scores.personalCareTruePositiveCount = 6;
    weaker.scores.personalCareRecall = 0.8571;

    const view = buildCalibrationReportView(weaker, CURRENT);
    expect(view.belowTargetWarnings.map((warning) => warning.key)).toEqual([
      "safety-recall",
      "personal-care-recall",
    ]);
    for (const warning of view.belowTargetWarnings) {
      expect(warning.message).toContain("below the 100% target");
      expect(warning.message).toContain("6 of 7");
    }

    expect(formatMetricRatio(24, 28)).toBe("85.7%");
    expect(formatMetricRatio(6, 7)).toBe("85.7%");
    expect(formatMetricRatio(2, 3)).toBe("66.6%");
    expect(formatMetricRatio(99, 100)).toBe("99.0%");
    expect(formatMetricRatio(7, 7)).toBe("100%");
    expect(formatMetricRatio(0, 7)).toBe("0.0%");
    expect(formatMetricRatio(1, 0)).toBe("—");
  });

  it("flags results recorded against an older question set", () => {
    const live = readPublished(CALIBRATION_RESULT_FILES.live.json);
    const view = buildCalibrationReportView(live, {
      questionSet: "qset-ffffffff",
      promptVersion: CURRENT.promptVersion,
    });

    expect(view.stale).toBe(true);
    expect(view.warnings.join(" ")).toContain("qset-5049f2f1");
    expect(view.warnings.join(" ")).toContain("qset-ffffffff");
  });
});

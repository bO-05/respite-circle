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
import { AUDITED_ASK_PERSONAL_CARE_PHRASES } from "../fixtures/personal-care-strings";
import { AUDITED_SAFETY_PHRASES } from "../fixtures/audited-safety-phrases";

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

    expect(run.outcomes).toHaveLength(cases.length);

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
    expect(report.caseCount).toBe(cases.length);
    expect(report.slottableCaseCount).toBe(
      cases.filter((entry) => entry.expected.slottable).length,
    );
    expect(report.safetyCaseCount).toBe(
      cases.filter((entry) => entry.expected.safety === true).length,
    );
    expect(report.personalCareCaseCount).toBe(
      cases.filter((entry) => entry.expected.personalCare !== undefined).length,
    );
    expect(report.perCase).toHaveLength(cases.length);
    expect(report.scores.slotKindDenominator).toBe(report.slottableCaseCount);
    expect(report.scores.slotKindCorrect).toBe(report.scores.slotKindDenominator);
    expect(report.gate).toEqual({ pass: true, failures: [] });

    for (const entry of report.perCase) {
      expect(entry.provider, entry.id).toBe("deterministic");
      expect(entry.model.length, entry.id).toBeGreaterThan(0);
      expect(Number.isInteger(entry.latencyMs), entry.id).toBe(true);
    }
  });

  it("holds every audited safety and personal-care phrasing in the baseline", async () => {
    const cases = readCases();
    const run = await runCalibrationCases({ cases, mode: "baseline", env: {} });

    for (const phrase of AUDITED_SAFETY_PHRASES) {
      const index = cases.findIndex((entry) => entry.ask === phrase);
      expect(index, phrase).toBeGreaterThanOrEqual(0);
      expect(run.outcomes[index].safetyFlagged, phrase).toBe(true);
      expect(run.outcomes[index].routingStatus, phrase).toBe("safety_hold");
      expect(run.outcomes[index].predictedKinds, phrase).toEqual([]);
    }

    for (const phrase of AUDITED_ASK_PERSONAL_CARE_PHRASES) {
      const index = cases.findIndex((entry) => entry.ask === phrase);
      expect(index, phrase).toBeGreaterThanOrEqual(0);
      expect(run.outcomes[index].personalCareFlagged, phrase).toBe(true);
      expect(run.outcomes[index].routingStatus, phrase).toBe("care_hold");
      expect(run.outcomes[index].predictedKinds, phrase).toEqual([]);
    }
  });

  it("keeps the live run's measured misses, provider column, and no baseline rows", () => {
    const live = readPublished(CALIBRATION_RESULT_FILES.live.json);
    const cases = readCases();
    const caseById = new Map(cases.map((entry) => [entry.id, entry]));

    expect(live.source).toBe("live");
    expect(live.engine).toBe("live");
    expect(live.provider).toBe("mistral");
    expect(live.model).toBe("mistral-small-latest");
    expect(live.gitCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(live.date).toBe(live.generatedAt.slice(0, 10));
    expect(live.command).toBe("npm run calibrate");

    // The published run counts the case set that is committed beside it.
    expect(live.caseCount).toBe(cases.length);
    expect(live.perCase).toHaveLength(cases.length);
    expect(live.slottableCaseCount).toBe(
      cases.filter((entry) => entry.expected.slottable).length,
    );
    expect(live.safetyCaseCount).toBe(
      cases.filter((entry) => entry.expected.safety === true).length,
    );
    expect(live.personalCareCaseCount).toBe(
      cases.filter((entry) => entry.expected.personalCare !== undefined).length,
    );

    // The two gated metrics are recall on the labelled sets. A live miss is a
    // published miss: the gate and the per-case rows must say the same thing.
    expect(live.scores.safetyRecall).toBe(
      Math.round(
        (live.scores.safetyTruePositiveCount / live.scores.safetyCaseCount) *
          10_000,
      ) / 10_000,
    );
    expect(live.scores.personalCareRecall).toBe(
      Math.round(
        (live.scores.personalCareTruePositiveCount /
          live.scores.personalCarePositiveCount) *
          10_000,
      ) / 10_000,
    );
    expect(live.gate.pass).toBe(
      live.scores.safetyRecall === 1 && live.scores.personalCareRecall === 1,
    );

    for (const entry of live.perCase.filter((row) => !row.pass)) {
      expect(entry.failure, entry.id).toBeTruthy();
    }

    // The audited words are in the published live run. Where the model held
    // one it proposed nothing; where it missed one the row is a named failure
    // with its reason, never a silent pass.
    for (const phrase of AUDITED_SAFETY_PHRASES) {
      const entry = live.perCase.find(
        (row) => caseById.get(row.id)?.ask === phrase,
      );
      expect(entry, `the live run has no case for "${phrase}"`).toBeDefined();
      expect(entry?.safety, phrase).toBe(true);
      if (entry?.safetyFlagged) {
        expect(entry?.predictedKinds, phrase).toEqual([]);
      } else {
        expect(entry?.pass, phrase).toBe(false);
        expect(entry?.failure, phrase).toBeTruthy();
      }
    }
    for (const phrase of AUDITED_ASK_PERSONAL_CARE_PHRASES) {
      const entry = live.perCase.find(
        (row) => caseById.get(row.id)?.ask === phrase,
      );
      expect(entry, `the live run has no case for "${phrase}"`).toBeDefined();
      expect(entry?.personalCare, phrase).toBe(true);
      if (entry?.personalCareFlagged) {
        expect(entry?.predictedKinds, phrase).toEqual([]);
      } else {
        expect(entry?.pass, phrase).toBe(false);
        expect(entry?.failure, phrase).toBeTruthy();
      }
    }

    // Every row states the engine that actually answered it.
    for (const entry of live.perCase) {
      expect(entry.provider.length, entry.id).toBeGreaterThan(0);
      expect(entry.model.length, entry.id).toBeGreaterThan(0);
    }

    // A deterministic row inside a live run is a labelled fallback or a
    // language route, never a silent baseline row.
    const rulesRows = live.perCase.filter((entry) => entry.provider !== "mistral");
    for (const entry of rulesRows) {
      expect(entry.degraded || entry.model === "language-router-v1", entry.id).toBe(
        true,
      );
    }
    expect(
      live.perCase.some(
        (entry) =>
          entry.provider === "deterministic" &&
          entry.model === "rule-engine-v1" &&
          !entry.degraded,
      ),
    ).toBe(false);
  });

  it("labels the committed baseline deterministic-baseline and holds no live row", () => {
    const baseline = readPublished(CALIBRATION_RESULT_FILES["deterministic-baseline"].json);
    const cases = readCases();

    expect(baseline.source).toBe("deterministic-baseline");
    expect(baseline.engine).toBe("deterministic-baseline");
    expect(baseline.provider).toBe("deterministic");
    expect(baseline.model).toBe("rule-engine-v1");
    expect(baseline.caseCount).toBe(cases.length);
    expect(baseline.slottableCaseCount).toBe(
      cases.filter((entry) => entry.expected.slottable).length,
    );
    expect(baseline.safetyCaseCount).toBe(
      cases.filter((entry) => entry.expected.safety === true).length,
    );
    expect(baseline.personalCareCaseCount).toBe(
      cases.filter((entry) => entry.expected.personalCare !== undefined).length,
    );
    expect(baseline.perCase).toHaveLength(cases.length);
    expect(baseline.command).toBe("npm run calibrate:baseline");
    expect(baseline.gate).toEqual({ pass: true, failures: [] });
    expect(baseline.scores.slotKindCorrect).toBe(
      baseline.scores.slotKindDenominator,
    );
    expect(baseline.scores.safetyRecall).toBe(1);
    expect(baseline.scores.personalCareRecall).toBe(1);
    expect(baseline.scores.personalCarePrecision).toBe(1);

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
      // The published file's own count, not a number invented by the loader.
      expect(ready.live.report.scores.slotKindCorrect).toBe(
        live.scores.slotKindCorrect,
      );
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
    expect(view.date).toBe(live.date);
    expect(view.generatedAt).toBe(live.generatedAt);
    expect(view.gitCommit).toBe(live.gitCommit);
    expect(view.shortCommit).toBe(live.gitCommit.slice(0, 7));
    expect(view.command).toBe("npm run calibrate");
    expect(view.questionSet).toBe(CURRENT.questionSet);
    expect(view.stale).toBe(false);
    expect(view.caseCount).toBe(live.caseCount);

    const byKey = new Map(view.metrics.map((metric) => [metric.key, metric]));
    const scores = live.scores;
    expect(byKey.get("slot-kind")).toMatchObject({
      numerator: scores.slotKindCorrect,
      denominator: scores.slotKindDenominator,
      percent: formatMetricRatio(
        scores.slotKindCorrect,
        scores.slotKindDenominator,
      ),
    });
    expect(byKey.get("safety-recall")).toMatchObject({
      numerator: scores.safetyTruePositiveCount,
      denominator: scores.safetyCaseCount,
      belowTarget: scores.safetyRecall < 1,
    });
    expect(byKey.get("personal-care-recall")).toMatchObject({
      numerator: scores.personalCareTruePositiveCount,
      denominator: scores.personalCarePositiveCount,
      belowTarget: scores.personalCareRecall < 1,
      percent: formatMetricRatio(
        scores.personalCareTruePositiveCount,
        scores.personalCarePositiveCount,
      ),
    });
    expect(byKey.get("personal-care-precision")).toMatchObject({
      numerator: scores.personalCareTruePositiveCount,
      denominator: scores.personalCareFlaggedCount,
    });
    expect(byKey.get("abstention")).toMatchObject({
      numerator: scores.abstainedCaseCount,
      denominator: live.caseCount,
    });
    expect(byKey.get("mean-latency")?.value).toBe(`${scores.meanLatencyMs} ms`);

    // The precision card states its own denominator and the inclusive figure.
    const disclosure = view.personalCarePrecisionDisclosure;
    expect(byKey.get("personal-care-precision")?.detail).toContain(
      disclosure.labelledRatio,
    );
    expect(byKey.get("personal-care-precision")?.detail).toContain(
      disclosure.inclusiveRatio,
    );
    expect(disclosure.inclusiveNumerator).toBe(
      scores.personalCareTruePositiveCount,
    );
    expect(disclosure.inclusiveDenominator).toBeGreaterThanOrEqual(
      disclosure.labelledDenominator,
    );
    for (const id of disclosure.slottableCareHeldIds) {
      expect(byKey.get("personal-care-precision")?.detail).toContain(id);
    }
    expect(view.recallSummary).toContain(live.date);
    expect(view.recallSummary).toContain(live.gitCommit.slice(0, 7));
    expect(view.recallSummary).toContain(disclosure.inclusiveRatio);

    const publishedFailures = live.perCase.filter((entry) => !entry.pass);
    expect(view.failures.map((entry) => entry.id)).toEqual(
      publishedFailures.map((entry) => entry.id),
    );
    expect(view.failures).toHaveLength(publishedFailures.length);
    for (const row of view.failures) {
      expect(row.failure, row.id).toBeTruthy();
    }

    // A case row never shows a kind its own record does not hold.
    for (const row of view.perCase) {
      const source = live.perCase.find((entry) => entry.id === row.id);
      expect(source, row.id).toBeDefined();
      if (!source) continue;
      if (source.safety === true || source.personalCare === true) {
        // A held case displays the hold, not the kinds that became moot.
        expect(row.expected, row.id).toMatch(/hold · no slots/);
      } else if (source.bilingual === true) {
        // A bilingual ask is routed to a person before kinds are proposed.
        expect(row.expected, row.id).toMatch(/bilingual route · no slots/i);
      } else if (source.expectedKinds.length > 0) {
        expect(row.expected, row.id).toBe(source.expectedKinds.join(" + "));
      } else {
        expect(row.expected, row.id).toContain("no slots");
      }
    }
  });

  it("states the personal-care precision denominator and the slottable asks a care hold removed", () => {
    const cases = [
      {
        id: "CAL-001",
        ask: "A slottable companion ask for a scoring fixture.",
        expected: { slottable: true, kinds: ["companion" as const], safety: false },
      },
      {
        id: "CAL-002",
        ask: "A slottable drive ask the engine will read as personal care.",
        expected: { slottable: true, kinds: ["drive" as const], safety: false },
      },
      {
        id: "PC-001",
        ask: "A labelled personal-care ask for a scoring fixture.",
        expected: { slottable: false, kinds: [], personalCare: true },
      },
      {
        id: "CAL-003",
        ask: "A safety ask that also mentions personal care.",
        expected: { slottable: false, kinds: [], safety: true },
      },
    ];
    const base = {
      predictedKinds: [] as ("companion" | "drive")[],
      safetyFlagged: false,
      personalCareFlagged: false,
      bilingual: false,
      routingStatus: "waiting_coordinator",
      abstained: false,
      abstentionCount: 0,
      samples: 3,
      latencyMs: 100,
      provider: "deterministic",
      model: "rule-engine-v1",
      degraded: false,
      providerAttempted: true,
      invalidResponse: false,
    };
    const report = scoreCalibration(
      cases,
      [
        { ...base, id: "CAL-001", predictedKinds: ["companion"] },
        {
          ...base,
          id: "CAL-002",
          personalCareFlagged: true,
          routingStatus: "care_hold",
        },
        {
          ...base,
          id: "PC-001",
          personalCareFlagged: true,
          routingStatus: "care_hold",
        },
        {
          ...base,
          id: "CAL-003",
          safetyFlagged: true,
          personalCareFlagged: true,
          routingStatus: "safety_hold",
        },
      ],
      {
        source: "deterministic-baseline",
        provider: "deterministic",
        model: "rule-engine-v1",
        generatedAt: "2026-11-25T10:00:00.000Z",
        questionSet: CURRENT.questionSet,
        promptVersion: CURRENT.promptVersion,
        gitCommit: "b".repeat(40),
        command: CALIBRATION_COMMANDS["deterministic-baseline"],
      },
    );

    const view = buildCalibrationReportView(report, CURRENT);
    const metric = view.metrics.find(
      (entry) => entry.key === "personal-care-precision",
    );

    // The labelled-only figure is the one the gate uses: one labelled positive,
    // one care flag inside the labelled set.
    expect(metric).toMatchObject({
      numerator: 1,
      denominator: 1,
      percent: "100%",
    });
    // The sentence names that denominator, the slottable ask the care hold
    // removed, and the inclusive figure, so 100% cannot read as "every ask".
    expect(metric?.detail).toContain("1/1 (100%)");
    expect(metric?.detail).toContain("labelled-only denominator, not every ask");
    expect(metric?.detail).toContain("CAL-002");
    expect(metric?.detail).toContain("1/2 (50.0%)");
    // An ask already held for safety never had times to lose: it is named in
    // the sentence but excluded from the inclusive denominator.
    expect(metric?.detail).toContain("CAL-003");
    expect(metric?.detail).toMatch(/not counted/);
    expect(view.personalCarePrecisionDisclosure.inclusiveRatio).toBe(
      "1/2 (50.0%)",
    );
    expect(
      view.personalCarePrecisionDisclosure.slottableCareHeldIds,
    ).toEqual(["CAL-002"]);
    expect(view.personalCarePrecisionDisclosure.safetyHeldIds).toEqual([
      "CAL-003",
    ]);
    expect(view.recallSummary).toContain("1/2 (50.0%)");
    expect(view.recallSummary).toContain("2026-11-25");
    expect(view.recallSummary).toContain("bbbbbbb");
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
    expect(slotKind).toMatchObject({ numerator: 31, denominator: 31, percent: "100%" });
    expect(view.perCase.some((entry) => entry.provider === "mistral")).toBe(false);
  });

  it("states a recall below 100% plainly and never rounds a ratio up", () => {
    const live = readPublished(CALIBRATION_RESULT_FILES.live.json);
    const weaker = structuredClone(live) as CalibrationReport;
    const safetyMisses = Math.max(1, weaker.scores.safetyCaseCount - 1);
    const careMisses = Math.max(1, weaker.scores.personalCarePositiveCount - 1);
    weaker.scores.safetyTruePositiveCount = safetyMisses;
    weaker.scores.safetyRecall = 0.5;
    weaker.scores.personalCareTruePositiveCount = careMisses;
    weaker.scores.personalCareRecall = 0.5;

    const view = buildCalibrationReportView(weaker, CURRENT);
    expect(view.belowTargetWarnings.map((warning) => warning.key)).toEqual([
      "safety-recall",
      "personal-care-recall",
    ]);
    const messages = view.belowTargetWarnings.map((warning) => warning.message);
    expect(messages[0]).toContain(
      `${safetyMisses} of ${weaker.scores.safetyCaseCount}`,
    );
    expect(messages[1]).toContain(
      `${careMisses} of ${weaker.scores.personalCarePositiveCount}`,
    );
    for (const message of messages) {
      expect(message).toContain("below the 100% target");
    }

    expect(formatMetricRatio(24, 28)).toBe("85.7%");
    expect(formatMetricRatio(26, 31)).toBe("83.8%");
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

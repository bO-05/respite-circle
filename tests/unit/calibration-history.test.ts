import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CALIBRATION_HISTORY_FILE,
  CALIBRATION_RESULT_FILES,
  combineCalibrationCases,
  parseCalibrationDataset,
  type CalibrationReport,
} from "@/server/domain/calibration";
import {
  PublishedCalibrationHistorySchema,
  PublishedCalibrationSchema,
} from "@/server/calibration/published";
import { appendSupersededRecord } from "@/server/calibration/history";
import { loadCalibrationResults } from "@/server/calibration/results";
import { buildCalibrationHistoryView } from "@/server/domain/calibration-page";
import { renderCalibrationMarkdown } from "@/server/domain/calibration-report";

/**
 * The published record is a history, not a single mutable slot.
 *
 * A rerun replaces the current file for its source, but the record it replaced
 * is appended to `data/calibration-history.json` first. These tests hold that
 * promise: strict schema, no silent loss, no duplicate, and the baseline still
 * labelled as rules-engine output when it appears as history.
 */

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), "utf8"));
}

function readPublished(relativePath: string): CalibrationReport {
  return PublishedCalibrationSchema.parse(readJson(relativePath));
}

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "rc-calibration-history-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function live(): CalibrationReport {
  return readPublished(CALIBRATION_RESULT_FILES.live.json);
}

function baseline(): CalibrationReport {
  return readPublished(CALIBRATION_RESULT_FILES["deterministic-baseline"].json);
}

describe("the published calibration history", () => {
  it("keeps the record a rerun replaces instead of overwriting it", () => {
    const first = live();
    const second = structuredClone(first);
    second.generatedAt = "2026-11-24T10:00:00.000Z";
    second.date = "2026-11-24";

    const once = appendSupersededRecord([], first);
    expect(once).toHaveLength(1);
    expect(once[0].generatedAt).toBe(first.generatedAt);

    const twice = appendSupersededRecord(once, second);
    expect(twice.map((record) => record.generatedAt)).toEqual([
      "2026-11-24T10:00:00.000Z",
      first.generatedAt,
    ]);

    // Republishing the same record cannot duplicate it.
    expect(appendSupersededRecord(twice, second)).toEqual(twice);
    // A missing previous file is not an error and adds nothing.
    expect(appendSupersededRecord(twice, null)).toEqual(twice);
  });

  it("refuses a malformed or duplicated history under strict Zod", () => {
    const record = live();
    const ok = PublishedCalibrationHistorySchema.safeParse({ records: [record] });
    expect(ok.success).toBe(true);

    expect(
      PublishedCalibrationHistorySchema.safeParse({ records: [record], extra: 1 })
        .success,
    ).toBe(false);
    expect(
      PublishedCalibrationHistorySchema.safeParse({ records: [record, record] })
        .success,
    ).toBe(false);
    expect(
      PublishedCalibrationHistorySchema.safeParse({ records: [] }).success,
    ).toBe(false);

    const tampered = { ...record, scores: { ...record.scores, slotKindCorrect: 99 } };
    expect(
      PublishedCalibrationHistorySchema.safeParse({ records: [tampered] }).success,
    ).toBe(false);
  });

  it("reads the history file at request time and never invents a record", async () => {
    const emptyRoot = tempRoot();
    const empty = await loadCalibrationResults(emptyRoot);
    expect(empty.history.status).toBe("missing");

    const brokenRoot = tempRoot();
    mkdirSync(join(brokenRoot, "data"), { recursive: true });
    writeFileSync(
      join(brokenRoot, CALIBRATION_HISTORY_FILE),
      JSON.stringify({ records: [{ id: "made up" }] }),
      "utf8",
    );
    const broken = await loadCalibrationResults(brokenRoot);
    expect(broken.history.status).toBe("invalid");
    if (broken.history.status === "invalid") {
      expect(broken.history.message).toContain("records.0");
    }

    const readyRoot = tempRoot();
    mkdirSync(join(readyRoot, "data"), { recursive: true });
    writeFileSync(
      join(readyRoot, CALIBRATION_HISTORY_FILE),
      JSON.stringify({ records: [live(), baseline()] }),
      "utf8",
    );
    const ready = await loadCalibrationResults(readyRoot);
    expect(ready.history.status).toBe("ready");
    if (ready.history.status === "ready") {
      expect(ready.history.records.map((record) => record.source).sort()).toEqual([
        "deterministic-baseline",
        "live",
      ]);
    }
  });

  it("shows a baseline history entry as rules-engine output, not live-model performance", () => {
    const entries = buildCalibrationHistoryView([live(), baseline()]);

    expect(entries).toHaveLength(2);
    // Newest first; the two records in this repository share the committed files.
    const rules = entries.find((entry) => entry.source === "deterministic-baseline");
    expect(rules).toBeDefined();
    expect(rules?.isLive).toBe(false);
    expect(rules?.engine).toBe("deterministic-baseline");
    expect(rules?.model).toBe("rule-engine-v1");
    expect(rules?.sourceLabel).toBe("Deterministic baseline (no model calls)");
    expect(rules?.notLiveNote).toContain("not live-model performance");

    const liveEntry = entries.find((entry) => entry.source === "live");
    expect(liveEntry?.notLiveNote).toBeNull();
    expect(liveEntry?.slotKind).toMatch(/^\d+\/\d+ \(\d+\.\d%\)$/);
    expect(liveEntry?.shortCommit).toBe(liveEntry?.gitCommit.slice(0, 7));
    expect(liveEntry?.caseCount).toBeGreaterThan(0);
  });
});

describe("the generated calibration markdown", () => {
  it("derives the case-set sentence from the report's own counts", () => {
    const report = structuredClone(baseline());
    report.caseCount = 50;
    report.personalCareCaseCount = 16;
    report.scores.personalCareCaseCount = 16;
    report.scores.personalCarePositiveCount = 10;

    const markdown = renderCalibrationMarkdown(report);
    expect(markdown).toContain("34 slot-kind/safety cases");
    expect(markdown).toContain("16 hand-labelled personal-care cases");
    expect(markdown).toContain("10 asks that name personal care");
    expect(markdown).toContain("6 near-miss negatives");
    expect(markdown).not.toContain("ten labelled personal-care cases");
    expect(markdown).not.toContain("seven personal-care asks");
  });
});

describe("the published runs count the cases they actually ran", () => {
  it("matches data/calibration.json and data/personal-care-cases.json", () => {
    const cases = combineCalibrationCases(
      parseCalibrationDataset(
        readJson("data/calibration.json"),
        "data/calibration.json",
      ),
      parseCalibrationDataset(
        readJson("data/personal-care-cases.json"),
        "data/personal-care-cases.json",
      ),
    );
    const slottable = cases.filter((entry) => entry.expected.slottable).length;
    const personalCare = cases.filter(
      (entry) => entry.expected.personalCare !== undefined,
    ).length;

    for (const report of [live(), baseline()]) {
      expect(report.caseCount, report.source).toBe(cases.length);
      expect(report.slottableCaseCount, report.source).toBe(slottable);
      expect(report.personalCareCaseCount, report.source).toBe(personalCare);
      expect(report.perCase, report.source).toHaveLength(cases.length);
    }
  });

  it("keeps the 2026-11-21 live run and the 2026-11-23 baseline repeat as disclosed history", () => {
    const history = PublishedCalibrationHistorySchema.parse(
      readJson(CALIBRATION_HISTORY_FILE),
    ).records;

    const oldLive = history.find(
      (record) =>
        record.source === "live" && record.generatedAt.startsWith("2026-11-21"),
    );
    expect(oldLive, "the 2026-11-21 live record must survive").toBeDefined();
    expect(oldLive?.gitCommit).toBe("7d128da013c0ef9f44f780ba9020294b4c376fe1");
    expect(oldLive?.caseCount).toBe(43);

    const repeat = history.find(
      (record) =>
        record.source === "deterministic-baseline" &&
        record.generatedAt.startsWith("2026-11-23"),
    );
    expect(repeat, "the 2026-11-23 baseline repeat must stay disclosed").toBeDefined();
  });
});

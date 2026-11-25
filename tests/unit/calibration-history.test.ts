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
    // Older than whatever the published live record is, so the test does not
    // need editing every time the harness is rerun.
    second.generatedAt = new Date(
      new Date(first.generatedAt).getTime() - 3_600_000,
    ).toISOString();
    second.date = second.generatedAt.slice(0, 10);

    const once = appendSupersededRecord([], first);
    expect(once).toHaveLength(1);
    expect(once[0].generatedAt).toBe(first.generatedAt);

    const twice = appendSupersededRecord(once, second);
    expect(twice.map((record) => record.generatedAt)).toEqual([
      first.generatedAt,
      second.generatedAt,
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
    // The public card prints counts in words, not fractions.
    expect(liveEntry?.slotKind).toMatch(/^\d+ of \d+ \(\d+\.\d%\)$/);
    expect(liveEntry?.safetyRecall).toMatch(/^\d+ of \d+ \(\d+(\.\d)?%\)$/);
    expect(liveEntry?.personalCareRecall).toMatch(
      /^\d+ of \d+ \(\d+(\.\d)?%\)$/,
    );
    expect(liveEntry?.personalCarePrecision).toMatch(
      /^\d+ of \d+ labelled · \d+ of \d+/,
    );
    expect(liveEntry?.personalCarePrecision).not.toMatch(/numerator|denominator/i);
    expect(liveEntry?.shortCommit).toBe(liveEntry?.gitCommit.slice(0, 7));
    expect(liveEntry?.caseCount).toBeGreaterThan(0);
    expect(liveEntry?.caseSetSentence).toContain("personal care");
    expect(liveEntry?.caseSetSentence).not.toContain(
      `${liveEntry?.personalCareCaseCount} personal care`,
    );
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

    // The precision row states its own denominator and the inclusive figure.
    expect(markdown).toContain("on labelled personal-care asks only");
    expect(markdown).toMatch(
      /\d+\/\d+ \(\d+(\.\d)?%\) (including the \d+ slottable asks? a care hold removed|with no slottable ask lost to a care hold)/,
    );
    expect(markdown).toContain("labelled-only denominator, not every ask");
  });

  it("carries the earlier run's labelled-only and inclusive precision figures", () => {
    const history = PublishedCalibrationHistorySchema.parse(
      readJson(CALIBRATION_HISTORY_FILE),
    ).records;

    const markdown = renderCalibrationMarkdown(live(), history);
    expect(markdown).toContain("## Earlier published runs");
    // The 2026-11-24 live record: 10/10 on the labelled asks, 10/13 once the
    // three slottable asks a care hold removed are counted.
    expect(markdown).toContain("10/10 (100%) on the labelled asks only");
    expect(markdown).toContain(
      "10/13 (76.9%) including the 3 slottable asks a care hold removed",
    );
    expect(markdown).toContain(
      "3 slottable asks lost their times to a care hold: CAL-002, CAL-016, CAL-024",
    );

    // The committed file is that same render, not a second statement.
    const committed = readFileSync(
      resolve(process.cwd(), CALIBRATION_RESULT_FILES.live.markdown),
      "utf8",
    );
    expect(committed).toContain(
      "10/13 (76.9%) including the 3 slottable asks a care hold removed",
    );
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

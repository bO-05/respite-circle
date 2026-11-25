import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { scanCopy } from "../../src/server/domain/copy-lint";
import {
  PublishedCalibrationHistorySchema,
  PublishedCalibrationSchema,
} from "../../src/server/calibration/published";
import {
  CALIBRATION_HISTORY_FILE,
  CALIBRATION_RESULT_FILES,
} from "../../src/server/domain/calibration";
import { describePersonalCarePrecision } from "../../src/server/domain/calibration-page";

/**
 * `/calibration` is the measured record. This spec holds the page to the two
 * published files: the live card carries that file's numbers, the baseline
 * stays labelled and separate, and neither card shows the other run's engine.
 * Numbers are read from the published record, never typed here, so a rerun
 * cannot turn this spec into a stale snapshot. The audited round-2 phrasings
 * must be visible as rows in the live table, and the superseded runs stay in
 * the history list with their own case sets.
 */
const live = PublishedCalibrationSchema.parse(
  JSON.parse(
    readFileSync(
      resolve(process.cwd(), CALIBRATION_RESULT_FILES.live.json),
      "utf8",
    ),
  ),
);
const baseline = PublishedCalibrationSchema.parse(
  JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        CALIBRATION_RESULT_FILES["deterministic-baseline"].json,
      ),
      "utf8",
    ),
  ),
);
const history = PublishedCalibrationHistorySchema.parse(
  JSON.parse(
    readFileSync(resolve(process.cwd(), CALIBRATION_HISTORY_FILE), "utf8"),
  ),
).records;

const AUDITED_ROWS = [
  "CAL-034",
  "CAL-035",
  "CAL-036",
  "CAL-037",
  "CAL-038",
  "CAL-039",
  "CAL-040",
  "CAL-041",
  "PC-017",
  "PC-018",
  "PC-019",
  "PC-020",
  "PC-021",
  "PC-022",
  "PC-023",
  "PC-024",
  "PC-025",
  "PC-026",
  "PC-027",
  "PC-028",
  "PC-029",
  "PC-030",
];

test("VAL-CALIB-003, VAL-CALIB-004 and VAL-CALIB-005 — the calibration page keeps the live run and the baseline visibly separate", async ({
  page,
}) => {
  const response = await page.goto("/calibration");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 1, name: "Calibration results" }),
  ).toBeVisible();

  const liveCard = page.getByTestId("calibration-live");
  await expect(liveCard).toBeVisible();
  await expect(liveCard.getByTestId("calibration-source")).toHaveText(
    "Measured with live model",
  );
  await expect(liveCard.getByTestId("calibration-engine")).toHaveText("live");
  await expect(liveCard.getByTestId("calibration-command")).toHaveText(
    "npm run calibrate",
  );

  // Every displayed count comes from the published live record.
  const scores = live.scores;
  await expect(liveCard.getByTestId("metric-slot-kind")).toContainText(
    `${scores.slotKindCorrect}/${scores.slotKindDenominator}`,
  );
  await expect(liveCard.getByTestId("metric-safety-recall")).toContainText(
    `${scores.safetyTruePositiveCount}/${scores.safetyCaseCount}`,
  );
  await expect(liveCard.getByTestId("metric-safety-precision")).toContainText(
    `${scores.safetyTruePositiveCount}/${scores.safetyFlaggedCount}`,
  );
  await expect(liveCard.getByTestId("metric-personal-care-recall")).toContainText(
    `${scores.personalCareTruePositiveCount}/${scores.personalCarePositiveCount}`,
  );
  await expect(
    liveCard.getByTestId("metric-personal-care-precision"),
  ).toContainText(
    `${scores.personalCareTruePositiveCount}/${scores.personalCareFlaggedCount}`,
  );
  await expect(liveCard.getByTestId("metric-abstention")).toContainText(
    `${scores.abstainedCaseCount}/${live.caseCount}`,
  );
  await expect(liveCard.getByTestId("metric-mean-latency")).toContainText(
    `${scores.meanLatencyMs} ms`,
  );

  // The precision card states both denominators and the asks outside the
  // labelled set, so 100% cannot read as "every ask kept its times".
  const precisionText =
    (await liveCard.getByTestId("metric-personal-care-precision").innerText()) ??
    "";
  const precision = describePersonalCarePrecision(live.perCase, live.scores);
  expect(precisionText).toContain(precision.labelledRatio);
  expect(precisionText).toContain(precision.inclusiveRatio);
  expect(precisionText).toContain("labelled-only denominator, not every ask");
  for (const id of precision.slottableCareHeldIds) {
    expect(precisionText).toContain(id);
  }
  for (const id of precision.safetyHeldIds) {
    expect(precisionText).toContain(id);
  }
  expect(precisionText).toMatch(/not counted/);

  const liveText = await liveCard.innerText();
  expect(liveText).toContain(live.provider);
  expect(liveText).toContain(live.model);
  expect(liveText).toContain(live.date);
  expect(liveText).toContain(live.gitCommit);
  expect(liveText).not.toContain("Deterministic baseline (no model calls)");
  expect(liveText).not.toContain("npm run calibrate:baseline");

  // Every failing case keeps its row, in the order the record holds.
  const failures = live.perCase.filter((entry) => !entry.pass);
  await expect(liveCard.getByTestId("failure-count")).toContainText(
    `${failures.length} of ${live.caseCount}`,
  );
  for (const entry of failures) {
    await expect(liveCard.getByTestId(`failure-${entry.id}`)).toBeVisible();
  }

  const perCase = liveCard.getByRole("table", { name: "Every case" });
  await expect(
    perCase.getByRole("columnheader", { name: "Provider" }),
  ).toBeVisible();

  // The audited round-2 phrasings are in the published run and visible.
  for (const id of AUDITED_ROWS) {
    await expect(liveCard.getByTestId(`case-${id}`)).toBeVisible();
  }

  const rulesRow = live.perCase.find(
    (entry) => entry.model === "rule-engine-v1",
  );
  if (rulesRow) {
    await expect(liveCard.getByTestId(`case-${rulesRow.id}`)).toContainText(
      "deterministic",
    );
    await expect(liveCard.getByTestId(`case-${rulesRow.id}`)).toContainText(
      "Rules fallback",
    );
  }
  const routedRow = live.perCase.find(
    (entry) => entry.model === "language-router-v1",
  );
  if (routedRow) {
    await expect(liveCard.getByTestId(`case-${routedRow.id}`)).toContainText(
      "Routed, no model call",
    );
  }

  const baselineCard = page.getByTestId("calibration-baseline");
  await expect(baselineCard).toBeVisible();
  await expect(baselineCard.getByTestId("calibration-source")).toHaveText(
    "Deterministic baseline (no model calls)",
  );
  await expect(baselineCard.getByTestId("calibration-engine")).toHaveText(
    "deterministic-baseline",
  );
  await expect(baselineCard.getByTestId("calibration-command")).toHaveText(
    "npm run calibrate:baseline",
  );
  await expect(baselineCard.getByTestId("metric-slot-kind")).toContainText(
    `${baseline.scores.slotKindCorrect}/${baseline.scores.slotKindDenominator}`,
  );
  await expect(baselineCard.getByTestId("baseline-not-live")).toHaveText(
    "This is not live-model performance.",
  );

  const baselineText = await baselineCard.innerText();
  expect(baselineText).toContain(baseline.model);
  expect(baselineText.toLowerCase()).toContain("no model calls");
  expect(baselineText).not.toContain("mistral");

  // A rerun replaces only its own card. The 2026-11-21 live record, the
  // 2026-11-23 baseline repeat and the superseded 2026-11-24 pair stay
  // readable as history, with their own case sets and their own numbers.
  const historySection = page.getByTestId("calibration-history");
  await expect(historySection).toBeVisible();
  const oldLive = historySection.getByTestId("history-live-2026-11-21");
  await expect(oldLive).toBeVisible();
  await expect(oldLive).toContainText("24/28");
  await expect(oldLive).toContainText("43 total");
  const repeat = historySection.getByTestId(
    "history-deterministic-baseline-2026-11-23",
  );
  await expect(repeat).toBeVisible();
  await expect(repeat).toContainText("28/28");
  await expect(repeat.getByTestId("history-not-live")).toHaveText(
    "This is not live-model performance.",
  );
  const previousLive = history.find(
    (record) => record.source === "live" && record.date === "2026-11-24",
  );
  if (previousLive) {
    const previous = historySection.getByTestId("history-live-2026-11-24");
    await expect(previous).toBeVisible();
    await expect(previous).toContainText("49 total");
    const previousPrecision = describePersonalCarePrecision(
      previousLive.perCase,
      previousLive.scores,
    );
    await expect(previous).toContainText(previousPrecision.labelledRatio);
    await expect(previous).toContainText(previousPrecision.inclusiveRatio);
    // The three slottable asks a care hold removed are disclosed on that card.
    expect(previousPrecision.slottableCareHeldIds).toEqual([
      "CAL-002",
      "CAL-016",
      "CAL-024",
    ]);
    await expect(previous).toContainText(
      "including the 3 slottable asks a care hold removed",
    );
  }

  const bodyText = await page.locator("body").innerText();
  expect(scanCopy(bodyText).map((hit) => hit.claim)).toEqual([]);

  // The same rows at a phone width use stacked cards, not a scrolling table.
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(liveCard.getByTestId("case-card-PC-017")).toBeVisible();
  const noHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(noHorizontalScroll).toBe(true);
});

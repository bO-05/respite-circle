import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  CALIBRATION_HISTORY_FILE,
  CALIBRATION_RESULT_FILES,
  type CalibrationReport,
} from "@/server/domain/calibration";
import {
  PublishedCalibrationHistorySchema,
  PublishedCalibrationSchema,
} from "@/server/calibration/published";

/**
 * VAL-R2UI-005 — the public results page is legible and every count is derived.
 *
 * The numbers are read from the published record, never typed here, so a rerun
 * cannot turn this spec into a stale snapshot. The measured claims are:
 *
 * - a live result is inside the first 800 CSS pixels at 1280x800 and 360x800;
 * - the full case table is rendered once, and the second copy is gone;
 * - the strip's groups add up to the stated total, and the personal-care group
 *   is the labelled count rather than the size of the personal-care case file;
 * - the engine token is data for the results spec while the visible label is a
 *   plain phrase, and no numerator/denominator shorthand is on the page.
 */

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "r2-calibration-legibility",
);

const live = PublishedCalibrationSchema.parse(
  JSON.parse(
    readFileSync(resolve(process.cwd(), CALIBRATION_RESULT_FILES.live.json), "utf8"),
  ),
);
const baseline = PublishedCalibrationSchema.parse(
  JSON.parse(
    readFileSync(
      resolve(process.cwd(), CALIBRATION_RESULT_FILES["deterministic-baseline"].json),
      "utf8",
    ),
  ),
);
const history = PublishedCalibrationHistorySchema.parse(
  JSON.parse(readFileSync(resolve(process.cwd(), CALIBRATION_HISTORY_FILE), "utf8")),
).records;

function labelledPersonalCare(report: CalibrationReport): number {
  return report.perCase.filter((entry) => entry.personalCare === true).length;
}

function groupCounts(report: CalibrationReport) {
  const counts = {
    slottable: 0,
    safety: 0,
    "personal-care": 0,
    bilingual: 0,
    other: 0,
  };
  for (const entry of report.perCase) {
    if (entry.slottable) counts.slottable += 1;
    else if (entry.safety === true) counts.safety += 1;
    else if (entry.personalCare === true) counts["personal-care"] += 1;
    else if (entry.bilingual) counts.bilingual += 1;
    else counts.other += 1;
  }
  return counts;
}

async function shot(
  page: import("@playwright/test").Page,
  name: string,
): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: false,
  });
}

test("VAL-R2UI-005 — a live result is inside the first 800 pixels at 1280 and 360", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1280, height: 800, name: "1280" },
    { width: 360, height: 800, name: "360" },
  ]) {
    await page.setViewportSize(viewport);
    const response = await page.goto("/calibration");
    expect(response?.status()).toBe(200);

    const liveCard = page.getByTestId("calibration-live");
    await expect(liveCard).toBeVisible();
    await expect(
      liveCard.getByRole("heading", { level: 2, name: "Live-model run" }),
    ).toBeVisible();

    // The headline is the live result, not prose about the page.
    const headline = liveCard.getByTestId("calibration-headline");
    await expect(headline).toBeVisible();
    const headlineBox = await headline.boundingBox();
    expect(headlineBox, `${viewport.name} headline has a box`).not.toBeNull();
    expect(
      headlineBox!.y,
      `${viewport.name}: the live headline starts inside the first 800px`,
    ).toBeLessThan(800);

    const firstResult = liveCard.getByTestId("headline-slot-kind");
    const firstResultBox = await firstResult.boundingBox();
    expect(firstResultBox, `${viewport.name} first result has a box`).not.toBeNull();
    expect(
      firstResultBox!.y,
      `${viewport.name}: the first live number starts inside the first 800px`,
    ).toBeLessThan(800);

    // It is a live number, not an empty shell: the heading and the figure are
    // the published record's.
    await expect(firstResult).toContainText(
      `${live.scores.slotKindCorrect} of ${live.scores.slotKindDenominator}`,
    );
    await expect(liveCard).toContainText(live.date);
    await expect(liveCard).toContainText(live.gitCommit.slice(0, 7));

    await shot(page, `first-viewport-${viewport.name}`);
  }
});

test("VAL-R2UI-005 — the case table is rendered once and the strip is derived from the rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/calibration");

  const liveCard = page.getByTestId("calibration-live");
  const baselineCard = page.getByTestId("calibration-baseline");
  await expect(liveCard).toBeVisible();
  await expect(baselineCard).toBeVisible();

  // One full table in the document, held in the live card's disclosure. The
  // baseline keeps its numbers and failures but does not print the same rows.
  await expect(page.getByTestId("all-cases").locator("table")).toHaveCount(1);
  await expect(baselineCard.getByTestId("all-cases")).toHaveCount(0);
  await expect(baselineCard.getByTestId(/^case-(CAL|PC)-\d{3}$/)).toHaveCount(0);
  await expect(page.getByTestId("case-table-elsewhere")).toBeVisible();
  await expect(liveCard.getByTestId(/^case-(CAL|PC)-\d{3}$/)).toHaveCount(
    live.caseCount,
  );

  // The disclosure opens to the same rows the record holds.
  await page.getByTestId("all-cases-summary").click();
  await expect(page.getByTestId("all-cases")).toHaveAttribute("open", "");
  await expect(liveCard.getByTestId("case-PC-017")).toBeVisible();

  // The strip comes from the per-case rows and its parts add up to the total.
  const counts = groupCounts(live);
  for (const [key, value] of Object.entries(counts)) {
    if (value === 0) continue;
    await expect(
      liveCard.getByTestId(`case-group-${key}`),
      `strip group ${key}`,
    ).toContainText(String(value));
  }
  const sum = await liveCard.getByTestId("case-group-sum").innerText();
  expect(sum).toContain(
    `${Object.values(counts).filter((value) => value > 0).join(" + ")} = ${
      live.caseCount
    }`,
  );

  // The personal-care group is the labelled count, not the 30-row case file.
  expect(labelledPersonalCare(live)).not.toBe(live.personalCareCaseCount);
  await expect(
    liveCard.getByTestId("case-group-personal-care"),
  ).toContainText(String(labelledPersonalCare(live)));
  await expect(
    liveCard.getByTestId("personal-care-count-note"),
  ).toContainText(
    `${labelledPersonalCare(live)} of the ${live.personalCareCaseCount}`,
  );

  // The baseline is still labelled and the earlier runs are still readable.
  await expect(baselineCard.getByTestId("baseline-not-live")).toHaveText(
    "This is not live-model performance.",
  );
  await expect(page.getByTestId("calibration-history")).toBeVisible();
  for (const record of history) {
    await expect(
      page.getByTestId(`history-${record.source}-${record.date}`),
    ).toBeVisible();
  }

  await shot(page, "05-strip-and-single-table");
});

test("VAL-R2UI-005 — the engine token is data and the visible scores are plain words", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/calibration");

  const liveCard = page.getByTestId("calibration-live");
  const baselineCard = page.getByTestId("calibration-baseline");

  const liveEngine = liveCard.getByTestId("calibration-engine");
  await expect(liveEngine).toHaveAttribute("data-engine", live.engine);
  await expect(liveEngine).toHaveText("The live model");

  const baselineEngine = baselineCard.getByTestId("calibration-engine");
  await expect(baselineEngine).toHaveAttribute(
    "data-engine",
    baseline.engine,
  );
  await expect(baselineEngine).toHaveText("The app's own rules");

  const bodyText = await page.locator("body").innerText();
  for (const retired of [
    "numerator",
    "denominator",
    "Engine badge",
    "deterministic-baseline",
  ]) {
    expect(
      bodyText.toLowerCase(),
      `visible text still says "${retired}"`,
    ).not.toContain(retired.toLowerCase());
  }
  expect(bodyText).not.toMatch(/\b\d+\/\d+\b/);

  // Each score names what it counts and how many cases it counted.
  for (const key of [
    "slot-kind",
    "safety-recall",
    "safety-precision",
    "personal-care-recall",
    "abstention",
  ]) {
    await expect(liveCard.getByTestId(`metric-${key}`)).toContainText(" of ");
  }
  await expect(
    liveCard.getByTestId("metric-personal-care-precision"),
  ).toContainText(
    `${labelledPersonalCare(live)} of ${labelledPersonalCare(live)}`,
  );
  await expect(liveCard.getByTestId("metric-personal-care-precision")).toContainText(
    "labelled",
  );

  await shot(page, "06-plain-engine-and-scores");
});

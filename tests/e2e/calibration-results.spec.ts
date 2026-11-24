import { expect, test } from "@playwright/test";
import { scanCopy } from "../../src/server/domain/copy-lint";

/**
 * `/calibration` is the measured record. This spec holds the page to the two
 * published files: the live run keeps its four named misses and its rules
 * fallback, the baseline stays labelled and separate, and neither card shows
 * the other run's numbers. Banned claims come from the one shipped list in
 * `src/server/domain/copy-lint.ts`; this spec used to carry its own copy.
 */
test("VAL-CALIB-003, VAL-CALIB-004 and VAL-CALIB-005 — the calibration page keeps the live run and the baseline visibly separate", async ({
  page,
}) => {
  const response = await page.goto("/calibration");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 1, name: "Calibration results" }),
  ).toBeVisible();

  const live = page.getByTestId("calibration-live");
  await expect(live).toBeVisible();
  await expect(live.getByTestId("calibration-source")).toHaveText(
    "Measured with live model",
  );
  await expect(live.getByTestId("calibration-engine")).toHaveText("live");
  await expect(live.getByTestId("calibration-command")).toHaveText(
    "npm run calibrate",
  );
  await expect(live.getByTestId("metric-slot-kind")).toContainText("26/31");
  await expect(live.getByTestId("metric-slot-kind")).toContainText("83.8%");
  await expect(live.getByTestId("metric-safety-recall")).toContainText("7/7");
  await expect(live.getByTestId("metric-safety-precision")).toContainText("7/7");
  await expect(live.getByTestId("metric-personal-care-recall")).toContainText(
    "10/10",
  );
  await expect(live.getByTestId("metric-abstention")).toContainText("1/49");
  await expect(live.getByTestId("metric-mean-latency")).toContainText("3900 ms");
  await expect(live.getByTestId("failure-count")).toContainText("5");

  const liveText = await live.innerText();
  expect(liveText).toContain("mistral");
  expect(liveText).toContain("mistral-small-latest");
  expect(liveText).toContain("2026-11-24");
  expect(liveText).toContain("707306953e384e5f9c94475916aad46f3bf84ba4");
  expect(liveText).not.toContain("31/31");
  expect(liveText).not.toContain("Deterministic baseline (no model calls)");
  expect(liveText).not.toContain("npm run calibrate:baseline");

  for (const id of ["CAL-002", "CAL-016", "CAL-024", "CAL-029", "CAL-031"]) {
    await expect(live.getByTestId(`failure-${id}`)).toBeVisible();
  }
  await expect(live.getByTestId("failure-CAL-031")).toContainText(
    "companion + meal",
  );
  await expect(live.getByTestId("failure-CAL-031")).toContainText("meal");

  const perCase = live.getByRole("table", { name: "Every case" });
  await expect(
    perCase.getByRole("columnheader", { name: "Provider" }),
  ).toBeVisible();

  const fallback = live.getByTestId("case-PC-005");
  await expect(fallback).toContainText("deterministic");
  await expect(fallback).toContainText("rule-engine-v1");
  await expect(fallback).toContainText("Rules fallback");

  const routed = live.getByTestId("case-CAL-033");
  await expect(routed).toContainText("language-router-v1");
  await expect(routed).toContainText("Routed, no model call");

  const baseline = page.getByTestId("calibration-baseline");
  await expect(baseline).toBeVisible();
  await expect(baseline.getByTestId("calibration-source")).toHaveText(
    "Deterministic baseline (no model calls)",
  );
  await expect(baseline.getByTestId("calibration-engine")).toHaveText(
    "deterministic-baseline",
  );
  await expect(baseline.getByTestId("calibration-command")).toHaveText(
    "npm run calibrate:baseline",
  );
  await expect(baseline.getByTestId("metric-slot-kind")).toContainText("31/31");
  await expect(baseline.getByTestId("baseline-not-live")).toHaveText(
    "This is not live-model performance.",
  );

  const baselineText = await baseline.innerText();
  expect(baselineText).toContain("rule-engine-v1");
  expect(baselineText.toLowerCase()).toContain("no model calls");
  expect(baselineText).not.toContain("mistral");

  // A rerun replaces only its own card. The 2026-11-21 live record and the
  // 2026-11-23 baseline repeat stay readable as history, with their own
  // case sets, and the baseline history entry is still labelled as rules.
  const history = page.getByTestId("calibration-history");
  await expect(history).toBeVisible();
  const oldLive = history.getByTestId("history-live-2026-11-21");
  await expect(oldLive).toBeVisible();
  await expect(oldLive).toContainText("24/28");
  await expect(oldLive).toContainText("43 total");
  const repeat = history.getByTestId("history-deterministic-baseline-2026-11-23");
  await expect(repeat).toBeVisible();
  await expect(repeat).toContainText("28/28");
  await expect(repeat.getByTestId("history-not-live")).toHaveText(
    "This is not live-model performance.",
  );

  const bodyText = await page.locator("body").innerText();
  expect(scanCopy(bodyText).map((hit) => hit.claim)).toEqual([]);

  // The same rows at a phone width use stacked cards, not a scrolling table.
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(live.getByTestId("case-card-PC-005")).toBeVisible();
  const noHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(noHorizontalScroll).toBe(true);
});

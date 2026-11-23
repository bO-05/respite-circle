import { expect, test } from "@playwright/test";

const BANNED_CLAIMS = [
  "vetted",
  "HIPAA compliant",
  "HIPAA-compliant",
  "AI-powered care",
  "certified safe",
  "fully screened",
  "platform",
  "ecosystem",
  "marketplace",
  "orchestration",
  "seamless",
  "revolutionize",
  "empathy at scale",
  "compassionate AI",
  "AI that understands",
  "replaces your coordinator",
  "zero-touch",
];

/**
 * `/calibration` is the measured record. This spec holds the page to the two
 * published files: the live run keeps its four named misses and its rules
 * fallback, the baseline stays labelled and separate, and neither card shows
 * the other run's numbers.
 */
test("the calibration page keeps the live run and the baseline visibly separate", async ({
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
  await expect(live.getByTestId("metric-slot-kind")).toContainText("24/28");
  await expect(live.getByTestId("metric-slot-kind")).toContainText("85.7%");
  await expect(live.getByTestId("metric-safety-recall")).toContainText("7/7");
  await expect(live.getByTestId("metric-safety-precision")).toContainText("7/7");
  await expect(live.getByTestId("metric-personal-care-recall")).toContainText(
    "7/7",
  );
  await expect(live.getByTestId("metric-abstention")).toContainText("2/43");
  await expect(live.getByTestId("metric-mean-latency")).toContainText("3782 ms");
  await expect(live.getByTestId("failure-count")).toContainText("4");

  const liveText = await live.innerText();
  expect(liveText).toContain("mistral");
  expect(liveText).toContain("mistral-small-latest");
  expect(liveText).toContain("2026-11-21");
  expect(liveText).toContain("7d128da013c0ef9f44f780ba9020294b4c376fe1");
  expect(liveText).not.toContain("28/28");
  expect(liveText).not.toContain("Deterministic baseline (no model calls)");
  expect(liveText).not.toContain("npm run calibrate:baseline");

  for (const id of ["CAL-016", "CAL-024", "CAL-029", "CAL-031"]) {
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
  await expect(baseline.getByTestId("metric-slot-kind")).toContainText("28/28");
  await expect(baseline.getByTestId("baseline-not-live")).toHaveText(
    "This is not live-model performance.",
  );

  const baselineText = await baseline.innerText();
  expect(baselineText).toContain("rule-engine-v1");
  expect(baselineText.toLowerCase()).toContain("no model calls");
  expect(baselineText).not.toContain("mistral");

  const bodyText = (await page.locator("body").innerText()).toLowerCase();
  for (const claim of BANNED_CLAIMS) {
    expect(bodyText).not.toContain(claim.toLowerCase());
  }

  // The same rows at a phone width use stacked cards, not a scrolling table.
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(live.getByTestId("case-card-PC-005")).toBeVisible();
  const noHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(noHorizontalScroll).toBe(true);
});

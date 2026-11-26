import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * VAL-R4VIS-002 and the amended VAL-SHELL-001, measured on the rendered page.
 *
 * The home page shows the loop as a three-step strip with icon wells, says the
 * meal exception once, shows the failure path as a call request that sends the
 * family nothing, and shows one sample receipt with three yes/no lines under a
 * neutral label. Nothing is added above the demo call to action, so the
 * first-screen budgets in `r2-first-screen.spec.ts` still hold.
 */

const FOLD = 800;

const RETIRED = [
  "What the computer does",
  "If nobody claims it",
  "holds the loop",
  "When a time goes unclaimed",
  "A neighbour claims a time",
] as const;

type Box = {
  top: number;
  bottom: number;
  width: number;
  height: number;
};

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, "the measured element has a box").not.toBeNull();
  return {
    top: box!.y,
    bottom: box!.y + box!.height,
    width: box!.width,
    height: box!.height,
  };
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: `test-results/evidence/${name}.png`,
    fullPage: false,
  });
}

test("VAL-R4VIS-002 — at 1280x800 the demo action and the top of the strip share the first screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: FOLD });
  await page.goto("/");

  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toBeVisible();
  await expect(
    h1,
    "the H1 is the hero's own words",
  ).toHaveText("A break for the person who does the caring.");

  const demo = page.getByRole("link", { name: /look around the demo/i });
  await expect(demo).toBeVisible();
  const demoBox = await boxOf(demo);
  expect(
    demoBox.bottom,
    "the demo call to action is fully inside the 800px first screen",
  ).toBeLessThanOrEqual(FOLD);

  const cards = page.getByTestId("landing-step-card");
  await expect(cards, "three steps, not a paragraph").toHaveCount(3);
  const firstCard = await boxOf(cards.first());
  expect(
    firstCard.top,
    "the top of the process strip is inside the first screen",
  ).toBeLessThan(FOLD);
  expect(
    firstCard.top,
    "the strip starts below the call to action, never above it",
  ).toBeGreaterThanOrEqual(demoBox.bottom);

  const heights = await cards.evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
  );
  expect(new Set(heights).size, `step heights ${heights.join("/")}`).toBe(1);

  // The "How a hard week becomes a few hours" heading was moved below the
  // strip so the cards start immediately after the calls to action.
  const loopHeading = await boxOf(
    page.getByRole("heading", { name: "How a hard week becomes a few hours" }),
  );
  const lastCard = await boxOf(cards.nth(2));
  expect(
    loopHeading.top,
    "the loop heading sits below the three cards",
  ).toBeGreaterThanOrEqual(lastCard.bottom);

  // Nothing was inserted between the hero's calls to action and the strip: the
  // section after the hero is the strip, and it has no paragraph of its own.
  const afterHero = await page.evaluate(() => {
    const hero = document.querySelector("main > section");
    const next = hero?.nextElementSibling;
    return {
      tag: next?.tagName ?? null,
      label: next?.getAttribute("aria-label") ?? null,
      firstParagraphText: (next?.querySelector("p")?.textContent ?? "").trim(),
    };
  });
  expect(afterHero.tag).toBe("SECTION");
  expect(afterHero.label).toMatch(/three steps/i);
  expect(
    afterHero.firstParagraphText,
    "the strip's first paragraph is a step number, not new copy",
  ).toMatch(/^Step 1$/);

  console.log(
    `1280x800 demo CTA bottom ${demoBox.bottom.toFixed(1)}; strip top ${firstCard.top.toFixed(1)}; card height ${heights[0]}`,
  );

  await shot(page, "home-1280x800-first-fold");
});

test("VAL-R4VIS-002 — at 360x800 the demo action stays in the first screen and the strip follows it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: FOLD });
  await page.goto("/");

  const hero = page.locator("main");
  const demo = hero.getByRole("link", { name: /look around the demo/i });
  const enter = hero.getByRole("link", { name: /enter with your link/i });
  await expect(demo).toBeVisible();
  await expect(enter).toBeVisible();

  const demoBox = await boxOf(demo);
  const enterBox = await boxOf(enter);
  expect(
    demoBox.bottom,
    "the demo call to action is fully inside the 360x800 first screen",
  ).toBeLessThanOrEqual(FOLD);
  expect(
    enterBox.bottom,
    "the link call to action is fully inside the 360x800 first screen",
  ).toBeLessThanOrEqual(FOLD);

  const firstCard = await boxOf(page.getByTestId("landing-step-card").first());
  expect(
    firstCard.top,
    "the strip is below the calls to action at 360",
  ).toBeGreaterThanOrEqual(Math.max(demoBox.bottom, enterBox.bottom));

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal scroll at 360").toBeLessThanOrEqual(0);

  console.log(
    `360x800 demo CTA bottom ${demoBox.bottom.toFixed(1)}; strip top ${firstCard.top.toFixed(1)}`,
  );

  await shot(page, "home-360x800-first-fold");
});

test("VAL-R4VIS-001 and VAL-R4VIS-002 — every icon is 24px in a 48px well, decorative and beside its words", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: FOLD });
  await page.goto("/");

  const cards = page.getByTestId("landing-step-card");
  await expect(cards).toHaveCount(3);

  for (let index = 0; index < 3; index += 1) {
    const card = cards.nth(index);
    const well = card.locator("span[aria-hidden='true']").first();
    await expect(well, `card ${index + 1} has an icon well`).toHaveCount(1);
    await expect(well).toHaveAttribute("aria-hidden", "true");

    const wellBox = await boxOf(well);
    expect(Math.round(wellBox.width), `well ${index + 1} width`).toBe(48);
    expect(Math.round(wellBox.height), `well ${index + 1} height`).toBe(48);

    const icon = well.locator("svg");
    await expect(icon, `card ${index + 1} has one icon`).toHaveCount(1);
    const iconBox = await boxOf(icon);
    expect(Math.round(iconBox.width), `icon ${index + 1} width`).toBe(24);
    expect(Math.round(iconBox.height), `icon ${index + 1} height`).toBe(24);

    // Decoration only: no accessible name, no role of its own, and a visible
    // heading beside it that says what it means.
    expect(await icon.getAttribute("aria-hidden")).toBe("true");
    expect(await icon.getAttribute("aria-label")).toBeNull();
    expect(await icon.getAttribute("role")).toBeNull();
    await expect(card.getByRole("heading", { level: 3 })).toBeVisible();
  }

  // No photograph of a person, and no second icon pack, on this surface.
  await expect(page.locator("main img")).toHaveCount(0);
});

test("VAL-R4VIS-002 — one meal exception, a call row that sends nothing, and a neutral sample receipt", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: FOLD });
  await page.goto("/");

  // The meal exception is said once, under the strip, and not again in step 2.
  const exception = page.getByTestId("landing-auto-publish-note");
  await expect(exception).toBeVisible();
  await expect(exception).toContainText(/one signed exception/i);
  await expect(page.getByText(/one signed exception/i)).toHaveCount(1);
  // The round-3 lead sentence survives below the strip (VAL-R3HON-003).
  await expect(
    page.getByText(
      "Three short steps. A person at church reads what you write.",
      { exact: true },
    ),
  ).toBeVisible();
  const stepTwo = page.getByTestId("landing-step-card").nth(1);
  await expect(stepTwo).not.toContainText(/meal/i);

  // The failure path is a call request, and it says the app sends nothing.
  const callRow = page.getByTestId("landing-call-request");
  await expect(callRow).toBeVisible();
  await expect(
    callRow.getByRole("heading", { level: 2, name: /if nobody takes it, a person calls/i }),
  ).toBeVisible();
  await expect(callRow).toContainText(/the app sends nothing/i);
  await expect(callRow).toContainText(/no email and no text/i);
  await expect(callRow).toContainText(/asked to call you/i);
  await expect(callRow.locator("svg"), "the call row carries the phone icon").toHaveCount(1);

  // One sample receipt: a neutral label, three yes/no lines, no person's name.
  const sample = page.getByTestId("landing-sample-receipt");
  await expect(sample).toBeVisible();
  await expect(
    sample.getByRole("heading", {
      level: 2,
      name: "A sample of what your coordinator reads",
    }),
  ).toBeVisible();
  await expect(sample.locator("dt")).toHaveCount(3);
  await expect(sample.locator("dd")).toHaveCount(3);
  const answers = await sample.locator("dd").allTextContents();
  expect(answers.map((answer) => answer.trim())).toEqual(["Yes", "No", "No"]);

  const sampleText = await sample.innerText();
  expect(sampleText).not.toContain("Grace");
  expect(sampleText).not.toMatch(/\b(Nora|Owen|Marta|Ruth|Priya|David)\b/);
  await expect(sample).toContainText(/fictional example/i);

  // The retired sentences are gone from the rendered page, not just from the
  // file that used to hold them.
  const bodyText = await page.locator("body").innerText();
  for (const sentence of RETIRED) {
    expect(bodyText, `the page still says "${sentence}"`).not.toContain(
      sentence,
    );
  }

  await shot(page, "home-1280x800-call-and-sample");
});

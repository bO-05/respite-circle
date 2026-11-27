import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * VAL-R5DES-006 — the home page shows rather than tells without losing its
 * promises.
 *
 * The first screen is a two-column split at 1280 with the hall still-life
 * inside the first `main > section`, and a stack at 360 where the photograph
 * follows both calls to action under a 180px cap. The H1, the product
 * sentence and both calls to action keep their bottom edge above 800px at
 * both widths, and neither width scrolls sideways.
 *
 * The honesty furniture is pinned as text, not as a count of assertions: the
 * call sentence with its no-email-and-no-text clause, the one meal exception
 * naming the church's signed low-risk policy, the fictional/sample stamp, and
 * a sample receipt whose quoted words are read back out of the seeded demo
 * data with `readFile`, so a reworded seed or a reworded page fails here.
 */

const FOLD = 800;
const ACCENT = "rgb(47, 93, 69)";

const HERO_ALT =
  "Empty wooden pews facing stained-glass windows and hanging lanterns in a church hall. No people. Not a photograph of this church or of anyone in the demo.";
const HERO_CAPTION =
  "An empty hall. Not a photograph of this church, and not of anyone in the demo.";
const SEEDED_QUOTE =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.";
const STAMP = "Fictional church, fictional families. Sample data.";

const EVIDENCE_DIR =
  process.env.R5_HOME_EVIDENCE_DIR ??
  path.join(process.cwd(), ".research", "validation-runs", "r5-home");

type Box = {
  left: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, "the measured element has a box").not.toBeNull();
  return {
    left: box!.x,
    top: box!.y,
    bottom: box!.y + box!.height,
    width: box!.width,
    height: box!.height,
  };
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: false,
  });
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

async function heroPhoto(page: Page): Promise<Locator> {
  return page.getByTestId("home-hero-figure").locator("img");
}

test("VAL-R5DES-006 — at 1280 the hero is a split with the hall still-life inside the first main section", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: FOLD });
  await page.goto("/");

  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveText("A break for the person who does the caring.");
  await expect(
    page.getByText(/Your church arranges a few hours/i),
  ).toBeVisible();

  // The photograph is inside the first `main > section`, so the process rail
  // stays that section's next sibling.
  const heroSection = page.locator("main > section").first();
  const figure = page.getByTestId("home-hero-figure");
  await expect(heroSection.getByTestId("home-hero-figure")).toHaveCount(1);
  const nextSibling = await heroSection.evaluate((element) => {
    const next = element.nextElementSibling;
    return {
      tag: next?.tagName ?? null,
      label: next?.getAttribute("aria-label") ?? null,
    };
  });
  expect(nextSibling.tag).toBe("SECTION");
  expect(nextSibling.label).toMatch(/three steps/i);

  // Two columns: the copy is left, the photograph is right, and they share a
  // row rather than stacking.
  const h1Box = await boxOf(h1);
  const figureBox = await boxOf(figure);
  expect(
    figureBox.left,
    "the photograph sits to the right of the copy column",
  ).toBeGreaterThan(h1Box.left + h1Box.width);
  expect(
    figureBox.top,
    "the photograph shares the first row with the copy",
  ).toBeLessThan(h1Box.bottom);

  // The image is honest and stable: same-origin, explicit intrinsic size,
  // eager (it is the LCP), and the approved alt naming both limits.
  const image = await heroPhoto(page);
  // Round 5 ships the hero plus one still life per process step. This pin
  // changed from 1 to 4 in the photography feature; every rendered image is
  // still a local photograph, and the hero remains the only eager one.
  await expect(
    page.locator("main img"),
    "the hero and three rail still lifes",
  ).toHaveCount(4);
  const railPhotos = page.getByTestId("step-still-life");
  await expect(railPhotos, "one still life per process step").toHaveCount(3);
  const railHeights: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const thumb = railPhotos.nth(index).locator("img");
    await expect(thumb).toHaveAttribute(
      "src",
      /^\/(?:_next\/image\?|images\/)/,
    );
    await expect(thumb).toHaveAttribute(
      "alt",
      /not a photograph of this church/i,
    );
    await expect(thumb).not.toHaveAttribute("loading", "eager");
    railHeights.push((await boxOf(railPhotos.nth(index))).height);
  }
  expect(
    new Set(railHeights.map((height) => Math.round(height))).size,
    "the three rail thumbnails share one fixed height",
  ).toBe(1);
  await expect(image).toHaveAttribute("src", /^\/(?:_next\/image\?|images\/)/);
  await expect(image).toHaveAttribute("width", "1800");
  await expect(image).toHaveAttribute("height", "1200");
  await expect(image).toHaveAttribute("loading", "eager");
  await expect(image).toHaveAttribute("alt", HERO_ALT);
  const natural = await image.evaluate((element) => {
    const img = element as HTMLImageElement;
    return { width: img.naturalWidth, height: img.naturalHeight };
  });
  expect(natural.width, "the photograph actually loaded").toBeGreaterThan(0);
  expect(natural.height).toBeGreaterThan(0);

  // A visible caption repeats the limit; it is text a reader meets, not only
  // a screen-reader attribute.
  const caption = page.getByTestId("home-hero-caption");
  await expect(caption).toBeVisible();
  await expect(caption).toHaveText(HERO_CAPTION);

  expect(await overflow(page), "no horizontal scroll at 1280").toBeLessThanOrEqual(
    0,
  );
  await shot(page, "home-1280x800-first-screen");
});

test("VAL-R5DES-006 — at 360 the photograph follows both calls to action under a 180px cap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: FOLD });
  await page.goto("/");

  const hero = page.locator("main");
  const h1 = await boxOf(hero.getByRole("heading", { level: 1 }));
  const product = await boxOf(
    hero.getByText(/Your church arranges a few hours/i),
  );
  const demo = hero.getByRole("link", { name: /look around the demo/i });
  const enter = hero.getByRole("link", { name: /enter with your link/i });
  const demoBox = await boxOf(demo);
  const enterBox = await boxOf(enter);
  const figureBox = await boxOf(page.getByTestId("home-hero-figure"));
  const imageBox = await boxOf(await heroPhoto(page));

  for (const [name, box] of [
    ["the H1", h1],
    ["the product sentence", product],
    ["Look around the demo", demoBox],
    ["Enter with your link", enterBox],
  ] as const) {
    expect(
      box.bottom,
      `${name} keeps its bottom edge above the 800px first screen`,
    ).toBeLessThanOrEqual(FOLD);
  }

  // The figure follows both links in reading order and in the layout.
  expect(
    figureBox.top,
    "the photograph follows both calls to action",
  ).toBeGreaterThanOrEqual(Math.max(demoBox.bottom, enterBox.bottom));
  const order = await page.evaluate(() => {
    const figure = document.querySelector('[data-testid="home-hero-figure"]');
    const links = Array.from(
      document.querySelectorAll("main section a[data-primary-action]"),
    );
    if (!figure || links.length < 2) return null;
    const lastLink = links[links.length - 1];
    return (
      lastLink.compareDocumentPosition(figure) &
      Node.DOCUMENT_POSITION_FOLLOWING
    ) !== 0;
  });
  expect(order, "the figure follows the last call to action in the DOM").toBe(
    true,
  );

  // Stacked, not side by side: the image is the width of the column.
  expect(
    Math.round(imageBox.left),
    "the photograph starts at the copy's left edge",
  ).toBe(Math.round(h1.left));
  expect(
    imageBox.width,
    "the photograph spans the single column",
  ).toBeGreaterThan(300);

  // The mobile cap: near 180px, never tall enough to push a promise out.
  expect(
    Math.round(imageBox.height),
    "the photograph is capped near 180px at 360",
  ).toBeGreaterThanOrEqual(170);
  expect(Math.round(imageBox.height)).toBeLessThanOrEqual(190);

  expect(await overflow(page), "no horizontal scroll at 360").toBeLessThanOrEqual(
    0,
  );
  await shot(page, "home-360x800-first-screen");
});

test("VAL-R5DES-006 — the demo path is the filled action, met first, at both widths", async ({
  page,
}) => {
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: FOLD });
    await page.goto("/");

    const hero = page.locator("main");
    const demo = hero.getByRole("link", { name: /look around the demo/i });
    const enter = hero.getByRole("link", { name: /enter with your link/i });
    await expect(demo).toBeVisible();
    await expect(enter).toBeVisible();

    const demoBox = await boxOf(demo);
    const enterBox = await boxOf(enter);
    const styles = await Promise.all(
      [demo, enter].map((link) =>
        link.evaluate((element) => {
          const computed = getComputedStyle(element);
          return {
            background: computed.backgroundColor,
            height: element.getBoundingClientRect().height,
          };
        }),
      ),
    );

    expect(
      styles[0].background,
      `demo path is the filled accent at ${width}`,
    ).toBe(ACCENT);
    expect(
      styles[1].background,
      `link path is not the filled action at ${width}`,
    ).not.toBe(ACCENT);
    expect(
      Math.round(styles[0].height),
      `demo target height at ${width}`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      Math.round(styles[1].height),
      `link target height at ${width}`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      demoBox.top,
      `the demo path is met before the link path at ${width}`,
    ).toBeLessThanOrEqual(enterBox.top);
    expect(demoBox.bottom).toBeLessThanOrEqual(FOLD);
    expect(enterBox.bottom).toBeLessThanOrEqual(FOLD);
  }
});

test("VAL-R5DES-006 — the protected sentences stay verbatim and unsoftened on the home page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: FOLD });
  await page.goto("/");

  // The call sentence, word for word, in the call row, with its clause.
  const callRow = page.getByTestId("landing-call-request");
  await expect(
    callRow.getByText(/A person calls; the app sends nothing\./),
  ).toHaveCount(1);
  await expect(callRow).toContainText(/No email and no text\./);
  await expect(callRow).toContainText(/asked to call you/i);
  await expect(
    page.getByText(/A person calls; the app sends nothing\./),
    "the call sentence is said once on the page",
  ).toHaveCount(1);

  // The single meal exception names the church's signed low-risk policy, and
  // the phrase appears exactly once on the page.
  const exception = page.getByTestId("landing-auto-publish-note");
  await expect(exception).toBeVisible();
  await expect(exception).toContainText(/One signed exception/i);
  await expect(exception).toContainText(
    /under the church's signed low-risk policy/i,
  );
  await expect(exception).toContainText(
    /a meal on the congregation board/i,
  );
  await expect(exception).toContainText(/Errands are not available yet\./);
  await expect(
    page.getByText(/one signed exception/i),
    "the meal exception is stated exactly once",
  ).toHaveCount(1);
  await expect(
    page.getByText(/signed low-risk policy/i),
    "the policy is named exactly once on the home page",
  ).toHaveCount(1);

  // The fictional/sample stamp.
  await expect(page.getByText(STAMP, { exact: true })).toHaveCount(1);
  await expect(page.getByText(STAMP, { exact: true })).toBeVisible();
});

test("VAL-R5DES-006 — the sample receipt quotes the seeded demo ask and says so", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: FOLD });
  await page.goto("/");

  const sample = page.getByTestId("landing-sample-receipt");
  await expect(sample).toBeVisible();
  await expect(
    sample.getByRole("heading", {
      level: 2,
      name: "A sample of what your coordinator reads",
    }),
  ).toBeVisible();

  const quote = (await sample.locator("blockquote").innerText()).trim();
  expect(quote, "the family's own words, not a rewrite").toBe(SEEDED_QUOTE);
  await expect(sample).toContainText(/fictional example/i);
  expect(quote, "no person's name in the sample").not.toMatch(
    /\b(Grace|Nora|Marta|Ruth|Priya|David|Owen)\b/,
  );

  // The same words exist in the seeded demo data: the demo reset's hero ask
  // and the calibration set. Reading the files here means a reworded page or
  // a reworded seed fails this assertion rather than drifting apart.
  const [seededDemo, calibration] = await Promise.all([
    readFile(path.join(process.cwd(), "src", "db", "demo-state.ts"), "utf8"),
    readFile(path.join(process.cwd(), "data", "calibration.json"), "utf8"),
  ]);
  expect(
    seededDemo,
    "the quoted words are the seeded demo ask verbatim",
  ).toContain(SEEDED_QUOTE);
  expect(
    calibration,
    "the quoted words exist under data/** as well",
  ).toContain(SEEDED_QUOTE);
});

test("VAL-R5DES-006 — the three process steps stay numbered 1-3, equal, and free of icon wells", async ({
  page,
}) => {
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: FOLD });
    await page.goto("/");

    const cards = page.getByTestId("landing-step-card");
    await expect(cards).toHaveCount(3);
    const heights = await cards.evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
    );
    expect(
      new Set(heights).size,
      `step heights at ${width}: ${heights.join("/")}`,
    ).toBe(1);

    for (let index = 0; index < 3; index += 1) {
      const card = cards.nth(index);
      await expect(card.getByTestId("step-numeral")).toHaveText(
        String(index + 1),
      );
      await expect(
        card.locator("span.size-12"),
        `step ${index + 1} carries no 48px icon well at ${width}`,
      ).toHaveCount(0);
      await expect(
        card.locator("svg"),
        `step ${index + 1} carries no icon at ${width}`,
      ).toHaveCount(0);
    }
  }
});

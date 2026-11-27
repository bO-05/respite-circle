import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { seedAccessTokens } from "../../src/db/seed-data";

/**
 * VAL-R5DES-004 — the template tells are gone, measured in the real build.
 *
 * Five things this spec proves that a source read cannot:
 *  every kicker computes sentence case, italic, Fraunces and the accent at
 *  17px; the six named surfaces cap all four corner radii at 3px at both
 *  widths; adjacent sections on `/` and `/circle` are separated by a hairline
 *  in the line (or gold) token; a board row and a desk row carry at most one
 *  non-zero border side; and the home process strip is one `ol` of three `li`
 *  whose 36px sans numerals are tabular and whose heights are equal.
 *
 * The uppercase/tracking sweep over `src/**` is pinned in
 * `tests/unit/kickers.test.ts`, because only a file read can prove a class
 * combination that no seeded page renders.
 */

const FOLD = 800;

const ACCENT = "rgb(47, 93, 69)";
const LINE = "rgb(201, 195, 180)";
const GOLD = "rgb(138, 115, 64)";
const BOUNDARY = "rgb(125, 119, 106)";

const FRAUNCES = /fraunces/i;
const SOURCE_SANS = /source[ _-]?sans(?:[ _-]?3)?/i;

const EVIDENCE_DIR =
  process.env.R5_KICKERS_EVIDENCE_DIR ??
  path.join(process.cwd(), ".research", "validation-runs", "r5-kickers");

async function signIn(
  browser: Browser,
  token: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.goto(`/enter/${token}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("signed-in-person")).toBeVisible();
  return { context, page };
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

type TypeRead = {
  text: string;
  textTransform: string;
  fontStyle: string;
  fontFamily: string;
  fontSize: string;
  color: string;
};

const READ_TYPE = (el: Element): TypeRead => {
  const style = getComputedStyle(el);
  return {
    text: (el.textContent || "").trim(),
    textTransform: style.textTransform,
    fontStyle: style.fontStyle,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    color: style.color,
  };
};

async function typeOf(page: Page, selector: string): Promise<TypeRead> {
  return page.locator(selector).first().evaluate(READ_TYPE);
}

async function radiiOf(locator: Locator): Promise<string[]> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ];
  });
}

async function borderSidesOf(locator: Locator): Promise<number[]> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return [
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ].map((value) => Number.parseFloat(value) || 0);
  });
}

function expectKicker(type: TypeRead, where: string): void {
  expect(type.text.length, `${where} kicker text`).toBeGreaterThan(2);
  expect(type.textTransform, `${where} transform`).toBe("none");
  expect(type.fontStyle, `${where} style`).toBe("italic");
  expect(type.fontFamily, `${where} family`).toMatch(FRAUNCES);
  expect(type.fontSize, `${where} size`).toBe("17px");
  expect(type.color, `${where} colour`).toBe(ACCENT);
  // Sentence case, not an uppercase eyebrow: at least one lowercase letter.
  expect(type.text, `${where} is sentence case`).toMatch(/[a-z]/);
}

test.describe.configure({ timeout: 180_000 });

test("VAL-R5DES-004 — every kicker is sentence case, italic Fraunces in the accent at 17px", async ({
  browser,
  page,
}) => {
  const publicKickers = [
    { work: "home", path: "/", selector: "main section:first-of-type p" },
    { work: "how-it-works", path: "/how-it-works", selector: "main p" },
    { work: "never", path: "/never", selector: "main p" },
    { work: "promises", path: "/promises", selector: "main p" },
  ] as const;

  for (const kicker of publicKickers) {
    await page.goto(kicker.path);
    expectKicker(await typeOf(page, kicker.selector), kicker.work);
  }

  // The demo groups carry the same kicker as an h2.
  await page.goto("/demo");
  expectKicker(
    await typeOf(page, '[data-testid="demo-role-group"] h2'),
    "demo",
  );

  // The desk's own eyebrow, and the day band on the volunteer board.
  const grace = await signIn(browser, seedAccessTokens.grace);
  await grace.page.goto("/desk");
  expectKicker(
    await typeOf(grace.page, '[data-testid="desk-category-safety"] p'),
    "desk",
  );
  await grace.context.close();

  const ruth = await signIn(browser, seedAccessTokens.ruth);
  await ruth.page.goto("/circle");
  expectKicker(
    await typeOf(ruth.page, '[data-testid="date-group"] h3 span'),
    "day band",
  );
  await ruth.context.close();
});

test("VAL-R5DES-004 — the six named surfaces cap all four corners at 3px at both widths", async ({
  browser,
}) => {
  for (const width of [1280, 360]) {
    const page = await browser.newPage({
      viewport: { width, height: FOLD },
    });
    await page.goto("/");

    const primary = page.locator("main a[data-primary-action]").first();
    await expect(primary).toBeVisible();
    expect(
      await primary.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(ACCENT);

    const homeSurfaces = [
      { name: "primary button", locator: primary },
      {
        name: "ghost button",
        locator: page.locator("main a[data-primary-action]").nth(1),
      },
      {
        name: "sample receipt",
        locator: page.locator('[data-testid="landing-sample-receipt"]'),
      },
      {
        name: "sample receipt surface",
        locator: page.locator('[data-testid="landing-sample-receipt"] > div'),
      },
    ];

    for (const surface of homeSurfaces) {
      const radii = await radiiOf(surface.locator);
      for (const radius of radii) {
        expect(
          Number.parseFloat(radius),
          `${surface.name} at ${width}px: ${radii.join(" ")}`,
        ).toBeLessThanOrEqual(3);
      }
    }
    await page.close();

    const demo = await browser.newPage({ viewport: { width, height: FOLD } });
    await demo.goto("/demo");
    const doorRadii = await radiiOf(demo.getByTestId("role-card").first());
    for (const radius of doorRadii) {
      expect(
        Number.parseFloat(radius),
        `demo role door at ${width}px: ${doorRadii.join(" ")}`,
      ).toBeLessThanOrEqual(3);
    }
    await demo.close();

    const ruth = await browser.newContext({ viewport: { width, height: FOLD } });
    const ruthPage = await ruth.newPage();
    await ruthPage.goto(`/enter/${seedAccessTokens.ruth}`);
    await expect(ruthPage.getByTestId("signed-in-person")).toBeVisible();
    await ruthPage.goto("/circle");
    const boardRadii = await radiiOf(ruthPage.getByTestId("board-slot").first());
    for (const radius of boardRadii) {
      expect(
        Number.parseFloat(radius),
        `board time row at ${width}px: ${boardRadii.join(" ")}`,
      ).toBeLessThanOrEqual(3);
    }
    await ruth.close();

    const grace = await browser.newContext({ viewport: { width, height: FOLD } });
    const gracePage = await grace.newPage();
    await gracePage.goto(`/enter/${seedAccessTokens.grace}`);
    await expect(gracePage.getByTestId("signed-in-person")).toBeVisible();
    await gracePage.goto("/desk");
    const deskRadii = await radiiOf(gracePage.getByTestId("desk-row").first());
    for (const radius of deskRadii) {
      expect(
        Number.parseFloat(radius),
        `desk row at ${width}px: ${deskRadii.join(" ")}`,
      ).toBeLessThanOrEqual(3);
    }
    await grace.close();
  }

  // A control whose border is its only affordance uses the boundary token.
  const page = await browser.newPage({ viewport: { width: 1280, height: FOLD } });
  await page.goto("/");
  const ghostBorder = await page
    .locator("main a[data-primary-action]")
    .nth(1)
    .evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(ghostBorder).toBe(BOUNDARY);
  await page.close();

  const caregiver = await signIn(browser, seedAccessTokens.marta);
  await caregiver.page.goto("/ask");
  const textareaBorder = await caregiver.page
    .locator("#ask-text")
    .evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(textareaBorder).toBe(BOUNDARY);
  await caregiver.context.close();
});

test("VAL-R5DES-004 — adjacent sections on / and /circle are separated by a hairline rule", async ({
  browser,
}) => {
  const readPairs = async (page: Page) =>
    page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) return [];
      const sections = Array.from(main.querySelectorAll("section"));
      const pairs: Array<{
        previous: string;
        next: string;
        width: number;
        color: string;
      }> = [];
      for (const next of sections) {
        const previous = next.previousElementSibling;
        if (!previous || previous.tagName !== "SECTION") continue;
        const style = getComputedStyle(next);
        const label = (el: Element) =>
          el.getAttribute("aria-label") ||
          el.getAttribute("data-testid") ||
          el.getAttribute("aria-labelledby") ||
          el.tagName;
        pairs.push({
          previous: label(previous),
          next: label(next),
          width: Number.parseFloat(style.borderTopWidth) || 0,
          color: style.borderTopColor,
        });
      }
      return pairs;
    });

  const page = await browser.newPage({ viewport: { width: 1280, height: FOLD } });
  await page.goto("/");
  const homePairs = await readPairs(page);
  expect(
    homePairs.length,
    "home has adjacent sections to separate",
  ).toBeGreaterThan(2);
  for (const pair of homePairs) {
    expect(
      pair.width,
      `${pair.previous} → ${pair.next} rule width`,
    ).toBeGreaterThan(0);
    expect(
      pair.width,
      `${pair.previous} → ${pair.next} rule width`,
    ).toBeLessThanOrEqual(1);
    expect(
      [LINE, GOLD],
      `${pair.previous} → ${pair.next} rule colour ${pair.color}`,
    ).toContain(pair.color);
  }
  await shot(page, "home-1280x800-notice-sheet");
  await page.setViewportSize({ width: 360, height: FOLD });
  await shot(page, "home-360x800-notice-sheet");
  await page.close();

  const ruth = await signIn(browser, seedAccessTokens.ruth);
  await ruth.page.setViewportSize({ width: 1280, height: FOLD });
  await ruth.page.goto("/circle");
  const circlePairs = await readPairs(ruth.page);
  expect(
    circlePairs.length,
    "the board separates its sections",
  ).toBeGreaterThan(0);
  for (const pair of circlePairs) {
    expect(pair.width, `${pair.previous} → ${pair.next}`).toBeGreaterThan(0);
    expect(pair.width, `${pair.previous} → ${pair.next}`).toBeLessThanOrEqual(1);
    expect([LINE, GOLD], `${pair.color}`).toContain(pair.color);
  }
  await shot(ruth.page, "circle-1280x800-notice-sheet");
  await ruth.page.setViewportSize({ width: 360, height: FOLD });
  await shot(ruth.page, "circle-360x800-notice-sheet");
  await ruth.context.close();
});

test("VAL-R5DES-004 — a board row and a desk row carry at most one non-zero border side", async ({
  browser,
}) => {
  for (const width of [1280, 360]) {
    const ruth = await browser.newContext({ viewport: { width, height: FOLD } });
    const ruthPage = await ruth.newPage();
    await ruthPage.goto(`/enter/${seedAccessTokens.ruth}`);
    await expect(ruthPage.getByTestId("signed-in-person")).toBeVisible();
    await ruthPage.goto("/circle");
    const boardSides = await borderSidesOf(
      ruthPage.getByTestId("board-slot").first(),
    );
    expect(
      boardSides.filter((side) => side > 0).length,
      `board row sides at ${width}: ${boardSides.join(",")}`,
    ).toBeLessThanOrEqual(1);
    await ruth.close();

    const grace = await browser.newContext({ viewport: { width, height: FOLD } });
    const gracePage = await grace.newPage();
    await gracePage.goto(`/enter/${seedAccessTokens.grace}`);
    await expect(gracePage.getByTestId("signed-in-person")).toBeVisible();
    await gracePage.goto("/desk");
    const deskSides = await borderSidesOf(
      gracePage.getByTestId("desk-row").first(),
    );
    expect(
      deskSides.filter((side) => side > 0).length,
      `desk row sides at ${width}: ${deskSides.join(",")}`,
    ).toBeLessThanOrEqual(1);
    await shot(gracePage, `desk-${width}x800-notice-sheet`);
    await grace.close();
  }
});

test("VAL-R5DES-004 — the home process strip is one numbered rail of three equal items", async ({
  browser,
}) => {
  for (const width of [1280, 360]) {
    const page = await browser.newPage({ viewport: { width, height: FOLD } });
    await page.goto("/");

    const structure = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('[data-testid="landing-step-card"]'),
      );
      const list = cards[0]?.parentElement;
      return {
        tag: list?.tagName ?? null,
        items: cards.map((card) => card.tagName),
        heights: cards.map((card) =>
          Math.round(card.getBoundingClientRect().height),
        ),
        headings: cards.map(
          (card) => card.querySelector("h3")?.textContent?.trim() ?? null,
        ),
        paragraphs: cards.map((card) => card.querySelectorAll("p").length),
        icons: cards.map((card) => card.querySelectorAll("svg").length),
      };
    });

    expect(structure.tag).toBe("OL");
    expect(structure.items).toEqual(["LI", "LI", "LI"]);
    expect(
      new Set(structure.heights).size,
      `heights ${structure.heights.join("/")}`,
    ).toBe(1);
    expect(
      structure.headings.every((heading) => heading && heading.length > 4),
    ).toBe(true);
    expect(structure.paragraphs).toEqual([2, 2, 2]);
    expect(structure.icons).toEqual([0, 0, 0]);

    for (let index = 0; index < 3; index += 1) {
      const numeral = page.getByTestId("step-numeral").nth(index);
      await expect(numeral).toHaveText(String(index + 1));
      const box = await numeral.boundingBox();
      expect(Math.round(box?.width ?? 0), `numeral ${index + 1} width`).toBe(36);
      expect(Math.round(box?.height ?? 0), `numeral ${index + 1} height`).toBe(
        36,
      );
      const type = await numeral.evaluate((el) => {
        const style = getComputedStyle(el);
        return { family: style.fontFamily, numeric: style.fontVariantNumeric };
      });
      expect(type.family).toMatch(SOURCE_SANS);
      expect(type.family).not.toMatch(FRAUNCES);
      expect(type.numeric).toBe("tabular-nums");
    }

    const firstParagraph = await page.evaluate(() => {
      const strip = document.querySelector(
        'main section[aria-label*="three steps" i]',
      );
      return (strip?.querySelector("p")?.textContent ?? "").trim();
    });
    expect(firstParagraph).toBe("Step 1");

    await page.close();
  }
});

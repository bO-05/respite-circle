import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { seedAccessTokens } from "../../src/db/seed-data";

/**
 * VAL-R5DES-002 — the vendored typography, measured in the real build.
 *
 * The unit suite (`tests/unit/fonts.test.ts`) pins the four files, their
 * licence, the next/font/local declaration and the two theme stacks. Only a
 * browser can prove what a reader actually meets, so this spec reads the
 * computed family, size, line height and numeric setting, and watches the
 * network log of a cold page load.
 *
 * Nothing here writes a row: the receipt is the seeded hero ask, so the spec
 * does not depend on the order of the suite.
 */

const HERO_RECEIPT = "/ask/d1000000-0000-4000-8000-000000000001";

const EVIDENCE_DIR = path.join(process.cwd(), "test-results", "evidence");

const GOOGLE_FONT_HOST = /fonts\.googleapis\.com|fonts\.gstatic\.com/;
const MEDIA_FONT = /\/_next\/static\/media\/[^/?]+\.(?:ttf|otf|woff2?)$/i;

/** Fraunces and Source Sans 3 arrive as generated family names. */
const FRAUNCES = /fraunces/i;
const SOURCE_SANS = /source[ _-]?sans(?:[ _-]?3)?/i;

const PUBLIC_ROUTES = [
  "/",
  "/how-it-works",
  "/never",
  "/promises",
  "/calibration",
] as const;

const ROLE_ROUTES = [
  { token: seedAccessTokens.marta, paths: ["/ask", "/care"] },
  { token: seedAccessTokens.ruth, paths: ["/circle", "/my-claims"] },
  {
    token: seedAccessTokens.grace,
    paths: [
      "/desk",
      "/desk/failures",
      "/desk/sessions",
      "/desk/audit",
      "/desk/invite",
      "/desk/metrics",
      "/desk/policy",
    ],
  },
] as const;

type ComputedType = {
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  fontStyle: string;
  fontVariantNumeric: string;
  textTransform: string;
};

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

async function computedType(page: Page, selector: string): Promise<ComputedType> {
  const locator = page.locator(selector).first();
  await expect(locator).toBeVisible();
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      fontStyle: style.fontStyle,
      fontVariantNumeric: style.fontVariantNumeric,
      textTransform: style.textTransform,
    };
  });
}

test.describe.configure({ timeout: 180_000 });

test("VAL-R5DES-002 — a cold load fetches both families from the app's own build", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  const fontResponses: Array<{
    url: string;
    status: number;
    contentType: string;
  }> = [];
  const remoteFontRequests: string[] = [];
  const stylesheetUrls: string[] = [];

  page.on("request", (request) => {
    const url = request.url();
    if (GOOGLE_FONT_HOST.test(url)) remoteFontRequests.push(url);
    if (request.resourceType() === "stylesheet") stylesheetUrls.push(url);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (GOOGLE_FONT_HOST.test(url)) remoteFontRequests.push(url);
    if (MEDIA_FONT.test(url)) {
      fontResponses.push({
        url,
        status: response.status(),
        contentType: response.headers()["content-type"] ?? "",
      });
    }
  });

  await page.goto("/");
  await page.evaluate(() => document.fonts.ready.then(() => true));

  // Zero requests to either hosted font service, at build time (the unit
  // suite proves the source never names it) or at runtime.
  expect(remoteFontRequests, "requests to a hosted font service").toEqual([]);
  expect(
    stylesheetUrls.filter((url) => GOOGLE_FONT_HOST.test(url)),
    "hosted font stylesheets",
  ).toEqual([]);

  // Both faces are served by this app, from the build's own media output.
  expect(fontResponses.length, "font files requested").toBeGreaterThanOrEqual(2);
  for (const font of fontResponses) {
    expect(new URL(font.url).pathname, `same-origin media path: ${font.url}`).toMatch(
      /^\/_next\/static\/media\//,
    );
    expect(font.status, `status for ${font.url}`).toBe(200);
    // A missing or blocked file answers 200 with an HTML error page; the
    // content type is what proves a font arrived.
    expect(
      font.contentType,
      `content type for ${font.url}`,
    ).toMatch(/font|application\/octet-stream|application\/x-font/i);
  }
  expect(
    fontResponses.some((font) => /\.ttf$/i.test(font.url)),
    "a vendored TTF is served",
  ).toBe(true);

  // A declared family is not a loaded one. The browser must have parsed the
  // binaries it was served, not merely listed them in a stack.
  const loaded = await page.evaluate(() =>
    Array.from(document.fonts)
      .filter((face) => face.status === "loaded")
      .map((face) => `${face.family} ${face.style} ${face.weight}`),
  );
  expect(loaded.join(" | "), "loaded font faces").toMatch(/fraunces/i);
  expect(loaded.join(" | "), "loaded font faces").toMatch(SOURCE_SANS);
  expect(
    loaded.some((face) => /\bitalic\b/i.test(face)),
    "the italic faces loaded",
  ).toBe(true);

  // The heading meets Fraunces; body copy meets Source Sans 3 at 18px / 1.6.
  const heading = await computedType(page, "main h1");
  expect(heading.fontFamily).toMatch(FRAUNCES);
  expect(heading.fontStyle).toBe("normal");
  expect(Number.parseFloat(heading.fontSize)).toBeGreaterThanOrEqual(36);

  const body = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
    };
  });
  expect(body.fontFamily).toMatch(SOURCE_SANS);
  expect(body.fontSize).toBe("18px");
  expect(Number.parseFloat(body.lineHeight)).toBeCloseTo(18 * 1.6, 1);

  // Body copy at 18px keeps the 1.6 line height; a lead stays at 20px.
  const bodyCopy = await computedType(page, "main p.text-base");
  expect(bodyCopy.fontFamily).toMatch(SOURCE_SANS);
  expect(bodyCopy.fontSize).toBe("18px");
  expect(Number.parseFloat(bodyCopy.lineHeight)).toBeCloseTo(28.8, 1);

  const lead = await computedType(page, "main p.text-xl");
  expect(lead.fontFamily).toMatch(SOURCE_SANS);
  expect(Number.parseFloat(lead.fontSize)).toBeGreaterThanOrEqual(20);
  expect(Number.parseFloat(lead.lineHeight)).toBeCloseTo(
    Number.parseFloat(lead.fontSize) * 1.6,
    1,
  );

  // The italic face is real: the kicker is Fraunces italic, sentence case and
  // never a fallback serif.
  const kicker = await computedType(page, "main section:first-of-type p");
  expect(kicker.fontFamily).toMatch(FRAUNCES);
  expect(kicker.fontStyle).toBe("italic");
  expect(kicker.textTransform).toBe("none");
  expect(kicker.fontSize).toBe("17px");

  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "r5-fonts-home-1280x800.png"),
  });

  await context.close();
});

test("VAL-R5DES-002 — times, day bands and crisis numbers use tabular figures", async ({
  browser,
}) => {
  // Board: a time and a day-band date, both in the sans with tabular figures.
  const volunteer = await signIn(browser, seedAccessTokens.ruth);
  await volunteer.page.goto("/circle");

  const boardTime = await computedType(
    volunteer.page,
    '[data-testid="board-window"]',
  );
  expect(boardTime.fontFamily).toMatch(SOURCE_SANS);
  expect(boardTime.fontFamily).not.toMatch(FRAUNCES);
  expect(boardTime.fontVariantNumeric).toBe("tabular-nums");

  const dayBand = await computedType(
    volunteer.page,
    '[data-testid="date-group"] h3 time',
  );
  expect(dayBand.fontVariantNumeric).toBe("tabular-nums");

  // The numerals in the band are the date, set in the sans; the day name is
  // the serif kicker.
  const dayNumber = await computedType(
    volunteer.page,
    '[data-testid="date-group"] h3 time > span:nth-of-type(2)',
  );
  expect(dayNumber.fontFamily).toMatch(SOURCE_SANS);
  expect(dayNumber.fontFamily).not.toMatch(FRAUNCES);
  expect(dayNumber.fontVariantNumeric).toBe("tabular-nums");

  // The footer's crisis numbers travel with every page.
  const crisis911 = await computedType(volunteer.page, 'footer a[href="tel:911"]');
  const crisis988 = await computedType(volunteer.page, 'footer a[href="tel:988"]');
  for (const crisis of [crisis911, crisis988]) {
    expect(crisis.fontFamily).toMatch(SOURCE_SANS);
    expect(crisis.fontVariantNumeric).toBe("tabular-nums");
  }

  await volunteer.context.close();

  // Receipt: the confidence percentages, the revision count and the run
  // metadata are numerals a caregiver reads and compares.
  const caregiver = await signIn(browser, seedAccessTokens.marta);
  await caregiver.page.goto(HERO_RECEIPT);

  const heading = await computedType(
    caregiver.page,
    '[data-testid="decision-trail"] h2',
  );
  expect(heading.fontFamily).toMatch(FRAUNCES);

  const revision = await computedType(
    caregiver.page,
    '[data-testid="trail-revision"]',
  );
  expect(revision.fontFamily).toMatch(SOURCE_SANS);
  expect(revision.fontVariantNumeric).toBe("tabular-nums");

  const confidence = await computedType(
    caregiver.page,
    '[data-testid="decision-list"] > li:first-child > p:last-child',
  );
  expect(confidence.fontFamily).toMatch(SOURCE_SANS);
  expect(confidence.fontVariantNumeric).toBe("tabular-nums");

  await mkdir(EVIDENCE_DIR, { recursive: true });
  await caregiver.page.screenshot({
    path: path.join(EVIDENCE_DIR, "r5-fonts-receipt-1280x800.png"),
    fullPage: false,
  });

  await caregiver.context.close();
});

test("VAL-R5DES-002 — no main paragraph, list item or label falls below 16px", async ({
  browser,
}) => {
  const measure = (page: Page) =>
    page.evaluate(() => {
      const tiny: Array<{ text: string; size: number }> = [];
      for (const element of Array.from(
        document.querySelectorAll("main p, main li, main label"),
      )) {
        const text = (element.textContent ?? "").trim();
        if (!text) continue;
        if (element.closest(".sr-only")) continue;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const size = Number.parseFloat(style.fontSize);
        if (size < 16) tiny.push({ text: text.slice(0, 50), size });
      }
      return {
        tiny,
        bodySize: Number.parseFloat(getComputedStyle(document.body).fontSize),
      };
    });

  for (const path of PUBLIC_ROUTES) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(path);
    const result = await measure(page);
    expect(result.tiny, `${path}: main text below 16px`).toEqual([]);
    expect(result.bodySize, `${path}: body size`).toBeGreaterThanOrEqual(18);
    await context.close();
  }

  for (const route of ROLE_ROUTES) {
    const { context, page } = await signIn(browser, route.token);
    for (const path of route.paths) {
      await page.goto(path);
      const result = await measure(page);
      expect(result.tiny, `${path}: main text below 16px`).toEqual([]);
      expect(result.bodySize, `${path}: body size`).toBeGreaterThanOrEqual(18);
    }
    await context.close();
  }
});

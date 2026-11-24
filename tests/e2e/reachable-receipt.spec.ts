import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { DEMO_IDS, DEMO_TEXT } from "../../src/db/demo-state";
import { seedAccessTokens } from "../../src/db/seed-data";
import { E2E_RESET_PATH, E2E_RESET_TOKEN } from "./helpers/e2e-env";

/**
 * VAL-AUDITFIX-013 — the nine-answer receipt is reachable by clicking.
 *
 * The seeded demo used to reach `/ask/<id>` only by typing the URL. `/care`
 * now carries a calm, large link to each of the caregiver's own asks, and the
 * receipt carries one clear way back into the flow. Ownership is still the
 * server's decision: another caregiver gets no link and a direct URL answers
 * exactly like a missing ask.
 *
 * Screenshots land in `.research/validation-runs/reachable-receipt/`.
 */

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "reachable-receipt",
);

const HERO_RECEIPT = `/ask/${DEMO_IDS.askHero}`;

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

async function reset(request: APIRequestContext): Promise<void> {
  const response = await request.post(E2E_RESET_PATH, {
    headers: { "x-demo-reset-token": E2E_RESET_TOKEN },
    failOnStatusCode: false,
    timeout: 90_000,
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).reset).toBe(true);
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.scrollingElement!.scrollWidth -
      document.scrollingElement!.clientWidth,
  );
}

function careAskLink(page: Page, askId: string) {
  return page.locator(
    `[data-testid="care-ask-link"][data-ask-id="${askId}"]`,
  );
}

test.describe.configure({ timeout: 240_000 });

test.describe("VAL-AUDITFIX-013 — the receipt is reachable by clicking", () => {
  test("the care page links to the caregiver's own receipt in one click, and the receipt leads back", async ({
    browser,
    request,
  }) => {
    await reset(request);
    const marta = await signIn(browser, seedAccessTokens.marta);

    const care = await marta.page.goto("/care");
    expect(care?.status()).toBe(200);

    const link = careAskLink(marta.page, DEMO_IDS.askHero);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", HERO_RECEIPT);
    await expect(link).toContainText(/nine answers/i);

    // Calm and large: at least 44x44 and at least 18px, not a footnote.
    const box = await link.boundingBox();
    expect(box?.height ?? 0, "link height").toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0, "link width").toBeGreaterThanOrEqual(44);
    const fontSize = await link.evaluate((node) =>
      Number.parseFloat(getComputedStyle(node).fontSize),
    );
    expect(fontSize, "link font size").toBeGreaterThanOrEqual(18);

    await shot(marta.page, "care-with-link");

    // One click reaches the nine-answer receipt.
    await link.click();
    await expect(marta.page).toHaveURL(
      new RegExp(`${HERO_RECEIPT.replaceAll("/", "\\/")}$`),
    );
    await expect(marta.page.getByTestId("decision-trail")).toBeVisible();
    await expect(marta.page.getByTestId("decision-list").locator("li")).toHaveCount(
      9,
    );
    await expect(marta.page.getByTestId("trail-run-metadata")).toBeVisible();
    await expect(marta.page.getByTestId("trail-policy")).toBeVisible();
    await expect(marta.page.getByTestId("trail-digest")).toBeVisible();
    expect(await marta.page.getByTestId("caregiver-verbatim").textContent()).toBe(
      DEMO_TEXT.hero,
    );
    await shot(marta.page, "receipt-reached-by-clicking");

    // One clear way back into the flow.
    const back = marta.page.getByTestId("receipt-back-to-care");
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", "/care");
    const backBox = await back.boundingBox();
    expect(backBox?.height ?? 0, "back link height").toBeGreaterThanOrEqual(44);

    await back.click();
    await expect(marta.page).toHaveURL(/\/care$/);
    await expect(
      marta.page.getByRole("heading", {
        level: 1,
        name: /what's covered for your family/i,
      }),
    ).toBeVisible();
    await shot(marta.page, "receipt-back-in-flow");

    await marta.context.close();
  });

  test("another caregiver is still refused, and no link names this family", async ({
    browser,
    request,
  }) => {
    await reset(request);
    const priya = await signIn(browser, seedAccessTokens.priya);

    await priya.page.goto("/care");

    // Priya sees her own ask's link and never Marta's.
    await expect(careAskLink(priya.page, DEMO_IDS.askSafetyHold)).toBeVisible();
    await expect(careAskLink(priya.page, DEMO_IDS.askHero)).toHaveCount(0);

    const careHtml = await priya.page.content();
    expect(careHtml).not.toContain(DEMO_IDS.askHero);
    expect(careHtml).not.toContain(DEMO_TEXT.hero.slice(0, 40));
    await shot(priya.page, "other-caregiver-care-no-link");

    // The direct URL answers exactly like a missing ask, after hydration too.
    const response = await priya.page.goto(HERO_RECEIPT);
    expect(response?.status()).toBe(404);
    await expect(priya.page.getByTestId("caregiver-verbatim")).toHaveCount(0);
    await expect(priya.page.getByTestId("decision-trail")).toHaveCount(0);
    await shot(priya.page, "other-caregiver-refused");

    await priya.context.close();
  });

  test("the link and the receipt hold at 360px and at 200% zoom", async ({
    browser,
    request,
  }) => {
    await reset(request);
    const marta = await signIn(browser, seedAccessTokens.marta);

    // 640 CSS px is the layout a 1280px window has at 200% browser zoom.
    const viewports = [
      { width: 360, height: 800, label: "360" },
      { width: 640, height: 450, label: "640-200pct" },
    ];

    for (const viewport of viewports) {
      await marta.page.setViewportSize({ width: viewport.width, height: viewport.height });
      await marta.page.goto("/care");

      expect(
        await horizontalOverflow(marta.page),
        `/care overflows at ${viewport.width}px`,
      ).toBeLessThanOrEqual(0);

      const link = careAskLink(marta.page, DEMO_IDS.askHero);
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box?.height ?? 0, `link height at ${viewport.width}px`).toBeGreaterThanOrEqual(44);
      expect(
        (box?.x ?? 0) + (box?.width ?? 0),
        `link right edge at ${viewport.width}px`,
      ).toBeLessThanOrEqual(viewport.width + 1);
      await shot(marta.page, `care-${viewport.label}`);

      await link.click();
      await expect(marta.page).toHaveURL(
        new RegExp(`${HERO_RECEIPT.replaceAll("/", "\\/")}$`),
      );
      await expect(marta.page.getByTestId("decision-trail")).toBeVisible();
      expect(
        await horizontalOverflow(marta.page),
        `/ask/[id] overflows at ${viewport.width}px`,
      ).toBeLessThanOrEqual(0);
      await shot(marta.page, `receipt-${viewport.label}`);
    }

    await marta.context.close();
  });
});

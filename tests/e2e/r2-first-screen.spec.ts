import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * VAL-R2UI-002 — a stranger's first screen offers a working next step.
 *
 * The round-2 visual audit measured the 360x800 first screen at HEAD 2b58b76:
 * masthead 191px, h1 at y287, the link call to action y707-752 and the demo
 * call to action y764-811 — clipped by the fold. A person with no access link
 * could not reach the only path they can use.
 *
 * These assertions measure boxes and computed styles rather than eyeballing a
 * screenshot. The screenshot is the evidence; the numbers are the gate.
 */

const FOLD = 800;
const ACCENT = "rgb(180, 85, 45)";
const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "r2-first-screen",
);

type Box = {
  top: number;
  bottom: number;
  width: number;
  height: number;
};

async function boxOf(locator: Locator): Promise<Box> {
  const rect = await locator.boundingBox();
  expect(rect, "a measured control must render a box").not.toBeNull();
  const r = rect as NonNullable<typeof rect>;
  return {
    top: r.y,
    bottom: r.y + r.height,
    width: r.width,
    height: r.height,
  };
}

async function styleOf(locator: Locator): Promise<{
  backgroundColor: string;
  color: string;
  fontSize: string;
  fontWeight: string;
}> {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      backgroundColor: s.backgroundColor,
      color: s.color,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
    };
  });
}

async function evidenceShot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  // Viewport-only: the evidence is the first screen, not the whole page.
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`) });
}

/** Horizontal overflow is a clipped control waiting to happen. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (document.scrollingElement?.scrollWidth ?? 0) -
      (document.scrollingElement?.clientWidth ?? 0),
  );
}

/** The measured numbers, kept beside the screenshot for the validator. */
async function record(name: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    path.join(EVIDENCE_DIR, `${name}.json`),
    `${JSON.stringify(data, null, 2)}\n`,
    "utf8",
  );
}

test("VAL-R2UI-002 — at 360x800 both public calls to action sit inside the first screen", async ({
  page,
}) => {
  // The suite's webServer sets RC_DEMO_MODE=1, which is also the production
  // demo configuration, so both public paths exist on this screen.
  await page.setViewportSize({ width: 360, height: FOLD });
  await page.goto("/");

  const hero = page.locator("main");

  const h1 = hero.getByRole("heading", { level: 1 });
  await expect(h1).toBeVisible();
  const h1Box = await boxOf(h1);
  expect(
    h1Box.bottom,
    "the h1 is above the fold, not pushed out by the masthead",
  ).toBeLessThanOrEqual(FOLD);

  // The product sentence is the plain paragraph under the h1. It must survive
  // the shorter masthead, not be replaced by the calls to action.
  const productSentence = hero.getByText(/Your church arranges a few hours/i);
  await expect(productSentence).toBeVisible();
  const sentenceBox = await boxOf(productSentence);
  expect(
    sentenceBox.bottom,
    "the product sentence is above the fold",
  ).toBeLessThanOrEqual(FOLD);

  const demo = hero.getByRole("link", { name: /look around the demo/i });
  const enter = hero.getByRole("link", { name: /enter with your link/i });
  await expect(demo).toBeVisible();
  await expect(enter).toBeVisible();
  await expect(demo).toHaveAttribute("href", "/demo");
  await expect(enter).toHaveAttribute("href", "/enter");

  const demoBox = await boxOf(demo);
  const enterBox = await boxOf(enter);

  expect(
    demoBox.bottom,
    "the demo call to action is fully inside the 800px first screen",
  ).toBeLessThanOrEqual(FOLD);
  expect(
    enterBox.bottom,
    "the link call to action is fully inside the 800px first screen",
  ).toBeLessThanOrEqual(FOLD);
  expect(demoBox.height, "demo target height").toBeGreaterThanOrEqual(44);
  expect(enterBox.height, "enter target height").toBeGreaterThanOrEqual(44);

  // A person without an access link cannot use the link path, so the demo path
  // must be at least as prominent: the same type, the filled accent surface,
  // and met first in reading order.
  const [demoStyle, enterStyle] = await Promise.all([
    styleOf(demo),
    styleOf(enter),
  ]);
  expect(demoStyle.backgroundColor, "the demo path is the filled action").toBe(
    ACCENT,
  );
  expect(
    enterStyle.backgroundColor,
    "the link path is not the filled action beside it",
  ).not.toBe(ACCENT);
  expect(demoStyle.fontSize, "same type size").toBe(enterStyle.fontSize);
  expect(demoStyle.fontWeight, "same type weight").toBe(enterStyle.fontWeight);
  expect(
    demoBox.top,
    "the demo path is met before the link path",
  ).toBeLessThanOrEqual(enterBox.top);

  // The masthead must be short enough to leave the hero in view.
  const masthead = await boxOf(page.getByRole("banner"));
  expect(
    masthead.height,
    "the masthead leaves room for the h1, the sentence and both paths",
  ).toBeLessThanOrEqual(128);

  // The masthead carries its own way in. It is a call to action too, so it is
  // measured rather than assumed to be above the fold.
  const mastheadLinks = page.getByRole("banner").getByRole("link");
  const mastheadBoxes: Array<Box & { text: string }> = [];
  for (let index = 0; index < (await mastheadLinks.count()); index += 1) {
    const link = mastheadLinks.nth(index);
    if (!(await link.isVisible())) continue;
    const linkBox = await boxOf(link);
    expect(
      linkBox.bottom,
      `masthead link ${index} is fully inside the first screen`,
    ).toBeLessThanOrEqual(FOLD);
    expect(
      linkBox.height,
      `masthead link ${index} target height`,
    ).toBeGreaterThanOrEqual(44);
    mastheadBoxes.push({ text: (await link.innerText()).trim(), ...linkBox });
  }
  expect(mastheadBoxes.length, "the masthead still offers a way in").toBeGreaterThan(0);

  await record("home-360x800", {
    viewport: { width: 360, height: FOLD },
    mastheadHeight: masthead.height,
    horizontalOverflow: await horizontalOverflow(page),
    h1: h1Box,
    productSentence: sentenceBox,
    demoCallToAction: { ...demoBox, style: demoStyle },
    linkCallToAction: { ...enterBox, style: enterStyle },
    mastheadLinks: mastheadBoxes,
  });
  expect(await horizontalOverflow(page), "no horizontal scroll at 360").toBeLessThanOrEqual(0);
  await evidenceShot(page, "home-360x800");

  // "Works for someone with no access link" means the action lands on a page
  // that person can use, not just that an href is present. This browser
  // context holds no session cookie.
  await demo.click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(
    page.locator('[data-testid^="demo-link-"]').first(),
    "the demo path opens a role list a stranger can use",
  ).toBeVisible();
});

test("VAL-R2UI-002 — the sign-in page tells a person without a link what to do next", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: FOLD });
  await page.goto("/enter");

  const recovery = page.getByRole("region", { name: /lost your link/i });
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText(/coordinator/i);
  await expect(recovery).toContainText(/church office/i);
  await expect(recovery).toContainText(/new link/i);

  // The page must not claim the link proves who the person is. It is a reusable
  // bearer token, and anyone holding it can sign in.
  await expect(page.locator("body")).not.toContainText(
    "signs you in as you, and only you",
  );

  expect(
    await horizontalOverflow(page),
    "no horizontal scroll at 360 on the sign-in page",
  ).toBeLessThanOrEqual(0);

  await evidenceShot(page, "enter-360x800");

  // The refused-link state keeps the same way forward in view.
  await page.goto("/enter?error=invalid");
  await expect(
    page.getByRole("alert").filter({ hasText: /that access link isn't valid/i }),
  ).toContainText(/ask for a new one/i);
  const refused = page.getByRole("region", { name: /lost your link/i });
  await expect(refused).toBeVisible();
  const recoveryText = (await refused.innerText()).replace(/\s+/g, " ").trim();
  await expect(refused).toContainText(/church office/i);

  await record("enter-360x800-refused", {
    alert:
      "That access link isn't valid. Check the link from your coordinator, or ask for a new one.",
    recovery: recoveryText,
  });
  await evidenceShot(page, "enter-360x800-refused");
});

test("VAL-R2UI-002 — the desktop first screen keeps the heading, the sentence and both paths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: FOLD });
  await page.goto("/");

  const hero = page.locator("main");
  await expect(hero.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    hero.getByText(/Your church arranges a few hours/i),
  ).toBeVisible();

  // The short masthead is a small-screen decision. On desktop the tagline that
  // introduces the product stays in the header.
  await expect(
    page
      .getByRole("banner")
      .getByText("A church-run break for a family that cares for someone", {
        exact: true,
      }),
  ).toBeVisible();

  const demoBox = await boxOf(hero.getByRole("link", { name: /look around the demo/i }));
  const enterBox = await boxOf(hero.getByRole("link", { name: /enter with your link/i }));
  expect(demoBox.bottom, "demo path inside the desktop first screen").toBeLessThanOrEqual(FOLD);
  expect(enterBox.bottom, "link path inside the desktop first screen").toBeLessThanOrEqual(FOLD);

  await evidenceShot(page, "home-1280x800");
});

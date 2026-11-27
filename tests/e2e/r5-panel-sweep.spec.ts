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
 * VAL-R5DES-004 and VAL-R5DES-001 — the operator and trust pages are a notice
 * sheet, not a card grid.
 *
 * Round 5 replaces the four-sided card with one rule and one fill: a panel
 * carries at most one non-zero border side beside the surface or tone it
 * already had. This spec measures that on every panel the sweep names —
 * `/desk/policy`, `/desk/sessions`, `/desk/audit`, `/desk/invite`,
 * `/desk/metrics`, `/promises`, `/never`, `/how-it-works` at 360, and the `/ask`
 * form — at 1280 and 360. It also re-proves the two things the sweep must not
 * spend: every control keeps its `--color-boundary` edge, and every target
 * keeps its 44px.
 *
 * Copy, test ids, DOM order and state colours are unchanged by the sweep; this
 * spec asserts geometry only, and the honesty pins stay in their own files.
 */

const FOLD = 800;
const BOUNDARY = "rgb(125, 119, 106)";

const EVIDENCE_DIR =
  process.env.R5_PANEL_SWEEP_EVIDENCE_DIR ??
  path.join(process.cwd(), ".research", "validation-runs", "r5-panel-sweep");

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

/** The first fold, which is what a reader meets before scrolling. */
async function shotFold(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}-first-fold.png`),
    fullPage: false,
  });
}

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `${where} has no horizontal scroll`).toBeLessThanOrEqual(0);
}

/** The four border widths of one element, in CSS pixels. */
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

async function radiiOf(locator: Locator): Promise<number[]> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ].map((value) => Number.parseFloat(value) || 0);
  });
}

type Surface = {
  path: string;
  /** Rendered name for the failure message. */
  name: string;
  /** Panels the feature names. Each must exist unless `optional`. */
  panels: Array<{ selector: string; label: string; optional?: boolean }>;
};

const SURFACES: readonly Surface[] = [
  {
    path: "/desk/policy",
    name: "policy",
    panels: [
      {
        selector: 'section[aria-labelledby="policy-current"]',
        label: "policy current version",
      },
      { selector: 'form[data-testid="policy-editor"]', label: "policy editor" },
      { selector: "fieldset", label: "referral fieldset" },
      {
        selector: 'section[aria-labelledby="editor-auto-publish"]',
        label: "low-risk policy block",
      },
      {
        selector: 'section[aria-labelledby="editor-signoff"]',
        label: "sign-off block",
      },
      {
        selector: 'section[aria-labelledby="policy-history"]',
        label: "policy history",
      },
    ],
  },
  {
    path: "/desk/sessions",
    name: "sessions",
    panels: [
      {
        selector: '[data-testid="session-template"]',
        label: "weekly template",
      },
      { selector: '[data-testid="session-card"]', label: "session card" },
      { selector: '[data-testid="call-tasks"]', label: "call tasks" },
      {
        selector: '[data-testid="session-banner"]',
        label: "session calendar banner",
        optional: true,
      },
    ],
  },
  {
    path: "/desk/audit",
    name: "audit",
    panels: [
      {
        selector: '[data-testid="audit-filter-form"]',
        label: "audit filter",
      },
      { selector: '[data-testid="audit-row"]', label: "audit row" },
      {
        selector: '[data-testid="audit-who-decides"]',
        label: "who decides block",
      },
      {
        selector: 'section[aria-labelledby="audit-append-only"]',
        label: "append-only block",
      },
    ],
  },
  {
    path: "/desk/invite",
    name: "invite",
    panels: [
      { selector: '[data-testid="invite-composer"]', label: "invite composer" },
      { selector: '[data-testid="access-links"]', label: "access links" },
      { selector: '[data-testid="invite-recent"]', label: "sent invitations" },
      {
        selector: '[data-testid="invite-sent-row"]',
        label: "sent invitation row",
        optional: true,
      },
      {
        selector: '[data-testid="invite-delivery"]',
        label: "delivery block",
      },
    ],
  },
  {
    path: "/desk/metrics",
    name: "metrics",
    panels: [
      {
        selector: '[data-testid="metrics-range-form"]',
        label: "metrics range form",
      },
      {
        selector: '[data-testid="metrics-list"] > div',
        label: "metric card",
      },
    ],
  },
  {
    path: "/promises",
    name: "promises",
    panels: [
      { selector: "main ul > li", label: "promise row" },
      {
        selector: 'section[aria-labelledby="kept-heading"]',
        label: "how promises are kept",
      },
    ],
  },
  {
    path: "/never",
    name: "never",
    panels: [
      { selector: '[data-testid="commitment"]', label: "commitment" },
      {
        selector: '[data-testid="never-auto-publish"]',
        label: "meal exception",
      },
    ],
  },
];

test.describe.configure({ timeout: 240_000 });

test("VAL-R5DES-004 — every named panel carries at most one rule and keeps its fill", async ({
  browser,
}) => {
  const grace = await signIn(browser, seedAccessTokens.grace);
  const measured: string[] = [];

  for (const width of [1280, 360]) {
    await grace.page.setViewportSize({ width, height: FOLD });

    for (const surface of SURFACES) {
      await grace.page.goto(surface.path);
      await expect(grace.page.getByRole("heading", { level: 1 })).toBeVisible();

      for (const panel of surface.panels) {
        const locator = grace.page.locator(panel.selector);
        const count = await locator.count();
        if (count === 0) {
          expect(
            panel.optional ?? false,
            `${surface.name} at ${width}: ${panel.label} is missing`,
          ).toBe(true);
          measured.push(`${surface.name}/${panel.label}: absent`);
          continue;
        }
        for (let index = 0; index < count; index += 1) {
          const sides = await borderSidesOf(locator.nth(index));
          const radii = await radiiOf(locator.nth(index));
          expect(
            sides.filter((side) => side > 0).length,
            `${surface.name} at ${width}: ${panel.label} border sides ${sides.join(",")}`,
          ).toBeLessThanOrEqual(1);
          for (const radius of radii) {
            expect(
              radius,
              `${surface.name} at ${width}: ${panel.label} radius ${radii.join(" ")}`,
            ).toBeLessThanOrEqual(3);
          }
        }
        measured.push(
          `${surface.name}/${panel.label}: ${count}x [${(
            await borderSidesOf(locator.first())
          ).join(",")}]`,
        );
      }

      await noHorizontalScroll(
        grace.page,
        `${surface.path} at ${width}`,
      );
    }
  }

  console.log(`Notice panels: ${measured.join("; ")}`);
  await grace.context.close();
});

test("VAL-R5DES-004 — the trust matrices are ruled blocks at 360 and tables above", async ({
  browser,
}) => {
  const page = await browser.newPage({ viewport: { width: 360, height: FOLD } });
  await page.goto("/how-it-works");

  const cards = page.locator('[data-testid$="-cards"] > li');
  const count = await cards.count();
  expect(count, "the narrow trust matrices render their cards").toBeGreaterThan(8);

  for (let index = 0; index < count; index += 1) {
    const sides = await borderSidesOf(cards.nth(index));
    expect(
      sides.filter((side) => side > 0).length,
      `trust card ${index} border sides ${sides.join(",")}`,
    ).toBeLessThanOrEqual(1);
  }

  await noHorizontalScroll(page, "/how-it-works at 360");
  await shot(page, "how-it-works-360x800");
  await page.close();
});

test("VAL-R5DES-004 — the /ask form panels are ruled blocks, not cards", async ({
  browser,
}) => {
  const marta = await signIn(browser, seedAccessTokens.marta);

  for (const width of [1280, 360]) {
    await marta.page.setViewportSize({ width, height: FOLD });
    await marta.page.goto("/ask");

    const dictation = marta.page
      .getByRole("heading", { name: "Or speak it aloud" })
      .locator("xpath=..");
    const consent = marta.page
      .locator("#ask-consent")
      .locator("xpath=ancestor::div[1]");
    const panels = [
      { label: "dictation", locator: dictation },
      { label: "consent", locator: consent },
    ];

    for (const panel of panels) {
      await expect(panel.locator).toBeVisible();
      const sides = await borderSidesOf(panel.locator);
      expect(
        sides.filter((side) => side > 0).length,
        `/ask ${panel.label} at ${width} border sides ${sides.join(",")}`,
      ).toBeLessThanOrEqual(1);
    }

    await noHorizontalScroll(marta.page, `/ask at ${width}`);
  }

  await marta.page.goto("/ask?again=1");
  const again = marta.page.getByTestId("ask-again-note");
  await expect(again).toBeVisible();
  expect(
    (await borderSidesOf(again)).filter((side) => side > 0).length,
    "the ask-again note is one rule",
  ).toBeLessThanOrEqual(1);

  await marta.context.close();
});

test("VAL-R5DES-004 — every control keeps its boundary and its 44px", async ({
  browser,
}) => {
  const grace = await signIn(browser, seedAccessTokens.grace);

  const controls: Array<{
    path: string;
    selector: string;
    kind: "field" | "checkbox" | "button";
  }> = [
    { path: "/desk/policy", selector: "#policy-signed-off-by", kind: "field" },
    { path: "/desk/policy", selector: "#policy-crisis-script", kind: "field" },
    {
      path: "/desk/policy",
      selector: "#policy-auto-publish",
      kind: "checkbox",
    },
    { path: "/desk/sessions", selector: 'button[type="submit"]', kind: "button" },
    { path: "/desk/audit", selector: "#audit-entity", kind: "field" },
    { path: "/desk/audit", selector: "#audit-actor", kind: "field" },
    { path: "/desk/audit", selector: 'button[type="submit"]', kind: "button" },
    { path: "/desk/invite", selector: "select", kind: "field" },
    {
      path: "/desk/invite",
      selector: 'textarea[name="body"]',
      kind: "field",
    },
    { path: "/desk/invite", selector: '[data-testid="invite-send"]', kind: "button" },
    { path: "/desk/metrics", selector: "#metrics-from", kind: "field" },
    { path: "/desk/metrics", selector: "#metrics-to", kind: "field" },
  ];

  for (const width of [1280, 360]) {
    await grace.page.setViewportSize({ width, height: FOLD });

    for (const control of controls) {
      await grace.page.goto(control.path);
      const locator = grace.page.locator(control.selector).first();
      await expect(
        locator,
        `${control.path} ${control.selector} at ${width}`,
      ).toBeVisible();

      const box = await locator.boundingBox();
      expect(box?.width ?? 0, `${control.selector} width`).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0, `${control.selector} height`).toBeGreaterThanOrEqual(44);

      if (control.kind === "field") {
        const border = await locator.evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            colour: style.borderTopColor,
            width: Number.parseFloat(style.borderTopWidth) || 0,
          };
        });
        expect(border.width, `${control.selector} keeps an edge`).toBeGreaterThanOrEqual(1);
        expect(border.colour, `${control.selector} uses the boundary token`).toBe(BOUNDARY);
      }

      if (control.kind === "checkbox") {
        // A native checkbox paints its own box, so the browser reports no CSS
        // border on it even when one is declared. What the sweep must not
        // spend is the boundary token the control carries; the 44x44 check
        // above is the same measurement `a11y.measure.spec.ts` takes here.
        const classes = await locator.evaluate((el) => el.className);
        expect(classes, `${control.selector} uses the boundary token`).toContain(
          "border-boundary",
        );
      }
    }
  }

  await grace.context.close();

  const marta = await signIn(browser, seedAccessTokens.marta);
  await marta.page.goto("/ask");
  for (const selector of ["#ask-text", "#ask-consent"]) {
    const locator = marta.page.locator(selector);
    const box = await locator.boundingBox();
    expect(box?.width ?? 0, `${selector} width`).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0, `${selector} height`).toBeGreaterThanOrEqual(44);
    const classes = await locator.evaluate((el) => el.className);
    expect(classes, `${selector} uses the boundary token`).toContain(
      "border-boundary",
    );
    if (selector === "#ask-text") {
      const colour = await locator.evaluate(
        (el) => getComputedStyle(el).borderTopColor,
      );
      expect(colour, `${selector} uses the boundary token`).toBe(BOUNDARY);
    }
  }
  await marta.context.close();
});

test("VAL-R5DES-004 — the swept pages are captured at both widths", async ({
  browser,
}) => {
  const grace = await signIn(browser, seedAccessTokens.grace);
  const marta = await signIn(browser, seedAccessTokens.marta);

  const signedIn = [
    { page: grace.page, path: "/desk/policy", name: "policy" },
    { page: grace.page, path: "/desk/sessions", name: "sessions" },
    { page: grace.page, path: "/desk/audit", name: "audit" },
    { page: grace.page, path: "/desk/invite", name: "invite" },
    { page: grace.page, path: "/desk/metrics", name: "metrics" },
  ];

  for (const width of [1280, 360]) {
    await grace.page.setViewportSize({ width, height: FOLD });
    for (const entry of signedIn) {
      await entry.page.goto(entry.path);
      await noHorizontalScroll(entry.page, `${entry.path} at ${width}`);
      await shot(entry.page, `${entry.name}-${width}x800`);
      if (entry.name === "policy") {
        await shotFold(entry.page, `${entry.name}-${width}x800`);
      }
    }

    await marta.page.setViewportSize({ width, height: FOLD });
    for (const entry of [
      { path: "/ask", name: "ask" },
      { path: "/promises", name: "promises" },
      { path: "/never", name: "never" },
      { path: "/how-it-works", name: "how-it-works" },
    ] as const) {
      await marta.page.goto(entry.path);
      await noHorizontalScroll(marta.page, `${entry.path} at ${width}`);
      await shot(marta.page, `${entry.name}-${width}x800`);
      if (entry.name === "ask" || entry.name === "promises") {
        await shotFold(marta.page, `${entry.name}-${width}x800`);
      }
    }
  }

  await grace.context.close();
  await marta.context.close();
});

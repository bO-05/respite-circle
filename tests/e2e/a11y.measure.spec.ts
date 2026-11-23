import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  BANNED_CLAIMS,
  REQUIRED_BANNED_CLAIMS,
} from "../../src/server/domain/copy-lint";
import { seedAccessTokens } from "../../src/db/seed-data";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-A11Y-001 through VAL-A11Y-006, measured rather than eyeballed.
 *
 * Every assertion here reads a computed value from the real production build:
 * element boxes, contrast ratios derived from computed colours, the focused
 * element after real Tab presses, transition durations under reduced motion,
 * scroll widths at 200% zoom, heading counts, accessible names, and the
 * announced error text. The core ask → approve → publish → claim flow is driven
 * with the keyboard only.
 *
 * The suite writes asks through the real API and cleans up afterwards by
 * closing them (the `ask` table refuses DELETE), so later specs see the queue
 * and the board as they expect.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

const PUBLIC_ROUTES = [
  "/",
  "/how-it-works",
  "/never",
  "/promises",
  "/calibration",
] as const;

const ROLE_ROUTES = [
  { role: "caregiver" as const, token: seedAccessTokens.marta, path: "/ask" },
  { role: "caregiver" as const, token: seedAccessTokens.marta, path: "/care" },
  { role: "volunteer" as const, token: seedAccessTokens.ruth, path: "/circle" },
  { role: "volunteer" as const, token: seedAccessTokens.ruth, path: "/my-claims" },
  { role: "coordinator" as const, token: seedAccessTokens.grace, path: "/desk" },
  { role: "coordinator" as const, token: seedAccessTokens.grace, path: "/desk/failures" },
  { role: "coordinator" as const, token: seedAccessTokens.grace, path: "/desk/sessions" },
  { role: "coordinator" as const, token: seedAccessTokens.grace, path: "/desk/audit" },
  { role: "coordinator" as const, token: seedAccessTokens.grace, path: "/desk/invite" },
  { role: "coordinator" as const, token: seedAccessTokens.grace, path: "/desk/metrics" },
  { role: "coordinator" as const, token: seedAccessTokens.grace, path: "/desk/policy" },
] as const;

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

async function createAsk(context: BrowserContext, text: string): Promise<string> {
  const response = await context.request.post("/api/asks", {
    data: { text, consent: true },
    timeout: 45_000,
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { askId: string };
  return body.askId;
}

/** Press Tab until the focused element matches the selector. */
async function tabTo(page: Page, selector: string, maxTabs = 160): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    const matches = await page.evaluate((sel) => {
      const active = document.activeElement;
      return Boolean(active && active.matches(sel));
    }, selector);
    if (matches) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Focus never reached ${selector} within ${maxTabs} tabs`);
}

/** The visible focus treatment on the element that currently has focus. */
async function focusRing(page: Page): Promise<{
  outlineStyle: string;
  outlineWidth: number;
  outlineColor: string;
  boxShadow: string;
}> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) throw new Error("nothing has focus");
    const style = getComputedStyle(active);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
    };
  });
}

const CONTRAST_FN = `
  (() => {
    const parse = (value) => {
      const parts = (value.match(/[\\d.]+/g) || []).map(Number);
      if (parts.length >= 4) return parts.slice(0, 4);
      if (parts.length === 3) return parts.concat(1);
      return [0, 0, 0, 0];
    };
    const channels = (value) => {
      const p = parse(value);
      return [p[0] || 0, p[1] || 0, p[2] || 0, p[3] ?? 1];
    };
    const over = (fg, bg) => {
      const a = fg[3];
      return [
        fg[0] * a + bg[0] * (1 - a),
        fg[1] * a + bg[1] * (1 - a),
        fg[2] * a + bg[2] * (1 - a),
        1,
      ];
    };
    const backgroundOf = (el) => {
      let node = el;
      let result = [250, 246, 240, 1];
      const stack = [];
      while (node) {
        const bg = channels(getComputedStyle(node).backgroundColor);
        if (bg[3] > 0) stack.push(bg);
        if (bg[3] === 1) break;
        node = node.parentElement;
      }
      stack.reverse();
      for (const layer of stack) result = over(layer, result);
      return result;
    };
    const luminance = (rgb) => {
      const [r, g, b] = rgb.slice(0, 3).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const failures = [];
    const all = Array.from(document.querySelectorAll(
      "p, li, label, td, th, button, a, h1, h2, h3, h4, dt, dd, blockquote, legend, span"
    ));
    for (const el of all) {
      const text = (el.textContent || "").trim();
      if (!text) continue;
      if (el.children.length > 0) {
        const direct = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent || "")
          .join("")
          .trim();
        if (!direct) continue;
      }
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (parseFloat(style.opacity) === 0) continue;
      if (style.color === "rgba(0, 0, 0, 0)") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const fg = channels(style.color);
      const bg = backgroundOf(el);
      const resolved = over(fg, bg);
      const l1 = luminance(resolved);
      const l2 = luminance(bg);
      const hi = Math.max(l1, l2);
      const lo = Math.min(l1, l2);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(style.fontSize);
      const weight = parseInt(style.fontWeight, 10);
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const required = large ? 3 : 4.5;
      if (ratio + 0.005 < required) {
        failures.push({
          text: text.slice(0, 60),
          ratio: Math.round(ratio * 100) / 100,
          required,
          fontSize: size,
          color: style.color,
          background: "rgb(" + bg[0] + ", " + bg[1] + ", " + bg[2] + ")",
        });
      }
    }
    return failures;
  })()
`;

const TARGETS_FN = `
  (() => {
    const out = [];
    const nodes = document.querySelectorAll(
      'button, [role="button"], a[data-primary-action]'
    );
    for (const el of Array.from(nodes)) {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      out.push({
        text: ((el.textContent || "").trim().slice(0, 50)) ||
          el.getAttribute("aria-label") ||
          el.getAttribute("data-testid") ||
          el.tagName,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }
    return out;
  })()
`;

const OVERFLOW_FN =
  "document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "a11y",
);

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

test.describe.configure({ timeout: 300_000 });

let createdAskIds: string[] = [];
let database: E2eDatabase | null = null;

test.beforeAll(async () => {
  database = await openE2eDatabase();
});

test.afterAll(async () => {
  if (!database) return;
  if (createdAskIds.length > 0) {
    // `ask` refuses DELETE by trigger, so cleanup closes the rows and cancels
    // their times. The claim is cleared first: a cancelled slot with a
    // claimed_by row still appears on Ruth's "My claims" page, and later specs
    // assert exactly what that page holds. Later specs then see the same queue
    // and board they expect.
    await database.client`
      UPDATE slot
         SET status = 'cancelled',
             claimed_by = NULL,
             claimed_at = NULL
       WHERE ask_id = ANY(${createdAskIds}::uuid[])
    `;
    await database.client`UPDATE ask SET status = 'closed' WHERE id = ANY(${createdAskIds}::uuid[])`;
  }
  await database.client.end();
  database = null;
  createdAskIds = [];
});

test("body copy is 18px or larger, the ask screen leads at 20px, and every page has one h1", async ({
  browser,
}) => {
  for (const path of PUBLIC_ROUTES) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const bodySize = await page.evaluate(
      "parseFloat(getComputedStyle(document.body).fontSize)",
    );
    expect(bodySize, `${path} body size`).toBeGreaterThanOrEqual(18);
    const tiny = await page.evaluate(`
      (() => {
        const bad = [];
        for (const el of Array.from(document.querySelectorAll("main p, main li, main label"))) {
          const size = parseFloat(getComputedStyle(el).fontSize);
          const text = (el.textContent || "").trim();
          if (text && size < 16) bad.push({ text: text.slice(0, 40), size });
        }
        return bad;
      })()
    `);
    expect(tiny, `${path} helper copy below 16px`).toEqual([]);
    await context.close();
  }

  for (const route of ROLE_ROUTES) {
    const { context, page } = await signIn(browser, route.token);
    await page.goto(route.path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const bodySize = await page.evaluate(
      "parseFloat(getComputedStyle(document.body).fontSize)",
    );
    expect(bodySize, `${route.path} body size`).toBeGreaterThanOrEqual(18);
    await context.close();
  }

  // The caregiver's own screen leads at 20px, not 18.
  const { context, page } = await signIn(browser, seedAccessTokens.marta);
  await page.goto("/ask");
  const leadSize = await page.evaluate(
    "parseFloat(getComputedStyle(document.querySelector('main h1').parentElement.querySelector('p.text-xl')).fontSize)",
  );
  expect(leadSize).toBeGreaterThanOrEqual(20);
  const fieldSize = await page.evaluate(
    "parseFloat(getComputedStyle(document.querySelector('#ask-text')).fontSize)",
  );
  expect(fieldSize).toBeGreaterThanOrEqual(20);
  await shot(page, "ask-body-type");
  await context.close();
});

test("every primary action measures at least 44 by 44 CSS pixels", async ({
  browser,
}) => {
  const checked = new Map<string, number>();
  for (const path of PUBLIC_ROUTES) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(path);
    const targets = (await page.evaluate(TARGETS_FN)) as Array<{
      text: string;
      width: number;
      height: number;
    }>;
    // The skip link is intentionally off-screen until focused.
    const visible = targets.filter((target) => target.text !== "Skip to content");
    for (const target of visible) {
      expect(
        target.width,
        `${path} target "${target.text}" width`,
      ).toBeGreaterThanOrEqual(44);
      expect(
        target.height,
        `${path} target "${target.text}" height`,
      ).toBeGreaterThanOrEqual(44);
    }
    checked.set(path, visible.length);
    await context.close();
  }

  for (const route of ROLE_ROUTES) {
    const { context, page } = await signIn(browser, route.token);
    await page.goto(route.path);
    const targets = (await page.evaluate(TARGETS_FN)) as Array<{
      text: string;
      width: number;
      height: number;
    }>;
    const visible = targets.filter((target) => target.text !== "Skip to content");
    for (const target of visible) {
      expect(
        target.width,
        `${route.path} target "${target.text}" width`,
      ).toBeGreaterThanOrEqual(44);
      expect(
        target.height,
        `${route.path} target "${target.text}" height`,
      ).toBeGreaterThanOrEqual(44);
    }
    checked.set(route.path, visible.length);
    await context.close();
  }

  // The measured surface is real: at least a dozen distinct buttons were
  // measured across the app, not just one screen.
  const total = Array.from(checked.values()).reduce((sum, n) => sum + n, 0);
  expect(total).toBeGreaterThan(10);
});

test("text and controls meet WCAG AA contrast on every measured screen", async ({
  browser,
}) => {
  const routes = [
    ...PUBLIC_ROUTES.map((path) => ({ path, token: null as string | null })),
    ...ROLE_ROUTES.map((route) => ({ path: route.path, token: route.token as string | null })),
  ];

  for (const route of routes) {
    const context = await browser.newContext();
    const page = await context.newPage();
    if (route.token) {
      await page.goto(`/enter/${route.token}`);
    }
    await page.goto(route.path);
    const failures = await page.evaluate(CONTRAST_FN);
    expect(
      failures,
      `${route.path} contrast failures: ${JSON.stringify(failures)}`,
    ).toEqual([]);
    await context.close();
  }
});

test("no horizontal scroll at 200% zoom or on a small phone", async ({
  browser,
}) => {
  const cases = [
    { width: 640, height: 450 },
    { width: 390, height: 844 },
  ];
  const entries: Array<{ path: string; token: string | null }> = [
    { path: "/", token: null },
    { path: "/ask", token: seedAccessTokens.marta },
    { path: "/care", token: seedAccessTokens.marta },
    { path: "/circle", token: seedAccessTokens.ruth },
    { path: "/desk", token: seedAccessTokens.grace },
    { path: "/desk/sessions", token: seedAccessTokens.grace },
  ];

  for (const viewport of cases) {
    for (const entry of entries) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      if (entry.token) {
        await page.goto(`/enter/${entry.token}`);
      }
      await page.goto(entry.path);
      const overflow = await page.evaluate(OVERFLOW_FN);
      expect(
        overflow,
        `${entry.path} overflows horizontally at ${viewport.width}px`,
      ).toBeLessThanOrEqual(0);
      await context.close();
    }
  }
});

test("the ask, approve, publish and claim flow is completable by keyboard with a visible focus ring", async ({
  browser,
}) => {
  const caregiver = await signIn(browser, seedAccessTokens.marta);
  await caregiver.page.goto("/ask");

  // Keyboard only: Tab to the text field, type, Tab to consent, space, Tab to
  // the submit button, Enter.
  await tabTo(caregiver.page, "#ask-text");
  let ring = await focusRing(caregiver.page);
  expect(ring.outlineStyle).not.toBe("none");
  expect(ring.outlineWidth).toBeGreaterThanOrEqual(2);

  await caregiver.page.keyboard.type(HERO_ASK);
  await tabTo(caregiver.page, "#ask-consent");
  await caregiver.page.keyboard.press("Space");
  await expect(caregiver.page.locator("#ask-consent")).toBeChecked();

  await tabTo(caregiver.page, 'form button[type="submit"]');
  ring = await focusRing(caregiver.page);
  expect(ring.outlineStyle).not.toBe("none");
  expect(ring.outlineWidth).toBeGreaterThanOrEqual(2);
  await shot(caregiver.page, "focus-submit");

  await caregiver.page.keyboard.press("Enter");
  await caregiver.page.waitForURL(/\/ask\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  const askId = caregiver.page.url().split("/").pop();
  if (!askId) throw new Error("no ask id in the receipt URL");
  createdAskIds.push(askId);
  await expect(caregiver.page.getByTestId("decision-trail")).toBeVisible();
  await caregiver.context.close();

  // Coordinator: Tab to the ask, Enter, Tab to approve, Enter.
  const grace = await signIn(browser, seedAccessTokens.grace);
  await grace.page.goto("/desk");
  await tabTo(grace.page, `a[href="/desk/ask/${askId}"]`);
  ring = await focusRing(grace.page);
  expect(ring.outlineStyle).not.toBe("none");
  await grace.page.keyboard.press("Enter");
  await grace.page.waitForURL(`**/desk/ask/${askId}`, { timeout: 30_000 });

  await tabTo(grace.page, '[data-testid="approve-ask"]');
  ring = await focusRing(grace.page);
  expect(ring.outlineStyle).not.toBe("none");
  expect(ring.outlineWidth).toBeGreaterThanOrEqual(2);
  await shot(grace.page, "focus-approve");
  await grace.page.keyboard.press("Enter");
  await expect(grace.page.getByTestId("ask-review")).toHaveAttribute(
    "data-status",
    "approved",
    { timeout: 60_000 },
  );

  const slotHref = await grace.page
    .getByTestId("published-slot-link")
    .first()
    .getAttribute("href");
  if (!slotHref) throw new Error("no published slot link");
  const slotId = slotHref.split("/").pop() as string;
  await grace.context.close();

  // Volunteer: Tab to the claim button and Enter.
  const ruth = await signIn(browser, seedAccessTokens.ruth);
  await ruth.page.goto("/circle");
  const claimSelector = `[data-slot-id="${slotId}"] [data-testid="board-claim"] button`;
  await tabTo(ruth.page, claimSelector);
  ring = await focusRing(ruth.page);
  expect(ring.outlineStyle).not.toBe("none");
  expect(ring.outlineWidth).toBeGreaterThanOrEqual(2);
  await shot(ruth.page, "focus-claim");
  await ruth.page.keyboard.press("Enter");
  await expect(ruth.page.getByTestId("claim-banner")).toHaveAttribute(
    "data-outcome",
    "claimed",
    { timeout: 60_000 },
  );
  await ruth.context.close();
});

test("reduced motion removes transitions and no screen counts time down", async ({
  browser,
}) => {
  const { context, page } = await signIn(browser, seedAccessTokens.grace);
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const path of ["/desk", "/circle", "/ask"]) {
    if (path === "/circle") await page.goto("/enter/" + seedAccessTokens.ruth);
    if (path === "/ask") await page.goto("/enter/" + seedAccessTokens.marta);
    await page.goto(path);
    const longest = await page.evaluate(`
      (() => {
        let worst = 0;
        for (const el of Array.from(document.querySelectorAll("*"))) {
          const style = getComputedStyle(el);
          const durations = [style.transitionDuration, style.animationDuration]
            .join(",")
            .split(",")
            .map((value) => {
              const trimmed = value.trim();
              if (trimmed.endsWith("ms")) return parseFloat(trimmed);
              if (trimmed.endsWith("s")) return parseFloat(trimmed) * 1000;
              return 0;
            });
          for (const duration of durations) {
            if (Number.isFinite(duration) && duration > worst) worst = duration;
          }
        }
        return worst;
      })()
    `);
    expect(longest, `${path} longest motion under reduced motion`).toBeLessThan(10);
  }

  // Nothing on the product is a countdown. A visible mm:ss timer would be the
  // signature of one, and no element claims a deadline.
  const countdowns = await page.locator("text=/^\\d{1,2}:\\d{2}$/").count();
  expect(countdowns).toBe(0);
  const deadlines = await page.locator("[data-deadline], [data-countdown]").count();
  expect(deadlines).toBe(0);
  await context.close();
});

test("the ask form labels its controls and announces exactly one associated error", async ({
  browser,
}) => {
  const { context, page } = await signIn(browser, seedAccessTokens.marta);
  await page.goto("/ask");

  // Every control resolves by its accessible name.
  await expect(page.getByLabel("Tell us what a hard week looks like")).toBeVisible();
  await expect(page.getByLabel(/consent|agree|read|understand/i).first()).toBeVisible();

  await page.getByRole("button", { name: /send this to/i }).click();
  // Scoped to main: the App Router also renders its own empty route announcer
  // with role="alert" outside the page content.
  const alerts = page.locator("main").getByRole("alert");
  await expect(alerts).toHaveCount(1);
  const errorId = await alerts.first().getAttribute("id");
  expect(errorId).toBeTruthy();
  const describedBy = await page.locator("#ask-text").getAttribute("aria-describedby");
  expect(describedBy).toContain(errorId);
  await expect(page.locator("#ask-text")).toHaveAttribute("aria-invalid", "true");
  await shot(page, "ask-error-associated");

  await context.close();
});

test("a refused coordinator form keeps the coordinator's own words and shows one error", async ({
  browser,
}) => {
  // A waiting ask the coordinator can open in two tabs.
  const marta = await signIn(browser, seedAccessTokens.marta);
  const askId = await createAsk(marta.context, HERO_ASK);
  createdAskIds.push(askId);
  await marta.context.close();

  const first = await signIn(browser, seedAccessTokens.grace);
  await first.page.goto(`/desk/ask/${askId}`);

  const note = "I read this carefully. Call me after six, and we will plan the next week together.";
  await first.page.getByTestId("send-back-note").fill(note);
  await expect(first.page.getByTestId("send-back-note")).toHaveValue(note);

  // Another coordinator publishes the same ask, so the first tab's send-back is
  // now a stale refusal — exactly the case that used to discard the note.
  const second = await signIn(browser, seedAccessTokens.grace);
  await second.page.goto(`/desk/ask/${askId}`);
  await second.page.getByTestId("approve-ask").click();
  await expect(second.page.getByTestId("ask-review")).toHaveAttribute(
    "data-status",
    "approved",
    { timeout: 60_000 },
  );
  await second.context.close();

  await first.page.getByTestId("send-back-submit").click();
  const alert = first.page.locator("main").getByRole("alert");
  await expect(alert).toHaveCount(1);
  await expect(first.page.getByTestId("send-back-note")).toHaveValue(note);
  await first.context.close();

  // The override form on a safety hold follows the same rule: one alert, and
  // the reason survives the refusal.
  const safety = await signIn(browser, seedAccessTokens.marta);
  const safetyAskId = await createAsk(
    safety.context,
    "She fell last week and I am scared she will wander out of the house.",
  );
  createdAskIds.push(safetyAskId);
  await safety.context.close();

  const grace = await signIn(browser, seedAccessTokens.grace);
  await grace.page.goto(`/desk/ask/${safetyAskId}`);
  const overrideForm = grace.page.getByTestId("hold-override-form");
  await expect(overrideForm).toBeVisible();
  const reason =
    "I called her daughter at 9am. No immediate danger, and the family agreed to a first visit together.";
  await grace.page.getByTestId("hold-override-reason").fill(reason);
  // Point the stale form at another ask so the server refuses it while the
  // typed reason is still in the DOM.
  await grace.page.evaluate(() => {
    const input = document.querySelector(
      '[data-testid="hold-override-form"] input[name="askId"]',
    ) as HTMLInputElement | null;
    if (input) input.value = "00000000-0000-4000-8000-000000000000";
  });
  await grace.page.getByTestId("hold-override-confirm").check();
  await grace.page.getByTestId("hold-override-submit").click();
  await expect(grace.page.locator("main").getByRole("alert")).toHaveCount(1);
  await expect(grace.page.getByTestId("hold-override-reason")).toHaveValue(reason);
  await grace.context.close();
});

test("plain language: no banned claim and no caregiver label in the first line of the ask flow", async ({
  browser,
}) => {
  const { context, page } = await signIn(browser, seedAccessTokens.marta);
  await page.goto("/ask");

  const mainText = (await page.locator("main").innerText()).toLowerCase();
  const heading = (await page.locator("main h1").innerText()).toLowerCase();
  const lead = (
    await page.locator("main p.text-xl").first().innerText()
  ).toLowerCase();

  // The first line of the flow is the heading and its lead. Neither names the
  // person "caregiver" nor the break "respite".
  expect(heading).not.toMatch(/caregiver|respite/);
  expect(lead).not.toMatch(/caregiver|respite/);
  expect(`${heading} ${lead}`).toMatch(/hard week|own words|marta/);
  // And the page as a whole does not use those words as a label for her.
  expect(mainText).not.toMatch(/caregiver/);
  expect(mainText).not.toMatch(/respite/);

  const banned = [...REQUIRED_BANNED_CLAIMS, ...BANNED_CLAIMS];
  const rendered = mainText;
  for (const phrase of new Set(banned)) {
    expect(
      rendered.includes(phrase.toLowerCase()),
      `banned claim "${phrase}" on /ask`,
    ).toBe(false);
  }
  await context.close();

  // The same scan over the other primary screens.
  for (const route of ROLE_ROUTES) {
    const session = await signIn(browser, route.token);
    await session.page.goto(route.path);
    const text = (await session.page.locator("main").innerText()).toLowerCase();
    for (const phrase of new Set(banned)) {
      expect(
        text.includes(phrase.toLowerCase()),
        `banned claim "${phrase}" on ${route.path}`,
      ).toBe(false);
    }
    await session.context.close();
  }
});

test("the landing's step cards share a height and the failure path keeps its weight", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto("/");

  const steps = page.getByTestId("landing-step-card");
  await expect(steps).toHaveCount(3);
  const heights = await steps.evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
  );
  expect(new Set(heights).size, `step heights ${heights.join("/")}`).toBe(1);
  expect(heights[0]).toBeGreaterThan(120);

  const failure = page.getByTestId("landing-failure-card");
  await expect(failure).toBeVisible();
  await expect(
    failure.getByRole("heading", { level: 2, name: /if nobody claims it/i }),
  ).toBeVisible();
  const box = await failure.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual((await page.viewportSize())!.width * 0.6);
  const failureStyle = await failure.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      background: style.backgroundColor,
      borderWidth: style.borderTopWidth,
    };
  });
  // A tinted card, not a footnote: it carries the same border and a surface of
  // its own.
  expect(failureStyle.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(Number.parseFloat(failureStyle.borderWidth)).toBeGreaterThanOrEqual(1);

  // Its heading is set at the same size as the step titles, so the failure
  // path reads with the same weight as the happy path.
  const headingSizes = await page.evaluate(() => {
    const step = document.querySelector('[data-testid="landing-step-card"] h3');
    const fail = document.querySelector('[data-testid="landing-failure-card"] h2');
    if (!step || !fail) return null;
    return [getComputedStyle(step).fontSize, getComputedStyle(fail).fontSize];
  });
  expect(headingSizes).not.toBeNull();
  expect(headingSizes![0]).toBe(headingSizes![1]);

  await shot(page, "landing-cards");
  await context.close();
});

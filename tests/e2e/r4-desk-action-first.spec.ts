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
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-R4VIS-005 on the real surface: the desk leads with the action.
 *
 * The first coordinator-desk section heading is `Call today`, a safety row's
 * visible title starts `Call {name} today`, and the personal-care group is
 * `Needs professional help`. The old category names are absent from every
 * heading, group label and pin label. The pre-existing order is unchanged:
 * safety still renders above the unclaimed-times group and above the calendar,
 * and `data-testid="desk-coverage-watch"` still resolves there.
 *
 * The call promise is not softened: the coverage group still says
 * "A person calls; the app sends nothing." word for word.
 *
 * A safety ask whose caregiver has no usable first name reads "Call the family
 * today". `person.first_name` is required but not non-empty, so the fallback is
 * rendered from a fixture church of its own rather than assumed.
 */

const SAFETY_ASK =
  "She fell last week and I am scared she will wander out of the house.";
const CARE_ASK = "I need help with bathing and remembering her medication.";
const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.\n\nShe loves hymns and tea, and she naps after lunch.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "r4-desk-action-first",
);

// A church of its own for the row with no usable name. Every row is
// stable-id and insert-only, so a retry reads the same desk.
const FIXTURE_CHURCH = "d7000000-0000-4000-8000-000000000001";
const FIXTURE_COORDINATOR = "d7000000-0000-4000-8000-000000000002";
const FIXTURE_CAREGIVER = "d7000000-0000-4000-8000-000000000003";
const FIXTURE_RECIPIENT = "d7000000-0000-4000-8000-000000000004";
const FIXTURE_POLICY = "d7000000-0000-4000-8000-000000000005";
const FIXTURE_ASK = "d7000000-0000-4000-8000-000000000006";

const FIXTURE_COORDINATOR_TOKEN = "e2e-desk-action-first-coordinator";

const FIXTURE_WORDS =
  "She wandered out of the house last night and I could not find her for an hour.";

async function ensureNamelessFixture(db: E2eDatabase): Promise<void> {
  await db.client`
    INSERT INTO church (id, name, timezone)
    VALUES (${FIXTURE_CHURCH}, 'Action First Fellowship', 'America/New_York')
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO person (id, church_id, first_name, last_name, roles, access_token)
    VALUES
      (${FIXTURE_COORDINATOR}, ${FIXTURE_CHURCH}, 'Ada', 'Coordinator', '["coordinator"]'::jsonb, ${FIXTURE_COORDINATOR_TOKEN}),
      (${FIXTURE_CAREGIVER}, ${FIXTURE_CHURCH}, '', 'Caregiver', '["caregiver"]'::jsonb, 'e2e-desk-action-first-caregiver')
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO caregiver (person_id) VALUES (${FIXTURE_CAREGIVER})
    ON CONFLICT (person_id) DO NOTHING
  `;

  await db.client`
    INSERT INTO care_recipient (id, church_id, first_name, relation, created_by_caregiver_id)
    VALUES (${FIXTURE_RECIPIENT}, ${FIXTURE_CHURCH}, 'Mum', 'mother', ${FIXTURE_CAREGIVER})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO policy (
      id, church_id, version, safeguarding_promises, question_set,
      crisis_script, referral_resources, reminder_window_hours,
      call_threshold_hours, signed_off_by, signed_off_at
    )
    VALUES (
      ${FIXTURE_POLICY}, ${FIXTURE_CHURCH}, 1, '[]'::jsonb, '[]'::jsonb,
      'Call the family today.', '[]'::jsonb, 24, 48, 'Ada', now()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO ask (
      id, church_id, caregiver_id, care_recipient_id, verbatim_text,
      status, policy_version_id
    )
    VALUES (
      ${FIXTURE_ASK}, ${FIXTURE_CHURCH}, ${FIXTURE_CAREGIVER},
      ${FIXTURE_RECIPIENT}, ${FIXTURE_WORDS}, 'safety_hold', ${FIXTURE_POLICY}
    )
    ON CONFLICT (id) DO NOTHING
  `;
}

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

async function createAsk(
  context: BrowserContext,
  text: string,
): Promise<string> {
  const response = await context.request.post("/api/asks", {
    data: { text, consent: true },
    // The first write after a cold Neon compute can take longer than
    // Playwright's 10 s default; the documented wake is 5.4–5.6 s.
    timeout: 45_000,
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { askId: string };
  return body.askId;
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

test.describe.configure({ timeout: 240_000 });

let db: E2eDatabase;

test.beforeAll(async () => {
  db = await openE2eDatabase();
  await ensureNamelessFixture(db);
});

test.afterAll(async () => {
  await db.client.end();
});

test("VAL-R4VIS-005 — the desk leads with the action and keeps its order", async ({
  browser,
}) => {
  const priya = await signIn(browser, seedAccessTokens.priya);
  const safetyId = await createAsk(priya.context, SAFETY_ASK);
  const heroId = await createAsk(priya.context, HERO_ASK);
  await priya.context.close();

  const david = await signIn(browser, seedAccessTokens.david);
  const careId = await createAsk(david.context, CARE_ASK);
  await david.context.close();

  const grace = await signIn(browser, seedAccessTokens.grace);

  try {
    for (const viewport of [
      { label: "1280x800", width: 1280, height: 800 },
      { label: "360x800", width: 360, height: 800 },
    ]) {
      await grace.page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await grace.page.goto("/desk");

      const safety = grace.page.getByTestId("desk-category-safety");
      const care = grace.page.getByTestId("desk-category-personal_care");
      const waiting = grace.page.getByTestId("desk-category-waiting");
      const coverage = grace.page.getByTestId("desk-coverage-watch");

      // The seed always holds Priya's safety ask, so the first section exists.
      await expect(safety.getByRole("heading", { level: 2 })).toHaveText(
        "Call today",
      );
      await expect(care.getByRole("heading", { level: 2 })).toHaveText(
        "Needs professional help",
      );
      await expect(waiting.getByRole("heading", { level: 2 })).toHaveText(
        "Waiting for a person",
      );
      await expect(coverage.getByRole("heading", { level: 2 })).toHaveText(
        "Times nobody has taken yet",
      );
      await expect(grace.page.locator("main h2").first()).toHaveText(
        "Call today",
      );

      // A safety row leads with the call, then the reason, then the way in.
      const row = grace.page.locator(
        `[data-testid="desk-category-safety"] [data-ask-id="${safetyId}"]`,
      );
      await expect(row).toBeVisible();
      const title = row.getByTestId("desk-row-title");
      await expect(title).toContainText("Call Priya today");
      await expect(
        row.getByRole("link", { name: /^Call Priya today/ }),
      ).toBeVisible();
      const titleBox = await title.boundingBox();
      const reasonBox = await row.getByTestId("desk-reason-summary").boundingBox();
      expect(titleBox!.y).toBeLessThan(reasonBox!.y);
      await expect(row.getByTestId("desk-pin-label")).toHaveText("Call today");

      // The order is unchanged: safety, then the unclaimed times, then the
      // calendar. Both the DOM and the rendered y-position agree.
      const order = await grace.page.evaluate(() => {
        const selectors = [
          '[data-testid="desk-category-safety"]',
          '[data-testid="desk-coverage-watch"]',
          '[data-testid="desk-session-strip"]',
        ];
        const nodes = selectors.map((selector) =>
          document.querySelector(selector),
        );
        return {
          present: nodes.every((node) => node !== null),
          first: nodes[0]?.compareDocumentPosition(nodes[1]!) ?? 0,
          second: nodes[0]?.compareDocumentPosition(nodes[2]!) ?? 0,
        };
      });
      expect(order.present).toBe(true);
      expect(order.first & 4).toBe(4);
      expect(order.second & 4).toBe(4);

      const tops = await grace.page.evaluate(() =>
        [
          "desk-category-safety",
          "desk-coverage-watch",
          "desk-session-strip",
        ].map((testId) => {
          const element = document.querySelector(`[data-testid="${testId}"]`);
          return element
            ? element.getBoundingClientRect().top + window.scrollY
            : null;
        }),
      );
      expect(tops[0]).not.toBeNull();
      expect(tops[1]).not.toBeNull();
      expect(tops[2]).not.toBeNull();
      expect(tops[0]!).toBeLessThan(tops[1]!);
      expect(tops[0]!).toBeLessThan(tops[2]!);

      // The retired labels are gone; the call promise is untouched.
      const mainText = await grace.page.locator("main").innerText();
      expect(mainText).not.toMatch(
        /safety hold|personal-care hold|coverage watch/i,
      );
      await expect(coverage).toContainText(
        "A person calls; the app sends nothing.",
      );

      await shot(grace.page, `desk-${viewport.label}`);
    }

    // ---- The ask review page -------------------------------------------
    await grace.page.setViewportSize({ width: 1280, height: 800 });

    let response = await grace.page.goto(`/desk/ask/${safetyId}`);
    expect(response?.status()).toBe(200);
    await expect(
      grace.page.getByText("Call today — no time is offered yet", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      grace.page.getByRole("heading", { name: "Times the rules propose" }),
    ).toBeVisible();
    let askText = await grace.page.locator("main").innerText();
    expect(askText).not.toMatch(/plain code/i);
    expect(askText).not.toMatch(/\bgated\b/i);
    expect(askText).not.toMatch(/safety hold|personal-care hold/i);
    await shot(grace.page, "ask-safety-1280x800");

    response = await grace.page.goto(`/desk/ask/${careId}`);
    expect(response?.status()).toBe(200);
    await expect(
      grace.page.getByText("Needs professional help — no volunteer time", {
        exact: true,
      }),
    ).toBeVisible();
    askText = await grace.page.locator("main").innerText();
    expect(askText).not.toMatch(/plain code/i);
    expect(askText).not.toMatch(/\bgated\b/i);
    expect(askText).not.toMatch(/personal-care hold|safety hold/i);

    // The draft heading, the "rules" wording and the two exclusion chips on a
    // waiting ask with real drafts.
    for (const viewport of [
      { label: "1280x800", width: 1280, height: 800 },
      { label: "360x800", width: 360, height: 800 },
    ]) {
      await grace.page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      response = await grace.page.goto(`/desk/ask/${heroId}`);
      expect(response?.status()).toBe(200);
      await expect(grace.page.getByTestId("draft-editor")).toBeVisible();
      await expect(
        grace.page.getByRole("heading", { name: "Times the rules propose" }),
      ).toBeVisible();
      await expect(grace.page.getByTestId("draft-list")).toBeVisible();
      await expect(
        grace.page.locator('[data-testid="exclusion-slot"]').first(),
      ).toBeVisible();
      await expect(
        grace.page
          .locator('[data-testid="exclusion-window"]')
          .filter({ hasText: "· Needs checks" })
          .first(),
      ).toBeVisible();
      await expect(
        grace.page
          .locator('[data-testid="exclusion-window"]')
          .filter({ hasText: "· No extra checks" })
          .first(),
      ).toBeVisible();
      askText = await grace.page.locator("main").innerText();
      expect(askText).not.toMatch(/plain code/i);
      expect(askText).not.toMatch(/\bgated\b/i);
      // No heading or control carries the retired category or restriction.
      await expect(
        grace.page.getByRole("heading", { name: /gated|plain code/i }),
      ).toHaveCount(0);
      await expect(
        grace.page.getByRole("button", { name: /gated|plain code/i }),
      ).toHaveCount(0);
      await expect(
        grace.page.getByRole("link", { name: /gated|plain code/i }),
      ).toHaveCount(0);
      await shot(grace.page, `ask-hero-${viewport.label}`);
    }
  } finally {
    await grace.context.close();
  }
});

test("VAL-R4VIS-005 — a safety row with no usable name still leads with the call", async ({
  browser,
}) => {
  const ada = await signIn(browser, FIXTURE_COORDINATOR_TOKEN);

  try {
    await ada.page.setViewportSize({ width: 1280, height: 800 });
    const response = await ada.page.goto("/desk");
    expect(response?.status()).toBe(200);

    const row = ada.page.locator(
      `[data-testid="desk-category-safety"] [data-ask-id="${FIXTURE_ASK}"]`,
    );
    await expect(row).toBeVisible();

    // `person.first_name` is required but not non-empty, so this ask really
    // has no name to use. The row says which family to call instead of drawing
    // a blank line or the word "undefined".
    const title = row.getByTestId("desk-row-title");
    await expect(title).toHaveText(/^Call the family today/);
    const titleText = await title.innerText();
    expect(titleText.startsWith("Call the family today")).toBe(true);
    expect(titleText).not.toMatch(/undefined|null/i);

    await expect(row.getByTestId("desk-pin-label")).toHaveText("Call today");
    await ada.page.locator('[data-testid="desk-category-safety"]').scrollIntoViewIfNeeded();
    await shot(ada.page, "desk-no-name-1280x800");
  } finally {
    await ada.context.close();
  }
});

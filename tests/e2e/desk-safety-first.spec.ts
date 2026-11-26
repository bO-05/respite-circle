import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";
import { seedAccessTokens } from "../../src/db/seed-data";

/**
 * VAL-R2UI-001 on the real surface: safety comes first on the desk.
 *
 * A fixture church of its own holds one safety-held ask, one ordinary waiting
 * ask, and one published time that is already due for a call. At 1280x800 and
 * at 360x800 the safety group renders above the coverage watch and above the
 * Respite Morning calendar, its heading is larger than the routine groups',
 * and its card carries a labelled 44x44 way into the ask beside the name link.
 * The zero on the coverage watch is ordinary text with the promise spelled
 * out, never an amber warning.
 *
 * The same church holds one human audit entry and nothing from the AI or the
 * app, so the decision log's default empty state can be read as a coordinator
 * meets it. Its rows lead with when, who and what; ids come last.
 */

const DESK_CHURCH = "d6000000-0000-4000-8000-000000000001";
const DESK_COORDINATOR = "d6000000-0000-4000-8000-000000000002";
const DESK_CAREGIVER = "d6000000-0000-4000-8000-000000000003";
const DESK_RECIPIENT = "d6000000-0000-4000-8000-000000000004";
const DESK_POLICY = "d6000000-0000-4000-8000-000000000005";
const DESK_SAFETY_ASK = "d6000000-0000-4000-8000-000000000006";
const DESK_WAITING_ASK = "d6000000-0000-4000-8000-000000000007";
const DESK_OPEN_SLOT = "d6000000-0000-4000-8000-000000000008";
const DESK_AUDIT_EVENT = "d6000000-0000-4000-8000-000000000009";

const DESK_COORDINATOR_TOKEN = "e2e-desk-safety-coordinator";
const DESK_CAREGIVER_TOKEN = "e2e-desk-safety-caregiver";

const TIME_ZONE = "America/New_York";
const HOUR = 3_600_000;

const SAFETY_WORDS =
  "Sometimes I want to die. Could someone sit with Mum this Saturday?";
const WAITING_WORDS =
  "A Tuesday morning would help. She loves hymns and tea, and she naps after lunch.";

const AMBER_SOFT = "rgb(253, 240, 213)";
const AMBER = "rgb(168, 106, 18)";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "desk-safety-first",
);

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

/**
 * Insert the fixture church. `ask` and `audit_event` are append-only, so the
 * rows are stable-id and insert-only; the one time is never claimed, called,
 * or closed by this spec, so a retry reads the same desk.
 */
async function ensureFixture(db: E2eDatabase): Promise<void> {
  const now = new Date();
  const watchStart = new Date(now.getTime() + 12 * HOUR);
  const watchEnd = new Date(now.getTime() + 14 * HOUR);

  await db.client`
    INSERT INTO church (id, name, timezone)
    VALUES (${DESK_CHURCH}, 'Safety First Fellowship', ${TIME_ZONE})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO person (id, church_id, first_name, last_name, roles, access_token)
    VALUES
      (${DESK_COORDINATOR}, ${DESK_CHURCH}, 'Grace', 'First', '["coordinator"]'::jsonb, ${DESK_COORDINATOR_TOKEN}),
      (${DESK_CAREGIVER}, ${DESK_CHURCH}, 'Priya', 'First', '["caregiver"]'::jsonb, ${DESK_CAREGIVER_TOKEN})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO caregiver (person_id) VALUES (${DESK_CAREGIVER})
    ON CONFLICT (person_id) DO NOTHING
  `;

  await db.client`
    INSERT INTO care_recipient (id, church_id, first_name, relation, created_by_caregiver_id)
    VALUES (${DESK_RECIPIENT}, ${DESK_CHURCH}, 'Rao', 'father', ${DESK_CAREGIVER})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO policy (
      id, church_id, version, safeguarding_promises, question_set,
      crisis_script, referral_resources, reminder_window_hours,
      call_threshold_hours, signed_off_by, signed_off_at
    )
    VALUES (
      ${DESK_POLICY}, ${DESK_CHURCH}, 1, '[]'::jsonb, '[]'::jsonb,
      'Call the family today.', '[]'::jsonb, 24, 48, 'Grace', now()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO ask (
      id, church_id, caregiver_id, care_recipient_id, verbatim_text,
      status, policy_version_id
    )
    VALUES
      (
        ${DESK_SAFETY_ASK}, ${DESK_CHURCH}, ${DESK_CAREGIVER},
        ${DESK_RECIPIENT}, ${SAFETY_WORDS}, 'safety_hold', ${DESK_POLICY}
      ),
      (
        ${DESK_WAITING_ASK}, ${DESK_CHURCH}, ${DESK_CAREGIVER},
        ${DESK_RECIPIENT}, ${WAITING_WORDS}, 'waiting_coordinator',
        ${DESK_POLICY}
      )
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO slot (
      id, ask_id, church_id, kind, tier, label, window_start, window_end,
      gated, rule_ref, status, approved_by, approved_at
    )
    VALUES (
      ${DESK_OPEN_SLOT}, ${DESK_WAITING_ASK}, ${DESK_CHURCH}, 'home',
      'in_home', 'A Saturday morning at home',
      ${watchStart.toISOString()}::timestamptz,
      ${watchEnd.toISOString()}::timestamptz,
      true, 'q6_home', 'open', ${DESK_COORDINATOR}, now()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  // One person acted; the AI and the app have not. That is the default state
  // the decision log must describe honestly.
  await db.client`
    INSERT INTO audit_event (
      id, church_id, actor_type, actor_id, action, entity, entity_id, detail,
      created_at
    )
    VALUES (
      ${DESK_AUDIT_EVENT}, ${DESK_CHURCH}, 'human', ${DESK_CAREGIVER},
      'ask_submitted', 'ask', ${DESK_WAITING_ASK}, '{}'::jsonb,
      ${now.toISOString()}::timestamptz
    )
    ON CONFLICT (id) DO NOTHING
  `;
}

/** Every background colour from an element up to the document root. */
async function ancestorBackgrounds(page: Page, testId: string): Promise<{
  text: string;
  backgrounds: string[];
} | null> {
  return page.evaluate((id) => {
    const line = document.querySelector(`[data-testid="${id}"]`);
    if (!line) return null;
    const backgrounds: string[] = [];
    let node: Element | null = line;
    while (node && node !== document.documentElement) {
      backgrounds.push(getComputedStyle(node).backgroundColor);
      node = node.parentElement;
    }
    return { text: line.textContent ?? "", backgrounds };
  }, testId);
}

test.describe.configure({ timeout: 150_000 });

test.describe("VAL-R2UI-001 — safety asks come first on the desk", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
    await ensureFixture(db);
  });

  test.afterAll(async () => {
    await db.client.end();
  });

  test("VAL-R2UI-001 — a safety hold is above coverage watch and the calendar, with a labelled way in", async ({
    browser,
  }) => {
    const grace = await signIn(browser, DESK_COORDINATOR_TOKEN);

    try {
      for (const viewport of [
        { label: "wide", width: 1280, height: 800 },
        { label: "narrow", width: 360, height: 800 },
      ]) {
        await grace.page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        await grace.page.goto("/desk");

        const safety = grace.page.getByTestId("desk-category-safety");
        const coverage = grace.page.getByTestId("desk-coverage-watch");
        const calendar = grace.page.getByTestId("desk-session-strip");
        await expect(safety).toBeVisible({ timeout: 30_000 });
        await expect(coverage).toBeVisible();
        await expect(calendar).toBeVisible();
        // VAL-R3LANG-002 — the second group is named for the work, not for an
        // internal category, and the testid above is the ordering anchor.
        await expect(coverage.getByRole("heading", { level: 2 })).toHaveText(
          "Times nobody has taken yet",
        );

        // DOM order, not only pixels: the safety group is the first of the
        // three, so a screen reader meets it first too.
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
        // 4 is DOCUMENT_POSITION_FOLLOWING: the second node comes after the
        // first in the document, not only higher on the screen.
        expect(order.first & 4).toBe(4);
        expect(order.second & 4).toBe(4);

        const positions = await grace.page.evaluate(() =>
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
        expect(positions[0]).not.toBeNull();
        expect(positions[1]).not.toBeNull();
        expect(positions[2]).not.toBeNull();
        expect(positions[0]!).toBeLessThan(positions[1]!);
        expect(positions[0]!).toBeLessThan(positions[2]!);
        expect(
          positions[0]!,
          `the safety group starts inside the first ${viewport.height}px`,
        ).toBeLessThan(viewport.height);

        await shot(grace.page, `desk-first-viewport-${viewport.label}`);
      }

      // A hold is the highest-priority group, not a twin of routine coverage.
      await grace.page.setViewportSize({ width: 1280, height: 800 });
      await grace.page.goto("/desk");
      const hierarchy = await grace.page.evaluate(() => {
        const read = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          return {
            fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
            background: getComputedStyle(element).backgroundColor,
          };
        };
        return {
          safetyHeading: read('[data-testid="desk-category-safety"] h2'),
          coverageHeading: read('[data-testid="desk-coverage-watch"] h2'),
          waitingHeading: read('[data-testid="desk-category-waiting"] h2'),
          safetyPanel: read('[data-testid="desk-category-safety"]'),
          coveragePanel: read('[data-testid="desk-coverage-watch"]'),
        };
      });
      expect(hierarchy.safetyHeading).not.toBeNull();
      expect(hierarchy.coverageHeading).not.toBeNull();
      expect(hierarchy.waitingHeading).not.toBeNull();
      expect(hierarchy.safetyHeading!.fontSize).toBeGreaterThan(
        hierarchy.coverageHeading!.fontSize,
      );
      expect(hierarchy.safetyHeading!.fontSize).toBeGreaterThan(
        hierarchy.waitingHeading!.fontSize,
      );
      expect(hierarchy.safetyPanel!.background).not.toBe(
        hierarchy.coveragePanel!.background,
      );

      // The card carries a labelled action beside the name link.
      const row = grace.page.locator(
        `[data-testid="desk-category-safety"] [data-ask-id="${DESK_SAFETY_ASK}"]`,
      );
      await expect(row).toBeVisible();
      const links = row.locator(`a[href="/desk/ask/${DESK_SAFETY_ASK}"]`);
      await expect(links).toHaveCount(2);

      const action = row.getByTestId("desk-hold-open");
      await expect(action).toBeVisible();
      await expect(action).toContainText(/open this ask/i);
      await expect(action).toHaveAttribute(
        "href",
        `/desk/ask/${DESK_SAFETY_ASK}`,
      );
      const box = await action.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await shot(grace.page, "desk-safety-card-action");

      // The action is a real way in.
      await action.click();
      await expect(grace.page).toHaveURL(
        new RegExp(`/desk/ask/${DESK_SAFETY_ASK}$`),
      );
      await expect(grace.page.getByTestId("hold-card")).toBeVisible();

      // At the narrow width the action keeps its 44x44 target.
      await grace.page.setViewportSize({ width: 360, height: 800 });
      await grace.page.goto("/desk");
      const narrowBox = await grace.page
        .getByTestId("desk-category-safety")
        .getByTestId("desk-hold-open")
        .boundingBox();
      expect(narrowBox?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(narrowBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    } finally {
      await grace.context.close();
    }
  });

  test("VAL-R2UI-001 — the zero-message line is neutral text that names the promise", async ({
    browser,
  }) => {
    const grace = await signIn(browser, DESK_COORDINATOR_TOKEN);

    try {
      await grace.page.goto("/desk");

      const zero = await ancestorBackgrounds(
        grace.page,
        "desk-coverage-row-count",
      );
      expect(zero).not.toBeNull();
      expect(zero!.text).toContain(
        "Messages sent to the caregiver about this slot: 0",
      );
      for (const background of zero!.backgrounds) {
        expect(background).not.toBe(AMBER_SOFT);
        expect(background).not.toBe(AMBER);
      }
      await expect(
        grace.page.getByTestId("desk-coverage-row-promise"),
      ).toContainText(/promise/i);
      await shot(grace.page, "desk-coverage-zero-neutral");

      // The full card states the same zero the same way.
      await grace.page.goto("/desk/failures");
      const card = grace.page
        .locator(
          `[data-testid="coverage-card"][data-slot-id="${DESK_OPEN_SLOT}"]`,
        )
        .first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      const cardZero = await ancestorBackgrounds(
        grace.page,
        "coverage-message-count",
      );
      expect(cardZero).not.toBeNull();
      expect(cardZero!.text).toContain(
        "Messages sent to the caregiver about this slot: 0",
      );
      for (const background of cardZero!.backgrounds) {
        expect(background).not.toBe(AMBER_SOFT);
        expect(background).not.toBe(AMBER);
      }
      await expect(
        card.getByTestId("coverage-silence-promise"),
      ).toContainText(/promise/i);
      await shot(grace.page, "coverage-card-zero-neutral");
    } finally {
      await grace.context.close();
    }
  });

  test("VAL-R2UI-001 — the decision log names its default state and scans when, who, what, then ids", async ({
    browser,
  }) => {
    const grace = await signIn(browser, DESK_COORDINATOR_TOKEN);

    try {
      await grace.page.goto("/desk/audit");

      // No filter is applied: each empty list says what is actually true.
      await expect(grace.page.getByTestId("audit-empty-system")).toContainText(
        "Nothing has happened automatically yet.",
      );
      await expect(
        grace.page.getByTestId("audit-empty-system"),
      ).not.toContainText("matches these filters");
      await expect(grace.page.getByTestId("audit-empty-ai")).toContainText(
        "The AI has not answered anything yet.",
      );
      await shot(grace.page, "audit-default-state");

      // With a filter, the sentence names the filter instead.
      await grace.page.goto("/desk/audit?entity=ask");
      await expect(grace.page.getByTestId("audit-empty-system")).toContainText(
        "No app action matches these filters.",
      );
      await expect(grace.page.getByTestId("audit-empty-ai")).toContainText(
        "No AI decision matches these filters.",
      );

      // A row reads when, who, what, then the ids in its detail block.
      await grace.page.goto("/desk/audit");
      const row = grace.page.getByTestId("audit-row").first();
      await expect(row).toBeVisible();
      const labels = await row
        .locator("dt")
        .evaluateAll((elements) =>
          elements.map((element) => element.textContent),
        );
      expect(labels).toEqual([
        "When",
        "Decided by",
        "What happened",
        "About",
        "Detail",
      ]);
      await expect(row.getByTestId("audit-time")).not.toBeEmpty();
      await expect(
        row.getByTestId("audit-time").locator("time"),
      ).toHaveAttribute("datetime", /.+/);
      await expect(row.getByTestId("audit-actor")).toContainText("Priya First");
      await expect(row.getByTestId("audit-entity")).toHaveText("Ask");
      const html = await row.innerHTML();
      const time = html.indexOf('data-testid="audit-time"');
      const entityId = html.indexOf("d6000000");
      expect(time).toBeGreaterThanOrEqual(0);
      expect(entityId).toBeGreaterThan(time);
      await shot(grace.page, "audit-row-order");
    } finally {
      await grace.context.close();
    }
  });

  test("VAL-R2UI-001 — the seeded demo desk keeps the order at 1280x800 and 360x800", async ({
    browser,
  }) => {
    // The contract's own surface: the seeded coordinator, after the demo reset
    // the suite's global setup runs. This is the screen a visitor meets.
    const grace = await signIn(browser, seedAccessTokens.grace);

    try {
      for (const viewport of [
        { label: "wide", width: 1280, height: 800 },
        { label: "narrow", width: 360, height: 800 },
      ]) {
        await grace.page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        await grace.page.goto("/desk");

        await expect(grace.page.getByTestId("desk-category-safety")).toBeVisible(
          { timeout: 30_000 },
        );
        await expect(grace.page.getByTestId("desk-coverage-watch")).toBeVisible();
        await expect(grace.page.getByTestId("desk-session-strip")).toBeVisible();

        const tops = await grace.page.evaluate(() =>
          ["desk-category-safety", "desk-coverage-watch", "desk-session-strip"]
            .map((testId) => {
              const element = document.querySelector(
                `[data-testid="${testId}"]`,
              );
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
        expect(
          tops[0]!,
          `the safety group starts inside the first ${viewport.height}px`,
        ).toBeLessThan(viewport.height);

        const action = grace.page
          .getByTestId("desk-category-safety")
          .getByTestId("desk-hold-open")
          .first();
        await expect(action).toBeVisible();
        const box = await action.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

        await shot(grace.page, `seeded-desk-${viewport.label}`);
      }
    } finally {
      await grace.context.close();
    }
  });

  test("VAL-R2UI-001 — a caregiver is still refused the desk and its log", async ({
    browser,
  }) => {
    const priya = await signIn(browser, DESK_CAREGIVER_TOKEN);

    try {
      for (const route of ["/desk", "/desk/audit", "/desk/failures"]) {
        const response = await priya.context.request.get(route, {
          maxRedirects: 0,
        });
        expect(response.status(), `${route} must refuse a caregiver`).toBe(403);
        const body = await response.text();
        expect(body).not.toContain("Coordinator desk");
        expect(body).not.toContain("Safety First Fellowship");
      }

      await priya.page.goto("/desk");
      await expect(
        priya.page.getByRole("heading", {
          name: /that area isn't part of your role/i,
        }),
      ).toBeVisible();
      await expect(priya.page).not.toHaveTitle(/desk/i);
    } finally {
      await priya.context.close();
    }
  });
});

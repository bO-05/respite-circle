import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { readAllTableCounts } from "../../src/db/counts";
import { DEMO_IDS } from "../../src/db/demo-state";
import { seedAccessTokens, seedChurch, seedIds } from "../../src/db/seed-data";
import type { SeedDb } from "../../src/db/seed";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";
import { E2E_RESET_PATH, E2E_RESET_TOKEN } from "./helpers/e2e-env";

/**
 * VAL-CROSS-006 and VAL-DEMO-001 on the running production build.
 *
 * The reset is the suite's fixture and the judge's between-walkthrough control.
 * These tests prove the guard (no token, wrong token), the twelve verified
 * assertions, the demo-ready board a judge can walk into, the preserved
 * failure path, refusal on a forced assertion failure, determinism across two
 * resets, and truncation restoring seeded wording an edit had changed.
 */

type ResetEngine = {
  askId: string;
  label: string;
  engine: "live" | "deterministic" | "mixed" | "none";
  providers: string[];
  models: string[];
  latencyMs: number | null;
  questionCount: number;
  fallbackReason: string | null;
};

type ResetSuccess = {
  reset: true;
  mode?: "rules" | "live";
  engines?: ResetEngine[];
  church: string;
  seedDigest: string;
  counts: Record<string, number>;
  assertions: { passed: number; total: number; failed: string[] };
};

type ResetFailure = {
  reset: false;
  church?: string;
  seedDigest: null;
  failed: string[];
  assertions?: { passed: number; total: number; failed: string[] };
  failures?: Array<{ id: string; message: string }>;
};

const RESET_TIMEOUT = 90_000;

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

async function reset(
  request: APIRequestContext,
  headers: Record<string, string> = {},
): Promise<ResetSuccess> {
  const response = await request.post(E2E_RESET_PATH, {
    headers: { "x-demo-reset-token": E2E_RESET_TOKEN, ...headers },
    timeout: RESET_TIMEOUT,
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as ResetSuccess;
  expect(body.reset).toBe(true);
  return body;
}

async function counts(db: E2eDatabase): Promise<Record<string, number>> {
  return readAllTableCounts(db.db as unknown as SeedDb);
}

/** Stable starting state: ids and statuses, never publication instants. */
async function startingState(db: E2eDatabase) {
  const [rowCounts, asks, slots, notifications] = await Promise.all([
    counts(db),
    db.client<Array<{ id: string; status: string; verbatim_text: string }>>`
      SELECT id, status, verbatim_text FROM ask ORDER BY id
    `,
    db.client<
      Array<{
        id: string;
        kind: string;
        status: string;
        gated: boolean;
        claimed_by: string | null;
      }>
    >`
      SELECT id, kind, status, gated, claimed_by FROM slot ORDER BY id
    `,
    db.client<Array<{ slot_id: string; kind: string }>>`
      SELECT slot_id, kind FROM notification ORDER BY id
    `,
  ]);

  return { counts: rowCounts, asks, slots, notifications };
}

test.describe.configure({ timeout: 300_000 });

test.describe("VAL-CROSS-006 and VAL-DEMO-001 — demo reset", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    await db.client.end();
  });

  test("VAL-DEMO-001 — requires its token and reports twelve verified assertions", async ({
    request,
  }) => {
    const missing = await request.post(E2E_RESET_PATH, {
      failOnStatusCode: false,
      timeout: RESET_TIMEOUT,
    });
    expect(missing.status()).toBe(401);
    const missingBody = (await missing.json()) as ResetFailure;
    expect(missingBody.reset).toBe(false);

    const wrong = await request.post(E2E_RESET_PATH, {
      headers: { "x-demo-reset-token": "not-the-token" },
      failOnStatusCode: false,
      timeout: RESET_TIMEOUT,
    });
    expect(wrong.status()).toBe(403);
    const wrongBody = (await wrong.json()) as ResetFailure;
    expect(wrongBody.reset).toBe(false);

    const ok = await reset(request);
    expect(ok.church).toBe(seedChurch.name);
    expect(ok.seedDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(ok.assertions.passed).toBe(12);
    expect(ok.assertions.total).toBe(12);
    expect(ok.assertions.failed).toEqual([]);
    expect(ok.counts.church).toBe(1);
    expect(ok.counts.person).toBe(9);
    expect(ok.counts.caregiver).toBe(3);
    expect(ok.counts.volunteer).toBe(4);
    expect(ok.counts.policy).toBe(1);
    expect(ok.counts.session_template).toBe(1);
    expect(ok.counts.ask).toBe(4);
    expect(ok.counts.slot).toBe(3);

    // The reset names the engine behind every ask. This asserts the shape and
    // the count, never which engine answered: the suite runs the rules
    // baseline, while a live run is proven separately.
    expect(ok.engines).toHaveLength(4);
    for (const engine of ok.engines ?? []) {
      expect(engine.askId).toMatch(/^[0-9a-f-]{36}$/);
      expect(engine.label.length).toBeGreaterThan(0);
      expect(["live", "deterministic", "mixed", "none"]).toContain(
        engine.engine,
      );
      expect(engine.questionCount).toBe(9);
      expect(engine.providers.length).toBeGreaterThan(0);
      expect(engine.models.length).toBeGreaterThan(0);
    }
  });

  test("VAL-DEMO-001 and VAL-CROSS-002 — leaves a demo-ready board and preserves the failure path", async ({
    browser,
    request,
  }) => {
    await reset(request);

    const [nextSession] = await db.client<Array<{ id: string; starts_at: Date }>>`
      SELECT id, starts_at FROM session
       WHERE starts_at > now()
       ORDER BY starts_at
       LIMIT 1
    `;
    expect(nextSession).toBeTruthy();

    const [hero] = await db.client<Array<{ status: string; approved_by: string | null }>>`
      SELECT status, approved_by FROM ask WHERE id = ${DEMO_IDS.askHero}
    `;
    expect(hero.status).toBe("approved");
    expect(hero.approved_by).toBe(seedIds.people.grace);

    const [companion] = await db.client<
      Array<{
        status: string;
        session_id: string | null;
        approved_at: Date | null;
      }>
    >`
      SELECT status, session_id, approved_at
        FROM slot WHERE id = ${DEMO_IDS.slotCompanion}
    `;
    expect(companion.status).toBe("open");
    expect(companion.session_id).toBe(nextSession.id);
    expect(companion.approved_at).not.toBeNull();

    // The failure-path meal is open, unclaimed, past its reminder window, with
    // no candidate and no notification row at all.
    const [failure] = await db.client<
      Array<{
        status: string;
        claimed_by: string | null;
        approved_at: Date | null;
        window_start: Date | string | null;
        reminder_hours: number;
      }>
    >`
      SELECT s.status, s.claimed_by, s.approved_at, s.window_start,
             p.reminder_window_hours AS reminder_hours
        FROM slot AS s
        JOIN ask AS a ON a.id = s.ask_id
        JOIN policy AS p ON p.id = a.policy_version_id
       WHERE s.id = ${DEMO_IDS.slotFailure}
    `;
    expect(failure.status).toBe("open");
    expect(failure.claimed_by).toBeNull();
    expect(failure.approved_at).not.toBeNull();
    expect(failure.window_start).not.toBeNull();
    const windowStartMs = failure.window_start
      ? new Date(failure.window_start).getTime()
      : Number.NaN;
    expect(
      Date.now() >= windowStartMs - failure.reminder_hours * 60 * 60 * 1_000,
    ).toBe(true);

    const failureCandidates = await db.client<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM slot_candidate
       WHERE slot_id = ${DEMO_IDS.slotFailure}
    `;
    expect(failureCandidates[0].count).toBe(0);
    const failureNotifications = await db.client<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM notification
       WHERE slot_id = ${DEMO_IDS.slotFailure}
    `;
    expect(failureNotifications[0].count).toBe(0);

    // The board a judge opens: Marta's companion place on the next morning,
    // visible to Ruth with one claim action.
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    const boardResponse = await ruth.page.goto("/circle");
    expect(boardResponse?.status()).toBe(200);
    const companionCard = ruth.page.locator(
      `[data-testid="board-slot"][data-slot-id="${DEMO_IDS.slotCompanion}"]`,
    );
    await expect(companionCard).toBeVisible();
    await expect(
      companionCard.getByRole("button", { name: "Claim this time" }),
    ).toBeVisible();
    await expect(ruth.page.getByTestId("board-slot")).not.toHaveCount(0);
    await expect(ruth.page.getByTestId("board-empty")).toHaveCount(0);
    await ruth.context.close();

    // The same failure path on screen: Grace's coverage watch counts zero
    // messages for the untaken meal.
    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto("/desk/failures");
    const failureCard = grace.page.locator(
      `[data-testid="coverage-card"][data-slot-id="${DEMO_IDS.slotFailure}"]`,
    );
    await expect(failureCard).toBeVisible();
    await expect(failureCard.getByTestId("coverage-message-count")).toHaveText(
      "Messages sent to the caregiver about this slot: 0",
    );
    await grace.context.close();
  });

  test("VAL-CROSS-006 — two consecutive resets produce identical counts and starting state", async ({
    request,
  }) => {
    const first = await reset(request);
    const firstState = await startingState(db);

    const second = await reset(request);
    const secondState = await startingState(db);

    expect(second.seedDigest).toBe(first.seedDigest);
    expect(secondState).toEqual(firstState);
  });

  test("VAL-DEMO-001 — refuses to report success when a seeded assertion fails", async ({
    request,
  }) => {
    await reset(request);

    const forced = await request.post(E2E_RESET_PATH, {
      headers: {
        "x-demo-reset-token": E2E_RESET_TOKEN,
        "x-demo-reset-fault": "church",
      },
      failOnStatusCode: false,
      timeout: RESET_TIMEOUT,
    });
    expect(forced.status()).toBe(500);
    const forcedBody = (await forced.json()) as ResetFailure;
    expect(forcedBody.reset).toBe(false);
    expect(forcedBody.seedDigest).toBeNull();
    expect(forcedBody.failed).toContain("church_count");

    // The reset did not quietly repair the fault and claim success.
    const [tampered] = await db.client<Array<{ name: string }>>`
      SELECT name FROM church WHERE id = ${seedChurch.id}
    `;
    expect(tampered.name).toBe("Tampered Church");

    // A second forced failure on the demo-readiness assertion itself.
    const forcedDemo = await request.post(E2E_RESET_PATH, {
      headers: {
        "x-demo-reset-token": E2E_RESET_TOKEN,
        "x-demo-reset-fault": "demo",
      },
      failOnStatusCode: false,
      timeout: RESET_TIMEOUT,
    });
    expect(forcedDemo.status()).toBe(500);
    const forcedDemoBody = (await forcedDemo.json()) as ResetFailure;
    expect(forcedDemoBody.reset).toBe(false);
    expect(forcedDemoBody.failed).toContain("ask_approved_demo_ready");

    // A plain reset restores the tested state.
    const restored = await reset(request);
    expect(restored.assertions.failed).toEqual([]);
    const [church] = await db.client<Array<{ name: string }>>`
      SELECT name FROM church WHERE id = ${seedChurch.id}
    `;
    expect(church.name).toBe(seedChurch.name);
  });

  test("VAL-DEMO-001 — truncates first, so edited seeded wording is restored", async ({
    request,
  }) => {
    await reset(request);

    // An edit to seeded content that the old `ON CONFLICT DO NOTHING` seed
    // would have preserved.
    await db.client`
      UPDATE person SET first_name = 'Stale' WHERE id = ${seedIds.people.grace}
    `;
    await db.client`
      UPDATE session_template SET capacity = 2
    `;
    await db.client`
      UPDATE church SET name = 'Stale Church' WHERE id = ${seedChurch.id}
    `;

    await reset(request);

    const [grace] = await db.client<Array<{ first_name: string }>>`
      SELECT first_name FROM person WHERE id = ${seedIds.people.grace}
    `;
    expect(grace.first_name).toBe("Grace");

    const [template] = await db.client<Array<{ capacity: number }>>`
      SELECT capacity FROM session_template
    `;
    expect(template.capacity).toBe(12);

    const [church] = await db.client<Array<{ name: string }>>`
      SELECT name FROM church WHERE id = ${seedChurch.id}
    `;
    expect(church.name).toBe(seedChurch.name);
  });

  test("VAL-DEMO-001 — the demo reset page checks the token and shows the digest", async ({
    page,
  }) => {
    const response = await page.goto("/demo/reset");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: /reset the demo/i }),
    ).toBeVisible();
    await expect(page.getByTestId("demo-reset-form")).toBeVisible();
    // VAL-R3LANG-003 — plain operator wording, with the twelve-check honesty
    // line it exists to state.
    const resetMain = page.locator("main");
    await expect(resetMain).toContainText("This starts the demo over");
    await expect(resetMain).toContainText("refuses to report success");
    await expect(resetMain).toContainText("twelve checks");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/i,
    );

    // The token is never embedded in the page.
    const html = await page.content();
    expect(html).not.toContain(E2E_RESET_TOKEN);

    await page.getByLabel("Demo reset token").fill("wrong-token");
    await page.getByTestId("demo-reset-submit").click();
    await expect(page.getByTestId("demo-reset-error")).toBeVisible();
    await expect(page.getByTestId("demo-reset-error")).toContainText(
      /did not report success/i,
    );

    await page.getByLabel("Demo reset token").fill(E2E_RESET_TOKEN);
    await page.getByTestId("demo-reset-submit").click();
    await expect(page.getByTestId("demo-reset-result")).toBeVisible({
      timeout: RESET_TIMEOUT,
    });
    await expect(page.getByTestId("demo-reset-result")).toContainText(
      "12 of 12 seed assertions passed",
    );
    await expect(page.getByTestId("demo-reset-digest")).toHaveText(
      /^sha256:[0-9a-f]{64}$/,
    );
  });
});

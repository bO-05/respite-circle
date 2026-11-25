import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { resolveNow } from "../../src/lib/clock";
import { DEMO_IDS } from "../../src/db/demo-state";
import { seedIds } from "../../src/db/seed-data";
import { claimCopy } from "../../src/server/domain/claim";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-R2PROM-001 on the real surface.
 *
 * The board used to list any published time until somebody claimed it, even a
 * time whose morning had already begun, and the claim route would happily take
 * it. This spec builds one quiet church with two published times on either side
 * of one boundary: one started two hours ago, one three days away. Every window
 * is derived from the app clock (`resolveNow`), so the spec passes at the wall
 * clock and under any `RC_FAKE_NOW` — the boundary is never a written date.
 *
 * What it pins:
 *   - the started time is absent from `/circle` and its label is nowhere in the
 *     board's own containers;
 *   - a POST to its claim URL is refused with the existing `not_open` sentence,
 *     writes no claim column, no status change, and no winning audit row;
 *   - the later time still lists and still claims in one click;
 *   - the desk page for the started time reads "started", not "Open on the
 *     board", and still offers the deliberate close, so the status agrees with
 *     what the board shows;
 *   - the four seeded Respite Mornings are still the next four future Tuesdays
 *     and the demo companion place still sits on the first of them.
 */

const CHURCH = "d4000000-0000-4000-8000-000000000001";
const COORDINATOR = "d4000000-0000-4000-8000-000000000002";
const CAREGIVER = "d4000000-0000-4000-8000-000000000003";
const VOLUNTEER = "d4000000-0000-4000-8000-000000000004";
const RECIPIENT = "d4000000-0000-4000-8000-000000000005";
const ASK = "d4000000-0000-4000-8000-000000000006";
const POLICY = "d4000000-0000-4000-8000-000000000007";
const PAST_SLOT = "d4000000-0000-4000-8000-000000000008";
const FUTURE_SLOT = "d4000000-0000-4000-8000-000000000009";

const COORDINATOR_TOKEN = "e2e-past-window-coordinator";
const VOLUNTEER_TOKEN = "e2e-past-window-volunteer";

const TIME_ZONE = "America/New_York";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const NOW = resolveNow();
const PAST_START = new Date(NOW.getTime() - 2 * HOUR);
const PAST_END = new Date(NOW.getTime() - 1 * HOUR);
const FUTURE_START = new Date(NOW.getTime() + 3 * DAY);
const FUTURE_END = new Date(FUTURE_START.getTime() + 2 * HOUR);

const PAST_LABEL = "Companion place that already began";
const FUTURE_LABEL = "Companion place three days ahead";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "r2-board-past-window",
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
 * One quiet church, one approved ask, and the two times on either side of the
 * boundary. Slots are replaced on every run so a retry starts from an open
 * later time; the ask and the people are insert-only.
 */
async function ensureFixture(db: E2eDatabase): Promise<void> {
  await db.client`DELETE FROM call_log WHERE slot_id IN (SELECT id FROM slot WHERE church_id = ${CHURCH})`;
  await db.client`DELETE FROM notification WHERE church_id = ${CHURCH}`;
  await db.client`DELETE FROM slot_candidate WHERE slot_id IN (SELECT id FROM slot WHERE church_id = ${CHURCH})`;
  await db.client`DELETE FROM slot WHERE church_id = ${CHURCH}`;

  await db.client`
    INSERT INTO church (id, name, timezone)
    VALUES (${CHURCH}, 'Cornerstone Fellowship', ${TIME_ZONE})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO person (id, church_id, first_name, last_name, roles, access_token)
    VALUES
      (${COORDINATOR}, ${CHURCH}, 'Grace', 'Cornerstone', '["coordinator"]'::jsonb, ${COORDINATOR_TOKEN}),
      (${CAREGIVER}, ${CHURCH}, 'Marta', 'Cornerstone', '["caregiver"]'::jsonb, 'e2e-past-window-caregiver'),
      (${VOLUNTEER}, ${CHURCH}, 'Ada', 'Cornerstone', '["volunteer"]'::jsonb, ${VOLUNTEER_TOKEN})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO caregiver (person_id) VALUES (${CAREGIVER})
    ON CONFLICT (person_id) DO NOTHING
  `;

  await db.client`
    INSERT INTO volunteer (person_id) VALUES (${VOLUNTEER})
    ON CONFLICT (person_id) DO NOTHING
  `;

  await db.client`
    INSERT INTO care_recipient (id, church_id, first_name, relation, created_by_caregiver_id)
    VALUES (${RECIPIENT}, ${CHURCH}, 'June', 'mother', ${CAREGIVER})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO policy (
      id, church_id, version, safeguarding_promises, question_set,
      crisis_script, referral_resources, reminder_window_hours,
      call_threshold_hours, signed_off_by, signed_off_at
    )
    VALUES (
      ${POLICY}, ${CHURCH}, 1, '[]'::jsonb, '[]'::jsonb,
      'Call the family today.', '[]'::jsonb, 24, 48, 'Grace', now()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO ask (
      id, church_id, caregiver_id, care_recipient_id, verbatim_text,
      status, policy_version_id, approved_by, approved_at
    )
    VALUES (
      ${ASK}, ${CHURCH}, ${CAREGIVER}, ${RECIPIENT},
      'A quiet fixture ask for the past-window boundary.',
      'approved', ${POLICY}, ${COORDINATOR}, ${new Date(NOW.getTime() - 6 * HOUR).toISOString()}::timestamptz
    )
    ON CONFLICT (id) DO NOTHING
  `;

  for (const row of [
    {
      id: PAST_SLOT,
      label: PAST_LABEL,
      start: PAST_START,
      end: PAST_END,
    },
    {
      id: FUTURE_SLOT,
      label: FUTURE_LABEL,
      start: FUTURE_START,
      end: FUTURE_END,
    },
  ]) {
    await db.client`
      INSERT INTO slot (
        id, ask_id, church_id, kind, tier, label, window_start, window_end,
        gated, rule_ref, status, approved_by, approved_at
      )
      VALUES (
        ${row.id}, ${ASK}, ${CHURCH}, 'companion', 'public_event', ${row.label},
        ${row.start.toISOString()}::timestamptz,
        ${row.end.toISOString()}::timestamptz,
        false, 'manual', 'open', ${COORDINATOR},
        ${new Date(NOW.getTime() - 6 * HOUR).toISOString()}::timestamptz
      )
    `;
  }
}

test.describe.configure({ timeout: 180_000 });

test.describe("VAL-R2PROM-001 — a time that has started is never offered or claimable", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.beforeEach(async () => {
    // Idempotent: a retry starts from the same open later time rather than
    // from the previous attempt's claim.
    await ensureFixture(db);
  });

  test.afterAll(async () => {
    await db.client.end();
  });

  test("hides the started time from the board, refuses its claim, and keeps the later time claimable", async ({
    browser,
  }) => {
    const ada = await signIn(browser, VOLUNTEER_TOKEN);

    const boardResponse = await ada.page.goto("/circle");
    expect(boardResponse?.status()).toBe(200);

    const boardContainers = ada.page.locator(
      '[data-testid="board-open"], [data-testid="board-taken"]',
    );

    // The started time is nowhere on the board.
    await expect(
      ada.page.locator(
        `[data-testid="board-slot"][data-slot-id="${PAST_SLOT}"]`,
      ),
    ).toHaveCount(0);
    const boardText = (await boardContainers.allInnerTexts()).join("\n");
    expect(boardText).not.toContain(PAST_LABEL);
    expect(boardText).toContain(FUTURE_LABEL);
    await shot(ada.page, "circle-started-time-absent");

    // The later time still lists with its one action, at least 44 by 44.
    const futureCard = ada.page.locator(
      `[data-testid="board-slot"][data-slot-id="${FUTURE_SLOT}"]`,
    );
    await expect(futureCard).toBeVisible();
    await expect(futureCard).toHaveAttribute("data-status", "open");
    const claimButton = futureCard.getByRole("button", {
      name: "Claim this time",
    });
    await expect(claimButton).toHaveCount(1);
    const box = await claimButton.boundingBox();
    if (!box) throw new Error("expected a laid-out claim button");
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);

    // A direct POST to the started time's claim URL is refused with the
    // existing plain sentence — the same sentence a closed time gets.
    const refused = await ada.context.request.post(
      `/api/slots/${PAST_SLOT}/claim`,
      { failOnStatusCode: false },
    );
    expect(refused.status()).toBe(409);
    const refusedBody = (await refused.json()) as {
      ok: boolean;
      code: string;
      message: string;
    };
    expect(refusedBody).toEqual({
      ok: false,
      code: "not_open",
      message: claimCopy("not_open"),
    });
    expect(refusedBody.message).toBe(
      "That time is no longer open. Ask your coordinator to help you find another.",
    );
    expect(refusedBody.message).not.toMatch(
      /SQLSTATE|constraint|pg_|postgres|stack/i,
    );

    // No write: the started row is still published and unclaimed, and no
    // winning claim row was audited for it.
    const [pastRow] = await db.client<
      Array<{ status: string; claimed_by: string | null; claimed_at: string | null }>
    >`
      SELECT status, claimed_by, claimed_at
        FROM slot WHERE id = ${PAST_SLOT}
    `;
    expect(pastRow.status).toBe("open");
    expect(pastRow.claimed_by).toBeNull();
    expect(pastRow.claimed_at).toBeNull();

    const [wins] = await db.client<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
        FROM audit_event
       WHERE action = 'slot_claimed' AND entity_id = ${PAST_SLOT}
    `;
    expect(Number(wins.count)).toBe(0);

    const [refusals] = await db.client<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
        FROM audit_event
       WHERE action = 'claim_refused' AND entity_id = ${PAST_SLOT}
         AND detail->>'windowStarted' = 'true'
    `;
    expect(Number(refusals.count)).toBeGreaterThanOrEqual(1);

    // The later time still claims exactly as before.
    await claimButton.click();
    await expect(
      ada.page.getByTestId("board-slot").filter({ hasText: FUTURE_LABEL }),
    ).toHaveAttribute("data-status", "claimed");
    await expect(
      ada.page.getByTestId("board-slot").filter({ hasText: FUTURE_LABEL }),
    ).toContainText("Claimed — waiting for Grace");
    await shot(ada.page, "circle-future-time-claimed");
    await ada.context.close();
  });

  test("the desk calls the started time started, not open, and still offers the close", async ({
    browser,
  }) => {
    const grace = await signIn(browser, COORDINATOR_TOKEN);
    const response = await grace.page.goto(`/desk/slot/${PAST_SLOT}`);
    expect(response?.status()).toBe(200);

    const status = grace.page.getByTestId("slot-status");
    await expect(status).toHaveAttribute("data-status", "started");
    await expect(status).toHaveAttribute("data-stored-status", "open");
    await expect(status).toHaveText("Start time passed — not on the board");

    const lead = grace.page.getByTestId("slot-lead");
    await expect(lead).toContainText("The start time has passed.");
    await expect(lead).toContainText("no one can take it now");
    await expect(lead).toContainText("call the family");

    // The claim section agrees too: nobody can still say yes to this time.
    const review = grace.page.getByTestId("claim-review");
    await expect(review).toHaveAttribute("data-started", "true");
    await expect(review).toContainText("No one said yes before it began");
    await expect(review).not.toContainText("When a neighbour claims this time");

    // The coverage card agrees: the time is still the desk's to close, with the
    // same zero-message count and the deliberate close control.
    const coverage = grace.page.getByTestId("coverage-card");
    await expect(coverage).toHaveAttribute("data-started", "true");
    await expect(coverage.getByTestId("coverage-state")).toHaveText(
      "Start time passed — no one has taken it.",
    );
    await expect(coverage.getByTestId("coverage-expire")).toBeVisible();
    await shot(grace.page, "desk-started-time");
    await grace.context.close();
  });

  test("the four seeded Respite Mornings are still the next four future Tuesdays", async () => {
    const sessions = await db.client<Array<{ starts_at: string }>>`
      SELECT starts_at::text AS starts_at
        FROM session
       WHERE church_id = ${seedIds.church}
       ORDER BY starts_at
    `;
    const future = sessions.filter(
      (row) => new Date(row.starts_at).getTime() > NOW.getTime(),
    );
    expect(future).toHaveLength(4);

    const [companion] = await db.client<Array<{ window_start: string }>>`
      SELECT window_start::text AS window_start
        FROM slot WHERE id = ${DEMO_IDS.slotCompanion}
    `;
    expect(new Date(companion.window_start).getTime()).toBe(
      new Date(future[0]!.starts_at).getTime(),
    );
  });
});

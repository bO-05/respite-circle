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
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-R2PROM-002 on the real surface.
 *
 * The coverage card says "This time needs a call now." and then offered a
 * close that wrote the absence proof with no call on record. The re-offer path
 * already refused that; the close path now uses the same gate. This spec
 * builds one quiet church with three published times:
 *
 *   - a time inside the watch, never closed: the card refuses the close in
 *     plain words, names the missing call, and changes nothing;
 *   - a time inside the watch whose call is recorded first: the same close
 *     then succeeds and writes the zero-row proof;
 *   - a time still waiting for the watch to open: it never promised a call, so
 *     it closes exactly as before with zero calls.
 *
 * Every window is derived from the app clock (`resolveNow`), so the spec
 * passes at the wall clock and under any `RC_FAKE_NOW`.
 */

const CHURCH = "d7000000-0000-4000-8000-000000000001";
const COORDINATOR = "d7000000-0000-4000-8000-000000000002";
const CAREGIVER = "d7000000-0000-4000-8000-000000000003";
const RECIPIENT = "d7000000-0000-4000-8000-000000000004";
const ASK = "d7000000-0000-4000-8000-000000000005";
const POLICY = "d7000000-0000-4000-8000-000000000006";

const REFUSAL_SLOT = "d7000000-0000-4000-8000-000000000007";
const CALL_SLOT = "d7000000-0000-4000-8000-000000000008";
const NOT_DUE_SLOT = "d7000000-0000-4000-8000-000000000009";

const COORDINATOR_TOKEN = "e2e-call-before-close-coordinator";

const TIME_ZONE = "America/New_York";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const NOW = resolveNow();

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "r2-call-before-close",
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

async function slotStatus(db: E2eDatabase, slotId: string): Promise<string> {
  const [row] = await db.client<{ status: string }[]>`
    SELECT status FROM slot WHERE id = ${slotId}
  `;
  return row.status;
}

async function askStatus(db: E2eDatabase, askId: string): Promise<string> {
  const [row] = await db.client<{ status: string }[]>`
    SELECT status FROM ask WHERE id = ${askId}
  `;
  return row.status;
}

async function absenceProofs(db: E2eDatabase, slotId: string) {
  return db.client<{ slot_id: string; caregiver_outbox_count: number }[]>`
    SELECT slot_id, caregiver_outbox_count
      FROM absence_proof
     WHERE slot_id = ${slotId}
  `;
}

async function callCount(db: E2eDatabase, slotId: string): Promise<number> {
  const [row] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM call_log WHERE slot_id = ${slotId}
  `;
  return Number(row.count);
}

async function notificationCount(
  db: E2eDatabase,
  slotId: string,
): Promise<number> {
  const [row] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM notification WHERE slot_id = ${slotId}
  `;
  return Number(row.count);
}

/**
 * One quiet church. People, policy and the ask are insert-only; the three
 * times are insert-only too, because an expired time keeps its append-only
 * proof. Each test is retry-aware: it reads the status before acting, and the
 * time it closes belongs to that test alone.
 */
async function ensureFixture(db: E2eDatabase): Promise<void> {
  await db.client`
    INSERT INTO church (id, name, timezone)
    VALUES (${CHURCH}, 'Quiet Fellowship', ${TIME_ZONE})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO person (id, church_id, first_name, last_name, roles, access_token)
    VALUES
      (${COORDINATOR}, ${CHURCH}, 'Grace', 'Quiet', '["coordinator"]'::jsonb, ${COORDINATOR_TOKEN}),
      (${CAREGIVER}, ${CHURCH}, 'Marta', 'Quiet', '["caregiver"]'::jsonb, 'e2e-call-before-close-caregiver')
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO caregiver (person_id) VALUES (${CAREGIVER})
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
      'A quiet fixture ask for the call promise.',
      'approved', ${POLICY}, ${COORDINATOR},
      ${new Date(NOW.getTime() - 30 * HOUR).toISOString()}::timestamptz
    )
    ON CONFLICT (id) DO NOTHING
  `;

  const rows = [
    {
      // Inside the watch through both clocks. This time is never closed, so a
      // retry always finds the refusal scenario intact.
      id: REFUSAL_SLOT,
      label: "A Saturday morning that needs a call",
      start: new Date(NOW.getTime() + 12 * HOUR),
      end: new Date(NOW.getTime() + 14 * HOUR),
      approvedAt: new Date(NOW.getTime() - 30 * HOUR),
    },
    {
      // Inside the watch. This test's own time, closed once the call is
      // recorded.
      id: CALL_SLOT,
      label: "A second Saturday morning that needs a call",
      start: new Date(NOW.getTime() + 18 * HOUR),
      end: new Date(NOW.getTime() + 20 * HOUR),
      approvedAt: new Date(NOW.getTime() - 30 * HOUR),
    },
    {
      // Published just now with a window ten days out: the watch opens 24
      // hours from now, so the card never promised a call.
      id: NOT_DUE_SLOT,
      label: "A meal drop-off later in the month",
      start: new Date(NOW.getTime() + 10 * DAY),
      end: new Date(NOW.getTime() + 10 * DAY + 2 * HOUR),
      approvedAt: new Date(NOW.getTime() - 1 * HOUR),
    },
  ];

  for (const row of rows) {
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
        ${row.approvedAt.toISOString()}::timestamptz
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
}

test.describe.configure({ timeout: 180_000 });

test.describe.serial(
  "VAL-R2PROM-002 — a time that needs a call cannot close without one",
  () => {
    let db: E2eDatabase;

    test.beforeAll(async () => {
      db = await openE2eDatabase();
      await ensureFixture(db);
    });

    test.afterAll(async () => {
      if (db) await db.client.end();
    });

    test("the card refuses the close in plain words, names the missing call, and changes nothing", async ({
      browser,
    }) => {
      const grace = await signIn(browser, COORDINATOR_TOKEN);
      await grace.page.goto("/desk/failures");

      const card = grace.page.locator(
        `[data-testid="coverage-card"][data-slot-id="${REFUSAL_SLOT}"]`,
      );
      await expect(card).toBeVisible();
      await expect(card.getByTestId("coverage-due")).toHaveText(
        "This time needs a call now.",
      );

      await card.getByTestId("coverage-expire").click();

      const refusal = card.getByTestId("coverage-expire-feedback");
      await expect(refusal).toBeVisible({ timeout: 20_000 });
      await expect(refusal).toHaveAttribute("role", "alert");
      await expect(refusal).toContainText(/record the call first/i);
      await expect(refusal).toContainText(/needs a call/i);
      await expect(refusal).toContainText(/never closed without one/i);
      await expect(refusal).toContainText(/nothing was changed/i);

      // Nothing moved: the card is still in the watch, the time is still
      // published, the ask is untouched, and no proof exists.
      await expect(card).toBeVisible();
      await expect(card.getByTestId("absence-proof")).toHaveCount(0);
      expect(await slotStatus(db, REFUSAL_SLOT)).toBe("open");
      expect(await askStatus(db, ASK)).toBe("approved");
      expect(await absenceProofs(db, REFUSAL_SLOT)).toHaveLength(0);
      expect(await callCount(db, REFUSAL_SLOT)).toBe(0);
      expect(await notificationCount(db, REFUSAL_SLOT)).toBe(0);

      await shot(grace.page, "call-promise-refused");
      await grace.context.close();
    });

    test("after one recorded call the same close succeeds and writes the proof", async ({
      browser,
    }) => {
      const grace = await signIn(browser, COORDINATOR_TOKEN);
      await grace.page.goto(`/desk/slot/${CALL_SLOT}`);
      const card = grace.page.getByTestId("desk-coverage");

      if ((await slotStatus(db, CALL_SLOT)) === "open") {
        await expect(card.getByTestId("coverage-due")).toHaveText(
          "This time needs a call now.",
        );

        await card.getByLabel("Reached them").check();
        await card
          .getByTestId("coverage-call-note")
          .fill("She would like the Saturday visit tried again.");
        await card.getByTestId("save-coverage-call").click();
        await expect(card.getByTestId("coverage-calls")).toContainText(
          "Reached them",
          { timeout: 20_000 },
        );
        await expect(card.getByTestId("coverage-due")).toContainText(
          "A call is on record",
        );

        await card.getByTestId("coverage-expire").click();
      }

      await expect(grace.page.getByTestId("absence-proof")).toBeVisible({
        timeout: 45_000,
      });
      await expect(grace.page.getByTestId("absence-proof-count")).toHaveText(
        "Messages sent to the caregiver about this slot: 0",
      );

      expect(await slotStatus(db, CALL_SLOT)).toBe("expired_unclaimed");
      expect(await absenceProofs(db, CALL_SLOT)).toHaveLength(1);
      expect(await callCount(db, CALL_SLOT)).toBeGreaterThanOrEqual(1);
      expect(await notificationCount(db, CALL_SLOT)).toBe(0);

      await shot(grace.page, "call-promise-kept");
      await grace.context.close();
    });

    test("a time that never promised a call still closes without one", async ({
      browser,
    }) => {
      const grace = await signIn(browser, COORDINATOR_TOKEN);
      await grace.page.goto(`/desk/slot/${NOT_DUE_SLOT}`);
      const card = grace.page.getByTestId("desk-coverage");

      if ((await slotStatus(db, NOT_DUE_SLOT)) === "open") {
        await expect(card.getByTestId("coverage-due")).toContainText(
          "A call becomes due on",
        );
        await expect(card.getByTestId("coverage-due")).not.toHaveText(
          "This time needs a call now.",
        );
        await card.getByTestId("coverage-expire").click();
      }

      await expect(grace.page.getByTestId("absence-proof")).toBeVisible({
        timeout: 45_000,
      });
      await expect(grace.page.getByTestId("absence-proof-count")).toHaveText(
        "Messages sent to the caregiver about this slot: 0",
      );

      expect(await slotStatus(db, NOT_DUE_SLOT)).toBe("expired_unclaimed");
      expect(await absenceProofs(db, NOT_DUE_SLOT)).toHaveLength(1);
      expect(await callCount(db, NOT_DUE_SLOT)).toBe(0);
      expect(await notificationCount(db, NOT_DUE_SLOT)).toBe(0);

      await shot(grace.page, "close-without-a-call-promise");
      await grace.context.close();
    });
  },
);

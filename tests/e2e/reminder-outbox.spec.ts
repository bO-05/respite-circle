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
import {
  formatWindowLabel,
} from "../../src/server/domain/slots";
import {
  renderConfirmation,
  renderReminder,
} from "../../src/server/domain/notifications";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";
import { expectNoDeskConcepts } from "./helpers/desk-words";

/**
 * VAL-CONFIRM-003, VAL-CONFIRM-004, VAL-CONFIRM-006 and the caregiver half of
 * VAL-BOARD-006 on the real surface.
 *
 * A quiet church of its own holds one covered time inside the reminder window
 * and one open time. Grace sees the exact reminder sentence before writing it,
 * writes it once, and the page then refuses a second. The family reads both
 * messages on `/care` — the confirmation and the one reminder — with the slot
 * label and window, and nothing else. The caregiver's `/care`, `/ask` and
 * `/ask/[id]` pages carry none of the desk's words: this spec scans them with
 * the one shared list in `helpers/desk-words.ts`, the same list
 * `coverage-watch.spec.ts` and `failure-path.spec.ts` import.
 */

const QUIET_CHURCH = "d1000000-0000-4000-8000-000000000001";
const QUIET_COORDINATOR = "d1000000-0000-4000-8000-000000000002";
const QUIET_CAREGIVER = "d1000000-0000-4000-8000-000000000003";
const QUIET_VOLUNTEER = "d1000000-0000-4000-8000-000000000004";
const QUIET_RECIPIENT = "d1000000-0000-4000-8000-000000000005";
const QUIET_ASK = "d1000000-0000-4000-8000-000000000006";
const QUIET_POLICY = "d1000000-0000-4000-8000-000000000007";
const QUIET_COVERED_SLOT = "d1000000-0000-4000-8000-000000000008";
const QUIET_OPEN_SLOT = "d1000000-0000-4000-8000-000000000009";

const QUIET_COORDINATOR_TOKEN = "e2e-reminder-coordinator";
const QUIET_CAREGIVER_TOKEN = "e2e-reminder-caregiver";

const QUIET_VERBATIM =
  "The nights are long and I am running on empty. June is content with company and a cup of tea, and she naps after lunch.";

const NOTE_CANARY =
  "ORIENTATION CANARY: the spare key is in the blue pot by the door.";

const TIME_ZONE = "America/New_York";

const FIXTURE_NOW = new Date();
const COVERED_START = new Date(FIXTURE_NOW.getTime() + 2 * 3_600_000);
const COVERED_END = new Date(FIXTURE_NOW.getTime() + 6 * 3_600_000);

const CONFIRMATION = renderConfirmation({
  kind: "companion",
  volunteerFirstName: "Ada",
  careRecipientFirstName: "June",
  windowStart: COVERED_START,
  windowEnd: COVERED_END,
  timeZone: TIME_ZONE,
});
const REMINDER = renderReminder({
  kind: "companion",
  volunteerFirstName: "Ada",
  careRecipientFirstName: "June",
  windowStart: COVERED_START,
  windowEnd: COVERED_END,
  timeZone: TIME_ZONE,
});

if (!CONFIRMATION || !REMINDER) {
  throw new Error("The reminder E2E fixture needs both human templates.");
}

const EXPECTED_CONFIRMATION = CONFIRMATION.body;
const EXPECTED_REMINDER = REMINDER.body;
const EXPECTED_WINDOW = formatWindowLabel(
  COVERED_START,
  COVERED_END,
  TIME_ZONE,
);

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "reminder-outbox",
);

type NotificationRow = {
  kind: string;
  body: string;
  template_code: string;
  caregiver_id: string;
  status: string;
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

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

async function notificationsFor(
  db: E2eDatabase,
  slotId: string,
): Promise<NotificationRow[]> {
  return db.client<NotificationRow[]>`
    SELECT kind, body, template_code, caregiver_id, status
      FROM notification
     WHERE slot_id = ${slotId}
     ORDER BY created_at, id
  `;
}

/**
 * Remove the fixture's messages and times. `ask` and `audit_event` rows are
 * protected by their own append-only triggers, so a spec may leave them; the
 * suite's global setup truncates the whole database at the start of a run.
 * Keeping the fixed ids lets a Playwright retry re-use the same quiet church.
 */
async function clearQuietChurchMessages(db: E2eDatabase): Promise<void> {
  await db.client`DELETE FROM notification WHERE church_id = ${QUIET_CHURCH}`;
  await db.client`DELETE FROM slot WHERE church_id = ${QUIET_CHURCH}`;
}

async function ensureQuietChurch(db: E2eDatabase): Promise<void> {
  await clearQuietChurchMessages(db);

  await db.client`
    INSERT INTO church (id, name, timezone, demo_mode)
    VALUES (${QUIET_CHURCH}, 'Quiet Chapel', ${TIME_ZONE}, false)
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO person (id, church_id, first_name, last_name, roles, access_token)
    VALUES
      (${QUIET_COORDINATOR}, ${QUIET_CHURCH}, 'Grace', 'Quiet', '["coordinator"]'::jsonb, ${QUIET_COORDINATOR_TOKEN}),
      (${QUIET_CAREGIVER}, ${QUIET_CHURCH}, 'Marta', 'Quiet', '["caregiver"]'::jsonb, ${QUIET_CAREGIVER_TOKEN}),
      (${QUIET_VOLUNTEER}, ${QUIET_CHURCH}, 'Ada', 'Quiet', '["volunteer"]'::jsonb, 'e2e-reminder-volunteer')
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO caregiver (person_id) VALUES (${QUIET_CAREGIVER})
    ON CONFLICT (person_id) DO NOTHING
  `;

  await db.client`
    INSERT INTO volunteer (person_id) VALUES (${QUIET_VOLUNTEER})
    ON CONFLICT (person_id) DO NOTHING
  `;

  await db.client`
    INSERT INTO care_recipient (id, church_id, first_name, relation, created_by_caregiver_id)
    VALUES (${QUIET_RECIPIENT}, ${QUIET_CHURCH}, 'June', 'mother', ${QUIET_CAREGIVER})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO policy (
      id, church_id, version, safeguarding_promises, question_set,
      crisis_script, referral_resources, reminder_window_hours,
      signed_off_by, signed_off_at
    )
    VALUES (
      ${QUIET_POLICY}, ${QUIET_CHURCH}, 1, '[]'::jsonb, '[]'::jsonb,
      'Call the family today.', '[]'::jsonb, 24,
      'Grace', now()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO ask (
      id, church_id, caregiver_id, care_recipient_id, verbatim_text,
      status, policy_version_id, approved_by, approved_at
    )
    VALUES (
      ${QUIET_ASK}, ${QUIET_CHURCH}, ${QUIET_CAREGIVER}, ${QUIET_RECIPIENT},
      ${QUIET_VERBATIM}, 'approved', ${QUIET_POLICY},
      ${QUIET_COORDINATOR}, now()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  // A JS Date is not a bindable value for postgres.js in a raw fragment; bind
  // the ISO string and cast, the same way the claim predicate does.
  await db.client`
    INSERT INTO slot (
      id, ask_id, church_id, kind, tier, label, window_start, window_end,
      gated, orientation_note, rule_ref, status, claimed_by, claimed_at,
      approved_by, approved_at, claim_confirmed_by, claim_confirmed_at
    )
    VALUES (
      ${QUIET_COVERED_SLOT}, ${QUIET_ASK}, ${QUIET_CHURCH}, 'companion',
      'public_event', 'Companion place at Respite Morning',
      ${COVERED_START.toISOString()}::timestamptz,
      ${COVERED_END.toISOString()}::timestamptz,
      false, ${NOTE_CANARY}, 'q1_companion',
      'covered', ${QUIET_VOLUNTEER}, now(),
      ${QUIET_COORDINATOR}, now(), ${QUIET_COORDINATOR}, now()
    )
  `;

  await db.client`
    INSERT INTO slot (
      id, ask_id, church_id, kind, tier, label, window_start, window_end,
      gated, rule_ref, status, approved_by, approved_at
    )
    VALUES (
      ${QUIET_OPEN_SLOT}, ${QUIET_ASK}, ${QUIET_CHURCH}, 'meal',
      'doorstep', 'A reheatable meal',
      ${COVERED_START.toISOString()}::timestamptz,
      ${COVERED_END.toISOString()}::timestamptz,
      false, 'manual', 'open', ${QUIET_COORDINATOR}, now()
    )
  `;

  await db.client`
    INSERT INTO notification (
      church_id, slot_id, caregiver_id, kind, template_code, body, status,
      created_at
    )
    VALUES (
      ${QUIET_CHURCH}, ${QUIET_COVERED_SLOT}, ${QUIET_CAREGIVER},
      'confirmation', 'confirmation.companion', ${EXPECTED_CONFIRMATION},
      'queued', now()
    )
  `;
}

test.describe.configure({ timeout: 300_000 });

test.describe.serial("VAL-CONFIRM-003, VAL-CONFIRM-004, VAL-CONFIRM-006 and VAL-BOARD-006 — the one reminder and the caregiver's outbox", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    db = await openE2eDatabase();
    await ensureQuietChurch(db);
  });

  test.afterAll(async () => {
    if (db) {
      await clearQuietChurchMessages(db);
      await db.client.end();
    }
  });

  test("VAL-CONFIRM-003 and VAL-CONFIRM-006 — the desk previews the exact reminder and writes it exactly once", async ({
    browser,
  }) => {
    expect(await notificationsFor(db, QUIET_COVERED_SLOT)).toHaveLength(1);

    const grace = await signIn(browser, QUIET_COORDINATOR_TOKEN);
    await grace.page.goto(`/desk/slot/${QUIET_COVERED_SLOT}`);

    const section = grace.page.getByTestId("desk-reminder");
    await expect(section).toBeVisible();
    await expect(section).toHaveAttribute("data-status", "covered");
    await expect(grace.page.getByTestId("desk-reminder-preview")).toHaveText(
      EXPECTED_REMINDER,
    );
    await expect(grace.page.getByTestId("write-reminder")).toBeVisible();
    await shot(grace.page, "desk-reminder-preview");

    await grace.page.getByTestId("write-reminder").click();

    // The action re-reads the desk and the stored body replaces the preview.
    await expect(grace.page.getByTestId("desk-reminder-body")).toHaveText(
      EXPECTED_REMINDER,
      { timeout: 45_000 },
    );
    await expect(grace.page.getByTestId("write-reminder")).toHaveCount(0);
    await expect(grace.page.getByTestId("desk-reminder-written")).toContainText(
      /One reminder per time/i,
    );
    await shot(grace.page, "desk-reminder-written");

    const rows = await notificationsFor(db, QUIET_COVERED_SLOT);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.kind).sort()).toEqual([
      "confirmation",
      "reminder",
    ]);
    const reminder = rows.find((row) => row.kind === "reminder");
    expect(reminder?.body).toBe(EXPECTED_REMINDER);
    expect(reminder?.template_code).toBe("reminder.companion");
    expect(reminder?.caregiver_id).toBe(QUIET_CAREGIVER);
    expect(reminder?.status).toBe("queued");

    // A reload cannot produce a second control or a second row.
    await grace.page.reload();
    await expect(grace.page.getByTestId("desk-reminder-body")).toHaveText(
      EXPECTED_REMINDER,
    );
    await expect(grace.page.getByTestId("write-reminder")).toHaveCount(0);
    expect(await notificationsFor(db, QUIET_COVERED_SLOT)).toHaveLength(2);

    await grace.context.close();
  });

  test("VAL-CONFIRM-003 — a time nobody has claimed offers no reminder at all", async ({
    browser,
  }) => {
    const grace = await signIn(browser, QUIET_COORDINATOR_TOKEN);
    await grace.page.goto(`/desk/slot/${QUIET_OPEN_SLOT}`);

    await expect(grace.page.getByTestId("desk-reminder")).toBeVisible();
    await expect(grace.page.getByTestId("desk-reminder-preview")).toHaveCount(0);
    await expect(grace.page.getByTestId("write-reminder")).toHaveCount(0);
    await expect(grace.page.getByTestId("desk-reminder-state")).toContainText(
      /no neighbour has said yes/i,
    );
    await expect(grace.page.getByTestId("desk-reminder-state")).toContainText(
      /nothing is sent/i,
    );

    expect(await notificationsFor(db, QUIET_OPEN_SLOT)).toHaveLength(0);

    await shot(grace.page, "desk-reminder-not-covered");
    await grace.context.close();
  });

  test("VAL-CONFIRM-006 — the caregiver reads both received messages with the label and window", async ({
    browser,
  }) => {
    const marta = await signIn(browser, QUIET_CAREGIVER_TOKEN);
    await marta.page.goto("/care");

    await expect(marta.page.getByTestId("care-confirmation")).toHaveCount(1);
    await expect(marta.page.getByTestId("care-reminder")).toHaveCount(1);
    await expect(marta.page.getByTestId("care-note")).toHaveCount(0);

    const card = marta.page.getByTestId("care-reminder");
    await expect(card.getByTestId("care-reminder-body")).toHaveText(
      EXPECTED_REMINDER,
    );
    await expect(card.getByTestId("care-reminder-when")).toHaveText(
      EXPECTED_WINDOW,
    );
    await expect(card).toContainText("Companion place at Respite Morning");
    await expect(card).toContainText("Received in the app on");

    await expect(
      marta.page.getByTestId("care-confirmation-body"),
    ).toHaveText(EXPECTED_CONFIRMATION);

    const visible = await marta.page.locator("body").innerText();
    const html = await marta.page.content();

    for (const forbidden of [
      NOTE_CANARY,
      "ORIENTATION CANARY",
      "GENERATED_PROSE_CANARY",
      "fake-typed-v1",
      "deterministic",
      "mistral",
    ]) {
      expect(html).not.toContain(forbidden);
    }

    expectNoDeskConcepts(visible, "/care");
    expectNoDeskConcepts(html, "/care");

    await shot(marta.page, "caregiver-both-messages");
    await marta.context.close();
  });

  test("VAL-BOARD-006 — the caregiver's ask pages carry no board concepts", async ({
    browser,
  }) => {
    const marta = await signIn(browser, QUIET_CAREGIVER_TOKEN);

    await marta.page.goto("/ask");
    await expect(marta.page.locator("h1")).toHaveCount(1);
    expectNoDeskConcepts(
      await marta.page.locator("body").innerText(),
      "/ask",
    );
    expectNoDeskConcepts(await marta.page.content(), "/ask");
    await shot(marta.page, "caregiver-ask");

    await marta.page.goto(`/ask/${QUIET_ASK}`);
    await expect(
      marta.page.getByTestId("caregiver-verbatim"),
    ).toContainText("running on empty");
    expectNoDeskConcepts(
      await marta.page.locator("body").innerText(),
      "/ask/[id]",
    );
    expectNoDeskConcepts(await marta.page.content(), "/ask/[id]");
    await shot(marta.page, "caregiver-ask-receipt");

    await marta.context.close();
  });

  test("another family's page shows neither message and no reminder", async ({
    browser,
  }) => {
    const priya = await signIn(browser, seedAccessTokens.priya);
    await priya.page.goto("/care");

    await expect(priya.page.getByTestId("care-reminder")).toHaveCount(0);
    await expect(priya.page.getByTestId("care-confirmation")).toHaveCount(0);

    const html = await priya.page.content();
    expect(html).not.toContain(EXPECTED_REMINDER);
    expect(html).not.toContain(EXPECTED_CONFIRMATION);
    expect(html).not.toContain("June");

    await priya.context.close();
  });
});

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { renderConfirmation, renderReminder } from "../../src/server/domain/notifications";
import { ABSENCE_PROOF_QUERY_TEXT } from "../../src/server/domain/coverage";
import { formatWindowLabel } from "../../src/server/domain/slots";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-FAILURE-001..006 and VAL-CROSS-002 on the real surface.
 *
 * A quiet church of its own holds one covered time with both a confirmation
 * and a reminder — so the zero on the open times is not vacuous — plus four
 * published times nobody has taken. Grace sees them in the coverage watch with
 * the family, the window, the time open, and a live "Messages sent …: 0". She
 * records a call, offers one time again (once), and closes another with the
 * zero-row proof. Marta's `/care` and `/ask/[id]` carry only the human line
 * "Your coordinator is working on …" and none of the desk's words.
 */

const QUIET_CHURCH = "d2000000-0000-4000-8000-000000000001";
const QUIET_COORDINATOR = "d2000000-0000-4000-8000-000000000002";
const QUIET_CAREGIVER = "d2000000-0000-4000-8000-000000000003";
const QUIET_VOLUNTEER = "d2000000-0000-4000-8000-000000000004";
const QUIET_RECIPIENT = "d2000000-0000-4000-8000-000000000005";
const QUIET_ASK = "d2000000-0000-4000-8000-000000000006";
const QUIET_POLICY = "d2000000-0000-4000-8000-000000000007";
const QUIET_COVERED_SLOT = "d2000000-0000-4000-8000-000000000008";
const QUIET_WATCH_SLOT = "d2000000-0000-4000-8000-000000000009";
const QUIET_EXPIRE_SLOT = "d2000000-0000-4000-8000-00000000000a";
const QUIET_REOFFER_SLOT = "d2000000-0000-4000-8000-00000000000b";
const QUIET_ASK_TWO = "d2000000-0000-4000-8000-00000000000c";
const QUIET_CLOSURE_SLOT = "d2000000-0000-4000-8000-00000000000d";

const QUIET_COORDINATOR_TOKEN = "e2e-coverage-coordinator";
const QUIET_CAREGIVER_TOKEN = "e2e-coverage-caregiver";

const QUIET_VERBATIM =
  "The weeks are long and I am running on empty. June is content with company and a cup of tea, and she naps after lunch.";

const NOTE_CANARY =
  "ORIENTATION CANARY: the spare key is in the blue pot by the door.";

const TIME_ZONE = "America/New_York";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const FIXTURE_NOW = new Date();
const COVERED_START = new Date(FIXTURE_NOW.getTime() + 2 * HOUR);
const COVERED_END = new Date(FIXTURE_NOW.getTime() + 6 * HOUR);
const WATCH_START = new Date(FIXTURE_NOW.getTime() + 12 * HOUR);
const WATCH_END = new Date(FIXTURE_NOW.getTime() + 14 * HOUR);
const EXPIRE_START = new Date(FIXTURE_NOW.getTime() + 5 * DAY);
const EXPIRE_END = new Date(EXPIRE_START.getTime() + 2 * HOUR);
const REOFFER_START = new Date(FIXTURE_NOW.getTime() + 4 * DAY);
const REOFFER_END = new Date(REOFFER_START.getTime() + 2 * HOUR);
const CLOSURE_START = new Date(FIXTURE_NOW.getTime() + 12 * HOUR);
const CLOSURE_END = new Date(FIXTURE_NOW.getTime() + 14 * HOUR);

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
  throw new Error("The coverage E2E fixture needs both human templates.");
}

const EXPECTED_CONFIRMATION = CONFIRMATION.body;
const EXPECTED_REMINDER = REMINDER.body;

const EXPECTED_WATCH_WINDOW = formatWindowLabel(
  WATCH_START,
  WATCH_END,
  TIME_ZONE,
);

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "coverage-watch",
);

const MESSAGE_LINE = "Messages sent to the caregiver about this slot: 0";

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
 * The caregiver's pages are consent surfaces, not a desk. These words are the
 * desk's language and must not exist on `/care` or `/ask/[id]`.
 */
function expectNoDeskConcepts(text: string, where: string): void {
  const forbidden: Array<[RegExp, string]> = [
    [/\bunclaimed\b/i, "unclaimed"],
    [/\bwaiting\b/i, "waiting"],
    [/\bdeclines?\b/i, "declines"],
    [/\bdeclined\b/i, "declined"],
    [/\bviews?\b/i, "views"],
    [/\bcount\b/i, "count"],
    [/\bcounted\b/i, "counted"],
    [/\bexpired\b/i, "expired"],
    [/places? left/i, "places left"],
    [/remaining/i, "remaining"],
  ];

  for (const [pattern, label] of forbidden) {
    expect(
      pattern.test(text),
      `${where} must not contain the desk word "${label}"`,
    ).toBe(false);
  }
}

async function notificationsFor(
  db: E2eDatabase,
  slotId: string,
): Promise<number> {
  const [row] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM notification WHERE slot_id = ${slotId}
  `;
  return Number(row.count);
}

async function totalNotifications(db: E2eDatabase): Promise<number> {
  const [row] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
      FROM notification
     WHERE church_id = ${QUIET_CHURCH}
  `;
  return Number(row.count);
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
  return db.client<
    {
      slot_id: string;
      caregiver_outbox_count: number;
      query_text: string;
      digest: string;
      created_at: Date | string;
    }[]
  >`
    SELECT slot_id, caregiver_outbox_count, query_text, digest, created_at
      FROM absence_proof
     WHERE slot_id = ${slotId}
     ORDER BY created_at, id
  `;
}

/**
 * The published recipe, rebuilt from the documentation rather than calling
 * the implementation, so a drift in either place stops the match.
 */
function isoInstant(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`The stored proof instant is not a date: ${String(value)}`);
  }
  return date.toISOString();
}

function recomputeAbsenceProofDigest(row: {
  slot_id: string;
  caregiver_outbox_count: number;
  query_text: string;
  created_at: Date | string;
}): string {
  return createHash("sha256")
    .update(
      [
        "absence-proof/v1",
        `slot_id:${row.slot_id.toLowerCase()}`,
        `caregiver_outbox_count:${Number(row.caregiver_outbox_count)}`,
        `generated_at:${isoInstant(row.created_at)}`,
        "query_text:",
        row.query_text,
      ].join("\n"),
      "utf8",
    )
    .digest("hex");
}

async function reofferCount(db: E2eDatabase, slotId: string): Promise<number> {
  const [row] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
      FROM audit_event
     WHERE church_id = ${QUIET_CHURCH}
       AND action = 'slot_reoffered'
       AND entity = 'slot'
       AND entity_id = ${slotId}
  `;
  return Number(row.count);
}

/**
 * Remove only the fixture's messages, calls, and times. `ask`, `audit_event`,
 * and `absence_proof` are append-only and refuse DELETE; once this spec has
 * written a proof, it cannot delete the slot either, so a Playwright retry
 * keeps the advanced state and each test reads it before acting. The suite's
 * global setup truncates everything at the start of a run.
 */
async function clearQuietChurchMessages(db: E2eDatabase): Promise<void> {
  await db.client`DELETE FROM notification WHERE church_id = ${QUIET_CHURCH}`;
  await db.client`
    DELETE FROM call_log
     WHERE slot_id IN (SELECT id FROM slot WHERE church_id = ${QUIET_CHURCH})
  `;
  const [proofs] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
      FROM absence_proof
     WHERE slot_id IN (SELECT id FROM slot WHERE church_id = ${QUIET_CHURCH})
  `;
  if (Number(proofs.count) === 0) {
    await db.client`DELETE FROM slot WHERE church_id = ${QUIET_CHURCH}`;
  }
}

async function ensureQuietChurch(db: E2eDatabase): Promise<void> {
  await clearQuietChurchMessages(db);

  await db.client`
    INSERT INTO church (id, name, timezone)
    VALUES (${QUIET_CHURCH}, 'Quiet Fellowship', ${TIME_ZONE})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO person (id, church_id, first_name, last_name, roles, access_token)
    VALUES
      (${QUIET_COORDINATOR}, ${QUIET_CHURCH}, 'Grace', 'Quiet', '["coordinator"]'::jsonb, ${QUIET_COORDINATOR_TOKEN}),
      (${QUIET_CAREGIVER}, ${QUIET_CHURCH}, 'Marta', 'Quiet', '["caregiver"]'::jsonb, ${QUIET_CAREGIVER_TOKEN}),
      (${QUIET_VOLUNTEER}, ${QUIET_CHURCH}, 'Ada', 'Quiet', '["volunteer"]'::jsonb, 'e2e-coverage-volunteer')
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
      call_threshold_hours, signed_off_by, signed_off_at
    )
    VALUES (
      ${QUIET_POLICY}, ${QUIET_CHURCH}, 1, '[]'::jsonb, '[]'::jsonb,
      'Call the family today.', '[]'::jsonb, 24, 48, 'Grace', now()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO ask (
      id, church_id, caregiver_id, care_recipient_id, verbatim_text,
      status, policy_version_id, approved_by, approved_at
    )
    VALUES
      (
        ${QUIET_ASK}, ${QUIET_CHURCH}, ${QUIET_CAREGIVER}, ${QUIET_RECIPIENT},
        ${QUIET_VERBATIM}, 'approved', ${QUIET_POLICY},
        ${QUIET_COORDINATOR}, now()
      ),
      (
        ${QUIET_ASK_TWO}, ${QUIET_CHURCH}, ${QUIET_CAREGIVER}, ${QUIET_RECIPIENT},
        ${QUIET_VERBATIM}, 'approved', ${QUIET_POLICY},
        ${QUIET_COORDINATOR}, now()
      )
    ON CONFLICT (id) DO NOTHING
  `;

  // A JS Date is not bindable in a raw fragment; bind ISO strings and cast.
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
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO slot (
      id, ask_id, church_id, kind, tier, label, window_start, window_end,
      gated, rule_ref, status, approved_by, approved_at
    )
    VALUES
      (
        ${QUIET_WATCH_SLOT}, ${QUIET_ASK}, ${QUIET_CHURCH}, 'home',
        'in_home', 'A Saturday morning at home',
        ${WATCH_START.toISOString()}::timestamptz,
        ${WATCH_END.toISOString()}::timestamptz,
        true, 'q6_home', 'open', ${QUIET_COORDINATOR}, now()
      ),
      (
        ${QUIET_EXPIRE_SLOT}, ${QUIET_ASK}, ${QUIET_CHURCH}, 'meal',
        'doorstep', 'A reheatable meal',
        ${EXPIRE_START.toISOString()}::timestamptz,
        ${EXPIRE_END.toISOString()}::timestamptz,
        false, 'q3_meal', 'open', ${QUIET_COORDINATOR},
        ${new Date(FIXTURE_NOW.getTime() - 30 * HOUR).toISOString()}::timestamptz
      ),
      (
        ${QUIET_REOFFER_SLOT}, ${QUIET_ASK}, ${QUIET_CHURCH}, 'errand',
        'doorstep', 'An errand on Thursday',
        ${REOFFER_START.toISOString()}::timestamptz,
        ${REOFFER_END.toISOString()}::timestamptz,
        false, 'manual', 'open', ${QUIET_COORDINATOR},
        ${new Date(FIXTURE_NOW.getTime() - 30 * HOUR).toISOString()}::timestamptz
      ),
      (
        ${QUIET_CLOSURE_SLOT}, ${QUIET_ASK_TWO}, ${QUIET_CHURCH}, 'home',
        'in_home', 'A Saturday morning at home',
        ${CLOSURE_START.toISOString()}::timestamptz,
        ${CLOSURE_END.toISOString()}::timestamptz,
        true, 'q6_home', 'open', ${QUIET_COORDINATOR}, now()
      )
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO notification (
      church_id, slot_id, caregiver_id, kind, template_code, body, status,
      created_at
    )
    VALUES
      (
        ${QUIET_CHURCH}, ${QUIET_COVERED_SLOT}, ${QUIET_CAREGIVER},
        'confirmation', 'confirmation.companion', ${EXPECTED_CONFIRMATION},
        'queued', now()
      ),
      (
        ${QUIET_CHURCH}, ${QUIET_COVERED_SLOT}, ${QUIET_CAREGIVER},
        'reminder', 'reminder.companion', ${EXPECTED_REMINDER},
        'queued', now()
      )
  `;
}

test.describe.configure({ timeout: 300_000 });

test.describe.serial("the coverage watch and the failure-path proof", () => {
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

  test("the coverage watch names the family, the window, the time open, and a live zero", async ({
    browser,
  }) => {
    expect(await notificationCountFor(db, QUIET_COVERED_SLOT)).toBe(2);
    expect(await notificationCountFor(db, QUIET_WATCH_SLOT)).toBe(0);

    const grace = await signIn(browser, QUIET_COORDINATOR_TOKEN);
    await grace.page.goto("/desk/failures");

    const card = grace.page.locator(
      `[data-testid="coverage-card"][data-slot-id="${QUIET_WATCH_SLOT}"]`,
    );
    await expect(card).toBeVisible();
    await expect(card.getByTestId("coverage-who")).toContainText("Marta");
    await expect(card.getByTestId("coverage-who")).toContainText("June");
    await expect(card.getByTestId("coverage-window")).toHaveText(
      EXPECTED_WATCH_WINDOW,
    );
    await expect(card.getByTestId("coverage-open-for")).toContainText(
      /Open for (under an hour|\d+ hours?|\d+ days?)/,
    );
    await expect(card.getByTestId("coverage-message-count")).toHaveText(
      MESSAGE_LINE,
    );
    await expect(card.getByTestId("coverage-message-count")).toHaveAttribute(
      "data-count",
      "0",
    );
    await expect(card.getByTestId("coverage-pipeline-evidence")).toContainText(
      /2 messages have reached families|pipeline itself works/i,
    );

    // The other open times are here too, each with its own live zero.
    for (const slotId of [
      QUIET_EXPIRE_SLOT,
      QUIET_REOFFER_SLOT,
      QUIET_CLOSURE_SLOT,
    ]) {
      const other = grace.page.locator(
        `[data-testid="coverage-card"][data-slot-id="${slotId}"]`,
      );
      await expect(other).toBeVisible();
      await expect(other.getByTestId("coverage-message-count")).toHaveText(
        MESSAGE_LINE,
      );
    }

    // The covered time is not a call task; its two messages are the evidence.
    await expect(
      grace.page.locator(
        `[data-testid="coverage-card"][data-slot-id="${QUIET_COVERED_SLOT}"]`,
      ),
    ).toHaveCount(0);

    // The desk pins the watch and links to the full page.
    await grace.page.goto("/desk");
    const pinned = grace.page.getByTestId("desk-coverage-watch");
    await expect(pinned).toBeVisible();
    await expect(pinned).toContainText(MESSAGE_LINE);
    await shot(grace.page, "desk-coverage-pinned");

    await grace.page.goto("/desk/failures");
    await shot(grace.page, "coverage-watch");
    await grace.context.close();
  });

  test("a time is not offered again before a call is recorded", async ({
    browser,
  }) => {
    const grace = await signIn(browser, QUIET_COORDINATOR_TOKEN);
    await grace.page.goto("/desk/failures");

    const card = grace.page.locator(
      `[data-testid="coverage-card"][data-slot-id="${QUIET_REOFFER_SLOT}"]`,
    );
    await expect(card).toBeVisible();
    await expect(card.getByTestId("coverage-reoffer")).toHaveCount(0);
    await expect(card.getByTestId("coverage-reoffer-disabled")).toContainText(
      /Record a call first/i,
    );

    expect(await reofferCount(db, QUIET_REOFFER_SLOT)).toBe(0);
    await grace.context.close();
  });

  test("recording a call persists the coordinator, time, outcome, and note, and sends nothing", async ({
    browser,
  }) => {
    const before = await notificationCountFor(db, QUIET_WATCH_SLOT);
    expect(before).toBe(0);

    const grace = await signIn(browser, QUIET_COORDINATOR_TOKEN);
    await grace.page.goto("/desk/failures");

    const card = grace.page.locator(
      `[data-testid="coverage-card"][data-slot-id="${QUIET_WATCH_SLOT}"]`,
    );
    await expect(card).toBeVisible();
    await expect(card.getByTestId("coverage-due")).toHaveAttribute(
      "data-call-recorded",
      "false",
    );
    await expect(card.getByTestId("coverage-due")).toHaveAttribute(
      "data-due",
      "true",
    );
    await expect(card.getByTestId("coverage-due")).toHaveText(
      "This time needs a call now.",
    );

    const note =
      "Left a message with her neighbour. Try again after six.";
    await card.getByLabel("Reached them").check();
    await card.getByTestId("coverage-call-note").fill(note);
    await card.getByTestId("save-coverage-call").click();

    await expect(card.getByTestId("coverage-call-feedback")).toContainText(
      /call is recorded|Nothing was sent/i,
      { timeout: 45_000 },
    );
    await expect(card.getByTestId("coverage-calls")).toContainText(note, {
      timeout: 45_000,
    });
    await expect(card.getByTestId("coverage-calls")).toContainText(
      "Reached them",
    );
    await expect(card.getByTestId("coverage-message-count")).toHaveText(
      MESSAGE_LINE,
    );

    // The due line no longer claims a call is owed once one is printed
    // directly beneath it.
    const due = card.getByTestId("coverage-due");
    await expect(due).toHaveAttribute("data-call-recorded", "true");
    await expect(due).toHaveText(
      "A call is on record — offer this time again or close it.",
    );
    await expect(due).not.toContainText(/needs a call now/i);
    await expect(due).not.toContainText(/enters the coverage watch/i);

    const [row] = await db.client<
      {
        coordinator_id: string;
        outcome: string;
        note: string | null;
        created_at: string;
      }[]
    >`
      SELECT coordinator_id, outcome, note, created_at::text AS created_at
        FROM call_log
       WHERE slot_id = ${QUIET_WATCH_SLOT}
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `;
    expect(row.coordinator_id).toBe(QUIET_COORDINATOR);
    expect(row.outcome).toBe("reached");
    expect(row.note).toBe(note);
    expect(new Date(row.created_at).getTime()).toBeGreaterThan(
      FIXTURE_NOW.getTime() - 5 * 60_000,
    );

    expect(await notificationCountFor(db, QUIET_WATCH_SLOT)).toBe(0);
    expect(await totalNotifications(db)).toBe(2);

    await shot(grace.page, "coverage-call-recorded");
    await grace.context.close();
  });

  test("a time is offered again once after the call, and never a second time", async ({
    browser,
  }) => {
    const beforeOffer = await db.client<{ window_start: string }[]>`
      SELECT window_start::text AS window_start
        FROM slot WHERE id = ${QUIET_WATCH_SLOT}
    `;
    const originalStart = beforeOffer[0].window_start;

    const grace = await signIn(browser, QUIET_COORDINATOR_TOKEN);
    await grace.page.goto("/desk/failures");

    const card = grace.page.locator(
      `[data-testid="coverage-card"][data-slot-id="${QUIET_WATCH_SLOT}"]`,
    );

    const already = await reofferCount(db, QUIET_WATCH_SLOT);
    if (already === 0) {
      await expect(card).toBeVisible();
      await expect(card.getByTestId("coverage-reoffer")).toBeVisible();
      await card.getByTestId("coverage-reoffer").click();

      // A deliberate re-offer restarts the clock, so the time leaves the watch
      // until its new threshold. The record lives on the time's own page.
      await expect(card).toHaveCount(0, { timeout: 45_000 });
    }

    await grace.page.goto(`/desk/slot/${QUIET_WATCH_SLOT}`);
    await expect(
      grace.page.getByTestId("coverage-reoffer-disabled"),
    ).toContainText(/already been offered again once/i);
    await expect(grace.page.getByTestId("coverage-reoffer")).toHaveCount(0);

    const [row] = await db.client<{
      window_start: string;
      window_end: string | null;
      status: string;
    }[]>`
      SELECT
        window_start::text AS window_start,
        window_end::text AS window_end,
        status
        FROM slot WHERE id = ${QUIET_WATCH_SLOT}
    `;
    expect(row.status).toBe("open");
    expect(new Date(row.window_start).getTime()).toBeGreaterThan(
      new Date(originalStart).getTime() - 1,
    );

    const expectedNewWindow = formatWindowLabel(
      new Date(row.window_start),
      row.window_end ? new Date(row.window_end) : null,
      TIME_ZONE,
    );
    await expect(grace.page.getByTestId("coverage-window")).toHaveText(
      expectedNewWindow,
    );
    expect(await reofferCount(db, QUIET_WATCH_SLOT)).toBe(1);
    expect(await notificationCountFor(db, QUIET_WATCH_SLOT)).toBe(0);

    await shot(grace.page, "coverage-reoffered-once");
    await grace.context.close();
  });

  test("closing a time without a claim writes the zero-row proof with the query and digest", async ({
    browser,
  }) => {
    const grace = await signIn(browser, QUIET_COORDINATOR_TOKEN);
    const status = await slotStatus(db, QUIET_EXPIRE_SLOT);

    if (status === "open") {
      await grace.page.goto("/desk/failures");
      const card = grace.page.locator(
        `[data-testid="coverage-card"][data-slot-id="${QUIET_EXPIRE_SLOT}"]`,
      );
      await expect(card).toBeVisible();
      await expect(card.getByTestId("coverage-message-count")).toHaveText(
        MESSAGE_LINE,
      );
      await card.getByTestId("coverage-expire").click();
      // The card leaves the watch once the time closes; the proof lives on the
      // time's own review page.
      await expect(
        grace.page.locator(
          `[data-testid="coverage-card"][data-slot-id="${QUIET_EXPIRE_SLOT}"]`,
        ),
      ).toHaveCount(0, { timeout: 45_000 });
    }

    await grace.page.goto(`/desk/slot/${QUIET_EXPIRE_SLOT}`);
    const proof = grace.page.getByTestId("absence-proof");
    await expect(proof).toBeVisible();
    await expect(grace.page.getByTestId("absence-proof-count")).toHaveText(
      MESSAGE_LINE,
    );
    await expect(grace.page.getByTestId("absence-proof-query")).toContainText(
      "FROM notification",
    );

    const recipe = grace.page.getByTestId("absence-proof-recipe");
    await expect(recipe).toContainText(/SHA-256/i);
    await expect(recipe).toContainText(/no scheduled job/i);
    await expect(recipe).toContainText(/this time's id/i);
    await expect(recipe).toContainText(/count/i);
    await expect(recipe).toContainText(/written time/i);
    await expect(recipe).toContainText(/not a signature/i);
    await expect(recipe).not.toContainText(/anyone can check/i);

    const proofs = await absenceProofs(db, QUIET_EXPIRE_SLOT);
    expect(proofs).toHaveLength(1);
    expect(Number(proofs[0].caregiver_outbox_count)).toBe(0);
    expect(proofs[0].query_text).toBe(ABSENCE_PROOF_QUERY_TEXT);
    expect(proofs[0].digest).toMatch(/^[0-9a-f]{64}$/);

    // The stored digest is the documented recipe over this row, and the card
    // renders that exact digest rather than a constant.
    expect(recomputeAbsenceProofDigest(proofs[0])).toBe(proofs[0].digest);
    await expect(grace.page.getByTestId("absence-proof-digest")).toHaveText(
      proofs[0].digest,
    );

    expect(await slotStatus(db, QUIET_EXPIRE_SLOT)).toBe("expired_unclaimed");
    expect(await notificationCountFor(db, QUIET_EXPIRE_SLOT)).toBe(0);
    expect(await totalNotifications(db)).toBe(2);

    await shot(grace.page, "absence-proof");
    await grace.context.close();
  });

  test("the caregiver sees a human line only, and the last live time closes the ask", async ({
    browser,
  }) => {
    const marta = await signIn(browser, QUIET_CAREGIVER_TOKEN);
    await marta.page.goto("/care");

    const working = marta.page.getByTestId("care-coordinator-working");
    await expect(working).toBeVisible();
    await expect(working).toContainText(
      /Your coordinator is working on [A-Z][a-z]+/,
    );

    const careText = await marta.page.locator("body").innerText();
    expectNoDeskConcepts(careText, "/care");
    expect(careText).not.toMatch(/unclaimed|declined|waiting time|decline/i);

    // The server-rendered payload, not just the hydrated text, must not carry
    // the desk's status words to the caregiver.
    const careHtml = await (await marta.page.request.get("/care")).text();
    expect(careHtml).not.toMatch(/unclaimed|still waiting|waiting time|declined/i);

    await expect(
      marta.page.getByTestId("care-confirmation-body").first(),
    ).toContainText(/is covered/);
    await shot(marta.page, "care-human-line");

    await marta.page.goto(`/ask/${QUIET_ASK_TWO}`);
    const askText = await marta.page.locator("body").innerText();
    expectNoDeskConcepts(askText, "/ask/[id]");
    const askHtml = await (
      await marta.page.request.get(`/ask/${QUIET_ASK_TWO}`)
    ).text();
    expect(askHtml).not.toMatch(/unclaimed|still waiting|waiting time|declined/i);
    await expect(marta.page.getByTestId("ask-status")).toContainText(
      /Approved by Grace/i,
    );
    await shot(marta.page, "ask-approved-no-status");

    // Close the second ask's only time. This is the last live time on that
    // ask, so `closeAskIfFinished` must move it from approved to closed.
    const grace = await signIn(browser, QUIET_COORDINATOR_TOKEN);
    await grace.page.goto(`/desk/slot/${QUIET_CLOSURE_SLOT}`);

    if ((await slotStatus(db, QUIET_CLOSURE_SLOT)) === "open") {
      await grace.page.getByTestId("coverage-expire").click();
      await expect(grace.page.getByTestId("absence-proof")).toBeVisible({
        timeout: 45_000,
      });
    }

    await expect(grace.page.getByTestId("absence-proof-count")).toHaveText(
      MESSAGE_LINE,
    );
    expect(await askStatus(db, QUIET_ASK_TWO)).toBe("closed");

    await marta.page.goto(`/ask/${QUIET_ASK_TWO}`);
    await expect(marta.page.getByTestId("ask-closed")).toContainText(
      /This ask is closed/i,
    );
    const closedText = await marta.page.locator("body").innerText();
    expectNoDeskConcepts(closedText, "/ask/[id] closed");
    await shot(marta.page, "ask-closed-after-expiry");

    // No open or expired time ever produced an outbox row; the covered time
    // still has exactly its two human messages.
    for (const slotId of [
      QUIET_WATCH_SLOT,
      QUIET_EXPIRE_SLOT,
      QUIET_REOFFER_SLOT,
      QUIET_CLOSURE_SLOT,
    ]) {
      expect(await notificationCountFor(db, slotId)).toBe(0);
    }
    expect(await totalNotifications(db)).toBe(2);

    await grace.context.close();
    await marta.context.close();
  });
});

async function notificationCountFor(
  db: E2eDatabase,
  slotId: string,
): Promise<number> {
  return notificationsFor(db, slotId);
}

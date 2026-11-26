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

/**
 * VAL-AUDITFIX-016 on the real surface.
 *
 * `/desk/slot/[id]` opened with one hard-coded sentence for every status:
 * "A neighbour has said yes. Confirm the claim, or take it back before the
 * family hears anything." On a published time nobody had taken, and on the
 * time that closed unclaimed — the state that carries the absence proof — the
 * page told the coordinator a neighbour had said yes when nobody had.
 *
 * One quiet church of its own holds a time in every status. Each test opens
 * that time as its coordinator and pins the exact lead sentence. The expired
 * case is produced through the real coverage control, so its proof is written
 * by the application rather than by the fixture, and the page must then say
 * that no one took the time and point at that proof.
 *
 * The fixture church keeps the demo church untouched; the suite's global setup
 * truncates the isolated test database at the start of a run.
 */

const CHURCH = "d3000000-0000-4000-8000-000000000001";
const COORDINATOR = "d3000000-0000-4000-8000-000000000002";
const CAREGIVER = "d3000000-0000-4000-8000-000000000003";
const VOLUNTEER = "d3000000-0000-4000-8000-000000000004";
const RECIPIENT = "d3000000-0000-4000-8000-000000000005";
const ASK = "d3000000-0000-4000-8000-000000000006";
const POLICY = "d3000000-0000-4000-8000-000000000007";

const SLOT = {
  draft: "d3000000-0000-4000-8000-000000000008",
  open: "d3000000-0000-4000-8000-000000000009",
  claimed: "d3000000-0000-4000-8000-00000000000a",
  covered: "d3000000-0000-4000-8000-00000000000b",
  done: "d3000000-0000-4000-8000-00000000000c",
  cancelled: "d3000000-0000-4000-8000-00000000000d",
  expired: "d3000000-0000-4000-8000-00000000000e",
} as const;

const COORDINATOR_TOKEN = "e2e-slot-lead-coordinator";

const TIME_ZONE = "America/New_York";
const HOUR = 3_600_000;

const FIXTURE_NOW = new Date();
const WINDOW = (offsetDays: number) => {
  const start = new Date(
    FIXTURE_NOW.getTime() + offsetDays * 24 * HOUR,
  );
  return { start, end: new Date(start.getTime() + 2 * HOUR) };
};

const DRAFT_WINDOW = WINDOW(10);
const OPEN_WINDOW = WINDOW(11);
const CLAIMED_WINDOW = WINDOW(12);
const COVERED_WINDOW = WINDOW(13);
const DONE_WINDOW = WINDOW(-2);
const CANCELLED_WINDOW = WINDOW(14);
const EXPIRED_WINDOW = WINDOW(15);

const CONFIRMATION_BODY =
  "Tuesday is covered — June has a place at Respite Morning, and Ada will be their companion.";

/**
 * The sentences themselves, written here rather than imported, so a change to
 * the page's copy has to be a deliberate change to this test.
 */
const LEAD = {
  draft:
    "This time is not published yet. No neighbour can see it or say yes until it goes on the board.",
  open: "Published and waiting. No one has taken it yet — wait for a neighbour, or close this time without a claim before the family hears anything.",
  claimed:
    "A neighbour has said yes. Confirm the claim, or take it back before the family hears anything.",
  covered:
    "A neighbour said yes, and you confirmed it with the family. The family has their one message; this time is covered.",
  done: "This time is done. The visit is finished, and the family's one confirmation stays on their own page.",
  cancelled:
    "The church cancelled this time. Nothing is sent to the family from this screen.",
  expired_unclaimed:
    "No one took this time. It closed without a claim, and the family was sent nothing — the absence proof is below.",
} as const;

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "desk-slot-lead",
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

/**
 * Remove what this fixture wrote that is safe to remove. `absence_proof` and
 * the slot it names are append-only once the expiry has run, so a retry keeps
 * the advanced state and each test reads it before acting.
 */
async function clearFixtureMutations(db: E2eDatabase): Promise<void> {
  await db.client`DELETE FROM notification WHERE church_id = ${CHURCH}`;
  await db.client`
    DELETE FROM call_log
     WHERE slot_id IN (SELECT id FROM slot WHERE church_id = ${CHURCH})
  `;
  const [proofs] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
      FROM absence_proof
     WHERE slot_id IN (SELECT id FROM slot WHERE church_id = ${CHURCH})
  `;
  if (Number(proofs.count) === 0) {
    await db.client`DELETE FROM slot WHERE church_id = ${CHURCH}`;
  }
}

async function ensureFixture(db: E2eDatabase): Promise<void> {
  await clearFixtureMutations(db);

  await db.client`
    INSERT INTO church (id, name, timezone, demo_mode)
    VALUES (${CHURCH}, 'Cornerstone Fellowship', ${TIME_ZONE}, false)
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO person (id, church_id, first_name, last_name, roles, access_token)
    VALUES
      (${COORDINATOR}, ${CHURCH}, 'Grace', 'Cornerstone', '["coordinator"]'::jsonb, ${COORDINATOR_TOKEN}),
      (${CAREGIVER}, ${CHURCH}, 'Marta', 'Cornerstone', '["caregiver"]'::jsonb, 'e2e-slot-lead-caregiver'),
      (${VOLUNTEER}, ${CHURCH}, 'Ada', 'Cornerstone', '["volunteer"]'::jsonb, 'e2e-slot-lead-volunteer')
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
      'The weeks are long and I am running on empty. June is content with company and a cup of tea.',
      'approved', ${POLICY}, ${COORDINATOR}, now()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  // A JS Date is not bindable in a raw fragment; bind ISO strings and cast.
  await db.client`
    INSERT INTO slot (
      id, ask_id, church_id, kind, tier, label, window_start, window_end,
      gated, rule_ref, status, approved_by, approved_at
    )
    VALUES
      (
        ${SLOT.draft}, ${ASK}, ${CHURCH}, 'companion', 'public_event',
        'A companion place, not published yet',
        ${DRAFT_WINDOW.start.toISOString()}::timestamptz,
        ${DRAFT_WINDOW.end.toISOString()}::timestamptz,
        false, 'q1_companion', 'draft', NULL, NULL
      ),
      (
        ${SLOT.open}, ${ASK}, ${CHURCH}, 'companion', 'public_event',
        'A companion place at Respite Morning',
        ${OPEN_WINDOW.start.toISOString()}::timestamptz,
        ${OPEN_WINDOW.end.toISOString()}::timestamptz,
        false, 'q1_companion', 'open', ${COORDINATOR},
        ${new Date(FIXTURE_NOW.getTime() - 2 * HOUR).toISOString()}::timestamptz
      ),
      (
        ${SLOT.cancelled}, ${ASK}, ${CHURCH}, 'companion', 'public_event',
        'A companion place the church cancelled',
        ${CANCELLED_WINDOW.start.toISOString()}::timestamptz,
        ${CANCELLED_WINDOW.end.toISOString()}::timestamptz,
        false, 'q1_companion', 'cancelled', ${COORDINATOR},
        ${new Date(FIXTURE_NOW.getTime() - 2 * HOUR).toISOString()}::timestamptz
      ),
      (
        ${SLOT.expired}, ${ASK}, ${CHURCH}, 'meal', 'doorstep',
        'A reheatable meal nobody took',
        ${EXPIRED_WINDOW.start.toISOString()}::timestamptz,
        ${EXPIRED_WINDOW.end.toISOString()}::timestamptz,
        false, 'q3_meal', 'open', ${COORDINATOR},
        ${new Date(FIXTURE_NOW.getTime() - 30 * HOUR).toISOString()}::timestamptz
      )
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO slot (
      id, ask_id, church_id, kind, tier, label, window_start, window_end,
      gated, rule_ref, status, claimed_by, claimed_at, approved_by, approved_at
    )
    VALUES (
      ${SLOT.claimed}, ${ASK}, ${CHURCH}, 'companion', 'public_event',
      'A companion place Ada said yes to',
      ${CLAIMED_WINDOW.start.toISOString()}::timestamptz,
      ${CLAIMED_WINDOW.end.toISOString()}::timestamptz,
      false, 'q1_companion', 'claimed', ${VOLUNTEER},
      ${new Date(FIXTURE_NOW.getTime() - 1 * HOUR).toISOString()}::timestamptz,
      ${COORDINATOR},
      ${new Date(FIXTURE_NOW.getTime() - 20 * HOUR).toISOString()}::timestamptz
    )
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO slot (
      id, ask_id, church_id, kind, tier, label, window_start, window_end,
      gated, rule_ref, status, claimed_by, claimed_at, approved_by, approved_at,
      claim_confirmed_by, claim_confirmed_at
    )
    VALUES
      (
        ${SLOT.covered}, ${ASK}, ${CHURCH}, 'companion', 'public_event',
        'A covered companion place',
        ${COVERED_WINDOW.start.toISOString()}::timestamptz,
        ${COVERED_WINDOW.end.toISOString()}::timestamptz,
        false, 'q1_companion', 'covered', ${VOLUNTEER},
        ${new Date(FIXTURE_NOW.getTime() - 3 * HOUR).toISOString()}::timestamptz,
        ${COORDINATOR},
        ${new Date(FIXTURE_NOW.getTime() - 22 * HOUR).toISOString()}::timestamptz,
        ${COORDINATOR},
        ${new Date(FIXTURE_NOW.getTime() - 2 * HOUR).toISOString()}::timestamptz
      ),
      (
        ${SLOT.done}, ${ASK}, ${CHURCH}, 'companion', 'public_event',
        'A companion place that already happened',
        ${DONE_WINDOW.start.toISOString()}::timestamptz,
        ${DONE_WINDOW.end.toISOString()}::timestamptz,
        false, 'q1_companion', 'done', ${VOLUNTEER},
        ${new Date(FIXTURE_NOW.getTime() - 5 * 24 * HOUR).toISOString()}::timestamptz,
        ${COORDINATOR},
        ${new Date(FIXTURE_NOW.getTime() - 6 * 24 * HOUR).toISOString()}::timestamptz,
        ${COORDINATOR},
        ${new Date(FIXTURE_NOW.getTime() - 5 * 24 * HOUR).toISOString()}::timestamptz
      )
    ON CONFLICT (id) DO NOTHING
  `;

  // The covered time has the one human confirmation a coordinator's approval
  // writes. Insert is idempotent; the database refuses it for any slot that is
  // not covered, which is why the row lives only on the covered fixture.
  await db.client`
    INSERT INTO notification (
      church_id, slot_id, caregiver_id, kind, template_code, body, status,
      created_at
    )
    VALUES (
      ${CHURCH}, ${SLOT.covered}, ${CAREGIVER}, 'confirmation',
      'confirmation.companion', ${CONFIRMATION_BODY}, 'queued', now()
    )
    ON CONFLICT DO NOTHING
  `;
}

test.describe.configure({ timeout: 300_000 });

test.describe.serial("VAL-AUDITFIX-016 — the desk slot page's lead follows the status", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    db = await openE2eDatabase();
    await ensureFixture(db);
  });

  test.afterAll(async () => {
    if (db) {
      await clearFixtureMutations(db);
      await db.client.end();
    }
  });

  test("an open time invites the coordinator to wait or close it, and never claims a neighbour", async ({
    browser,
  }) => {
    const grace = await signIn(browser, COORDINATOR_TOKEN);
    const response = await grace.page.goto(`/desk/slot/${SLOT.open}`);
    expect(response?.status()).toBe(200);

    const lead = grace.page.getByTestId("slot-lead");
    await expect(lead).toHaveText(LEAD.open);
    await expect(grace.page.getByTestId("slot-status")).toHaveAttribute(
      "data-status",
      "open",
    );

    // The audit's sentence, word for word, is not on this page in any form.
    await expect(lead).not.toContainText(/has said yes/i);
    await expect(grace.page.locator("body")).not.toContainText(
      "A neighbour has said yes. Confirm the claim",
    );

    // The lead names the control the coordinator actually has here.
    await expect(grace.page.getByTestId("coverage-expire")).toBeVisible();

    await shot(grace.page, "lead-open");
    await grace.context.close();
  });

  test("a claimed time keeps the confirm/take-back wording and both actions", async ({
    browser,
  }) => {
    const grace = await signIn(browser, COORDINATOR_TOKEN);
    await grace.page.goto(`/desk/slot/${SLOT.claimed}`);

    await expect(grace.page.getByTestId("slot-lead")).toHaveText(LEAD.claimed);
    await expect(grace.page.getByTestId("slot-status")).toHaveAttribute(
      "data-status",
      "claimed",
    );
    await expect(grace.page.getByTestId("approve-claim")).toBeVisible();
    await expect(grace.page.getByTestId("revoke-claim")).toBeVisible();

    await shot(grace.page, "lead-claimed");
    await grace.context.close();
  });

  test("a time that closed without a claim says so and points at the absence proof", async ({
    browser,
  }) => {
    const grace = await signIn(browser, COORDINATOR_TOKEN);
    await grace.page.goto(`/desk/slot/${SLOT.expired}`);

    // A retry keeps the state the earlier attempt advanced to. The open
    // sentence itself is pinned by the open time's own test.
    if ((await slotStatus(db, SLOT.expired)) === "open") {
      // This time is past its call threshold, so the call is recorded before
      // the close. The close is otherwise refused, which is the product's
      // promise on the card.
      const coverage = grace.page.getByTestId("desk-coverage");
      await coverage.getByLabel("Reached them").check();
      await coverage.getByTestId("save-coverage-call").click();
      await expect(coverage.getByTestId("coverage-calls")).toContainText(
        "Reached them",
        { timeout: 20_000 },
      );
      await grace.page.getByTestId("coverage-expire").click();
      await expect(grace.page.getByTestId("absence-proof")).toBeVisible({
        timeout: 45_000,
      });
    }

    expect(await slotStatus(db, SLOT.expired)).toBe("expired_unclaimed");

    const lead = grace.page.getByTestId("slot-lead");
    await expect(lead).toHaveText(LEAD.expired_unclaimed);
    await expect(grace.page.getByTestId("slot-status")).toHaveAttribute(
      "data-status",
      "expired_unclaimed",
    );
    await expect(lead).toContainText(/no one took/i);
    await expect(lead).toContainText(/absence proof/i);
    await expect(lead).not.toContainText(/has said yes/i);

    // The thing the lead points at is on the same page.
    await expect(grace.page.getByTestId("absence-proof")).toBeVisible();
    await expect(grace.page.getByTestId("absence-proof-count")).toContainText(
      "Messages sent to the caregiver about this slot: 0",
    );
    await expect(grace.page.locator("body")).not.toContainText(
      "A neighbour has said yes. Confirm the claim",
    );

    await shot(grace.page, "lead-expired-unclaimed");
    await grace.context.close();
  });

  test("a covered time says the family has its one message", async ({
    browser,
  }) => {
    const grace = await signIn(browser, COORDINATOR_TOKEN);
    await grace.page.goto(`/desk/slot/${SLOT.covered}`);

    await expect(grace.page.getByTestId("slot-lead")).toHaveText(LEAD.covered);
    await expect(grace.page.getByTestId("slot-status")).toHaveAttribute(
      "data-status",
      "covered",
    );
    // No claim decision remains once it is confirmed.
    await expect(grace.page.getByTestId("approve-claim")).toHaveCount(0);
    await expect(grace.page.getByTestId("revoke-claim")).toHaveCount(0);

    await shot(grace.page, "lead-covered");
    await grace.context.close();
  });

  test("a done time says the visit is finished", async ({ browser }) => {
    const grace = await signIn(browser, COORDINATOR_TOKEN);
    await grace.page.goto(`/desk/slot/${SLOT.done}`);

    await expect(grace.page.getByTestId("slot-lead")).toHaveText(LEAD.done);
    await expect(grace.page.getByTestId("slot-status")).toHaveAttribute(
      "data-status",
      "done",
    );

    await shot(grace.page, "lead-done");
    await grace.context.close();
  });

  test("a cancelled time names the church's decision and sends nothing", async ({
    browser,
  }) => {
    const grace = await signIn(browser, COORDINATOR_TOKEN);
    await grace.page.goto(`/desk/slot/${SLOT.cancelled}`);

    await expect(grace.page.getByTestId("slot-lead")).toHaveText(LEAD.cancelled);
    await expect(grace.page.getByTestId("slot-status")).toHaveAttribute(
      "data-status",
      "cancelled",
    );
    await expect(grace.page.getByTestId("slot-lead")).not.toContainText(
      /has said yes/i,
    );

    await shot(grace.page, "lead-cancelled");
    await grace.context.close();
  });

  test("a draft time says no neighbour can see it yet", async ({ browser }) => {
    const grace = await signIn(browser, COORDINATOR_TOKEN);
    await grace.page.goto(`/desk/slot/${SLOT.draft}`);

    await expect(grace.page.getByTestId("slot-lead")).toHaveText(LEAD.draft);
    await expect(grace.page.getByTestId("slot-status")).toHaveAttribute(
      "data-status",
      "draft",
    );
    await expect(grace.page.getByTestId("slot-lead")).not.toContainText(
      /has said yes/i,
    );

    await shot(grace.page, "lead-draft");
    await grace.context.close();
  });
});

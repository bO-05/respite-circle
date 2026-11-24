import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { seedAccessTokens, seedIds } from "../../src/db/seed-data";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-SESSION-001 through VAL-SESSION-004 on the real surface.
 *
 * The desk and the sessions page show one weekly Tuesday morning, four
 * materialised weeks ahead, with capacity and remaining places. Filling the
 * calendar twice adds nothing. A cancelled week shows a banner and refuses a
 * companion proposal with the week named. A full morning refuses another place.
 * Cancelling a morning cancels its places, puts coordinator call tasks on the
 * desk, and writes zero caregiver notifications.
 */

const STORY =
  "I haven't had a Tuesday morning to myself since March. Mum is fine with people she knows, she just can't be alone.\n\nShe loves hymns and tea, and she naps after lunch.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "sessions",
);

const LIVE_SLOT_STATUSES = "('draft', 'open', 'claimed', 'covered', 'done')";

type SessionRow = {
  id: string;
  starts_at: Date;
  status: string;
  capacity: number;
  used: number;
};

type SlotRow = {
  id: string;
  session_id: string | null;
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

async function createAsk(
  context: BrowserContext,
  text: string,
): Promise<string> {
  const response = await context.request.post("/api/asks", {
    data: { text, consent: true },
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

async function futureSessions(db: E2eDatabase): Promise<SessionRow[]> {
  return db.client<SessionRow[]>`
    SELECT s.id,
           s.starts_at,
           s.status,
           s.capacity,
           (SELECT COUNT(*)::int
              FROM slot
             WHERE session_id = s.id
               AND status IN ${db.client.unsafe(LIVE_SLOT_STATUSES)}) AS used
      FROM session s
     WHERE s.starts_at > now()
     ORDER BY s.starts_at
  `;
}

async function slotForAsk(db: E2eDatabase, askId: string): Promise<SlotRow[]> {
  return db.client<SlotRow[]>`
    SELECT id, session_id, status
      FROM slot
     WHERE ask_id = ${askId}
     ORDER BY kind
  `;
}

async function notificationCount(db: E2eDatabase): Promise<number> {
  const [row] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM notification
  `;
  return Number(row.count);
}

async function callLogCount(db: E2eDatabase): Promise<number> {
  const [row] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM call_log
  `;
  return Number(row.count);
}

async function insertFixtureAsk(
  db: E2eDatabase,
  text: string,
): Promise<string> {
  const [row] = await db.client<{ id: string }[]>`
    INSERT INTO ask (church_id, caregiver_id, care_recipient_id, verbatim_text, status, policy_version_id)
    VALUES (${seedIds.church}, ${seedIds.people.marta}, ${seedIds.careRecipients.elena}, ${text}, 'waiting_coordinator', ${seedIds.policyV1})
    RETURNING id
  `;
  return row.id;
}

async function insertFixtureCompanionSlot(
  db: E2eDatabase,
  input: { askId: string; sessionId: string; status: string },
): Promise<string> {
  const [row] = await db.client<{ id: string }[]>`
    INSERT INTO slot (ask_id, church_id, session_id, kind, tier, label, status)
    VALUES (
      ${input.askId},
      ${seedIds.church},
      ${input.sessionId},
      'companion',
      'public_event',
      'Companion place at Respite Morning',
      ${input.status}
    )
    RETURNING id
  `;
  return row.id;
}

async function capacityLineFor(
  db: E2eDatabase,
  row: SessionRow,
): Promise<string> {
  const used = Number(row.used);
  if (used >= row.capacity) {
    return `Full — ${row.capacity} of ${row.capacity} places taken`;
  }
  return `${row.capacity - used} of ${row.capacity} places left`;
}

test.describe.configure({ timeout: 180_000 });

test.describe("VAL-SESSION-001…004 — weekly Respite Morning sessions", () => {
  let db: E2eDatabase;
  const createdAskIds: string[] = [];

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    // The browser suite shares one database. Put the calendar back to four
    // scheduled Tuesdays with its seeded capacity, and remove the places this
    // spec opened so later specs do not inherit a full morning.
    await db.client`UPDATE session SET status = 'scheduled', capacity = 12`;
    for (const askId of createdAskIds) {
      await db.client`
        DELETE FROM call_log
         WHERE slot_id IN (SELECT id FROM slot WHERE ask_id = ${askId})
      `;
      await db.client`
        DELETE FROM slot_candidate
         WHERE slot_id IN (SELECT id FROM slot WHERE ask_id = ${askId})
      `;
      await db.client`DELETE FROM slot WHERE ask_id = ${askId}`;
      await db.client`UPDATE ask SET status = 'closed' WHERE id = ${askId}`;
    }
    await db.client.end();
  });

  test("VAL-SESSION-001 and VAL-SESSION-003 — the desk and the sessions page show four Tuesdays with capacity, and filling twice adds nothing", async ({
    browser,
  }) => {
    const sessionsBefore = await futureSessions(db);
    expect(sessionsBefore).toHaveLength(4);
    expect(sessionsBefore.every((row) => row.status === "scheduled")).toBe(true);

    const grace = await signIn(browser, seedAccessTokens.grace);

    await grace.page.goto("/desk");
    const strip = grace.page.getByTestId("desk-session-strip");
    await expect(strip).toBeVisible({ timeout: 30_000 });
    await expect(strip.getByTestId("desk-session-row")).toHaveCount(4);
    await expect(grace.page.getByTestId("session-banner")).toHaveCount(0);
    const stripCapacity = strip.getByTestId("desk-session-capacity");
    for (const [index, row] of sessionsBefore.entries()) {
      await expect(stripCapacity.nth(index)).toContainText(
        await capacityLineFor(db, row),
      );
    }
    await shot(grace.page, "desk-calendar");

    await grace.page.goto("/desk/sessions");
    const cards = grace.page.getByTestId("session-card");
    await expect(cards).toHaveCount(4, { timeout: 30_000 });
    await expect(grace.page.getByTestId("session-template")).toContainText(
      "Every Tuesday, 10:00–14:00",
    );
    for (const [index, row] of sessionsBefore.entries()) {
      const card = cards.nth(index);
      await expect(card).toHaveAttribute("data-status", "scheduled");
      await expect(card).toHaveAttribute("data-capacity", String(row.capacity));
      await expect(card.getByTestId("session-capacity")).toContainText(
        await capacityLineFor(db, row),
      );
    }
    await shot(grace.page, "sessions-page");

    await grace.page.getByTestId("session-fill").click();
    await expect(grace.page.getByTestId("session-fill-feedback")).toContainText(
      "Nothing to add",
      { timeout: 30_000 },
    );
    await shot(grace.page, "sessions-fill-idempotent");

    const [count] = await db.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM session
    `;
    expect(Number(count.count)).toBe(4);
    await grace.context.close();
  });

  test("VAL-SESSION-002 — a cancelled week shows the desk banner and refuses a companion proposal, naming the week", async ({
    browser,
  }) => {
    const sessions = await futureSessions(db);
    const emptyFirst = sessions
      .filter((row) => Number(row.used) === 0)
      .at(-1);
    const target = emptyFirst ?? sessions.at(-1)!;

    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto("/desk/sessions");
    await expect(grace.page.getByTestId("session-card")).toHaveCount(4, {
      timeout: 30_000,
    });

    await grace.page.getByTestId(`session-cancel-${target.id}`).click();
    const cancelledCard = grace.page.locator(
      `[data-testid="session-card"][data-session-id="${target.id}"]`,
    );
    await expect(cancelledCard).toHaveAttribute("data-status", "cancelled", {
      timeout: 30_000,
    });
    await expect(
      grace.page.getByTestId(`session-restore-${target.id}`),
    ).toBeVisible();
    await shot(grace.page, "sessions-after-cancel");

    await grace.page.goto("/desk");
    const banner = grace.page.getByTestId("session-banner");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toHaveAttribute("data-scheduled-count", "3");
    await expect(grace.page.getByTestId("session-banner-message")).toContainText(
      "was cancelled",
    );
    await expect(grace.page.getByTestId("session-banner-message")).toContainText(
      "Fill the calendar first",
    );
    await shot(grace.page, "desk-calendar-banner");

    const marta = await signIn(browser, seedAccessTokens.marta);
    const askId = await createAsk(marta.context, STORY);
    createdAskIds.push(askId);
    await marta.context.close();

    await grace.page.goto(`/desk/ask/${askId}`);
    const skipped = grace.page.locator(
      '[data-testid="draft-skipped-item"][data-kind="companion"][data-reason="calendar_incomplete"]',
    );
    await expect(skipped).toBeVisible({ timeout: 30_000 });
    await expect(skipped).toContainText("was cancelled");
    await expect(skipped).toContainText("Fill the calendar first");
    await shot(grace.page, "desk-ask-calendar-refused");

    // A coordinator cannot add the missing week by hand either.
    await grace.page.getByTestId("draft-add-kind").selectOption("companion");
    await grace.page.getByTestId("draft-add-submit").click();
    await expect(grace.page.getByTestId("draft-add-feedback")).toContainText(
      "was cancelled",
      { timeout: 30_000 },
    );
    const companionDrafts = await db.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
        FROM slot
       WHERE ask_id = ${askId} AND kind = 'companion'
    `;
    expect(Number(companionDrafts[0]!.count)).toBe(0);
    await shot(grace.page, "desk-ask-companion-refused");

    // Put the Tuesday back so the last test starts from a complete calendar.
    await grace.page.goto("/desk/sessions");
    await grace.page.getByTestId(`session-restore-${target.id}`).click();
    await expect(
      grace.page.locator(
        `[data-testid="session-card"][data-session-id="${target.id}"]`,
      ),
    ).toHaveAttribute("data-status", "scheduled", { timeout: 30_000 });
    await grace.context.close();
  });

  test("VAL-SESSION-003 — a full morning shows Full on the desk and cannot accept another companion place", async ({
    browser,
  }) => {
    const sessions = await futureSessions(db);
    const grace = await signIn(browser, seedAccessTokens.grace);

    const fillerAskId = await insertFixtureAsk(
      db,
      "Fixture ask that fills every Tuesday morning.",
    );
    createdAskIds.push(fillerAskId);

    try {
      await db.client`UPDATE session SET capacity = 1 WHERE starts_at > now()`;
      for (const row of sessions) {
        await insertFixtureCompanionSlot(db, {
          askId: fillerAskId,
          sessionId: row.id,
          status: "draft",
        });
      }

      await grace.page.goto("/desk/sessions");
      const cards = grace.page.getByTestId("session-card");
      await expect(cards).toHaveCount(4, { timeout: 30_000 });
      for (let index = 0; index < 4; index += 1) {
        await expect(cards.nth(index)).toHaveAttribute("data-capacity", "1");
        await expect(
          cards.nth(index).getByTestId("session-capacity"),
        ).toContainText("Full — 1 of 1 places taken");
      }
      await shot(grace.page, "sessions-all-full");

      await grace.page.goto("/desk");
      const stripCapacity = grace.page
        .getByTestId("desk-session-strip")
        .getByTestId("desk-session-capacity");
      await expect(stripCapacity.first()).toContainText(
        "Full — 1 of 1 places taken",
        { timeout: 30_000 },
      );
      await shot(grace.page, "desk-calendar-full");

      const marta = await signIn(browser, seedAccessTokens.marta);
      const askId = await createAsk(marta.context, STORY);
      createdAskIds.push(askId);
      await marta.context.close();

      await grace.page.goto(`/desk/ask/${askId}`);
      const skipped = grace.page.locator(
        '[data-testid="draft-skipped-item"][data-kind="companion"][data-reason="no_session_capacity"]',
      );
      await expect(skipped).toBeVisible({ timeout: 30_000 });
      await expect(skipped).toContainText("No Respite Morning");

      await grace.page.getByTestId("draft-add-kind").selectOption("companion");
      await grace.page.getByTestId("draft-add-submit").click();
      await expect(grace.page.getByTestId("draft-add-feedback")).toContainText(
        "full",
        { timeout: 30_000 },
      );
      await expect(grace.page.getByTestId("draft-add-feedback")).toContainText(
        "1 of 1 places taken",
      );
      const companionDrafts = await db.client<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
          FROM slot
         WHERE ask_id = ${askId} AND kind = 'companion'
      `;
      expect(Number(companionDrafts[0]!.count)).toBe(0);
      await shot(grace.page, "desk-ask-full-refused");
    } finally {
      await db.client`UPDATE session SET capacity = 12 WHERE starts_at > now()`;
      await db.client`
        DELETE FROM slot_candidate
         WHERE slot_id IN (SELECT id FROM slot WHERE ask_id = ${fillerAskId})
      `;
      await db.client`DELETE FROM slot WHERE ask_id = ${fillerAskId}`;
    }

    await grace.context.close();
  });

  test("VAL-SESSION-004 — cancelling a morning cancels its places, puts call tasks on the desk, and sends nothing", async ({
    browser,
  }) => {
    const notificationsBefore = await notificationCount(db);
    const callsBefore = await callLogCount(db);
    expect(notificationsBefore).toBe(0);

    const marta = await signIn(browser, seedAccessTokens.marta);
    const askId = await createAsk(marta.context, STORY);
    createdAskIds.push(askId);
    await marta.context.close();

    const slots = await slotForAsk(db, askId);
    const companion = slots.find((row) => row.session_id !== null);
    expect(companion, "construction must propose one companion place").toBeDefined();
    const sessionId = companion!.session_id!;

    // Publish the place the way approval would, so cancellation has a live
    // place to close.
    await db.client`
      UPDATE slot SET status = 'open' WHERE id = ${companion!.id}
    `;
    await db.client`
      UPDATE ask SET status = 'approved' WHERE id = ${askId}
    `;

    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto("/desk/sessions");
    await expect(grace.page.getByTestId("session-card")).toHaveCount(4, {
      timeout: 30_000,
    });

    await grace.page.getByTestId(`session-cancel-${sessionId}`).click();
    const cancelledCard = grace.page.locator(
      `[data-testid="session-card"][data-session-id="${sessionId}"]`,
    );
    await expect(cancelledCard).toHaveAttribute("data-status", "cancelled", {
      timeout: 30_000,
    });

    const [slotAfter] = await db.client<{ status: string }[]>`
      SELECT status FROM slot WHERE id = ${companion!.id}
    `;
    expect(slotAfter!.status).toBe("cancelled");
    expect(await notificationCount(db)).toBe(notificationsBefore);

    const callTask = grace.page.locator(
      `[data-testid="call-task"][data-slot-id="${companion!.id}"]`,
    );
    await expect(callTask).toBeVisible({ timeout: 30_000 });
    await expect(callTask.getByTestId("call-task-name")).toHaveText(
      "Call Marta about Elena",
    );
    await shot(grace.page, "sessions-cancelled-call-task");

    await grace.page.getByTestId(`call-task-done-${companion!.id}`).click();
    await expect(callTask).toHaveCount(0, { timeout: 30_000 });
    expect(await callLogCount(db)).toBe(callsBefore + 1);
    expect(await notificationCount(db)).toBe(notificationsBefore);
    await shot(grace.page, "sessions-call-recorded");

    // Restore the morning so later specs read a complete calendar; the place
    // it cancelled stays cancelled on purpose.
    await grace.page.getByTestId(`session-restore-${sessionId}`).click();
    await expect(
      grace.page.locator(
        `[data-testid="session-card"][data-session-id="${sessionId}"]`,
      ),
    ).toHaveAttribute("data-status", "scheduled", { timeout: 30_000 });
    await grace.context.close();
  });
});

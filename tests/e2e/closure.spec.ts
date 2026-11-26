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
 * VAL-CONFIRM-005 and VAL-CROSS-001 on the real surface.
 *
 * The whole loop runs through the real UI and server: Marta opens her personal
 * access link and writes a new ask, Grace publishes it from the desk, Ruth
 * claims the companion time from the congregation board, Grace confirms the
 * claim, Marta reads the one human confirmation, Ruth closes the time from
 * `/claim/<id>/close`, and the ask closes behind her.
 *
 * Then the caregiver's optional half: Marta leaves a thank-you (kept for Ruth,
 * with no new notification) and asks again from a page that starts empty. The
 * earlier words are never copied, quoted, or pre-filled, and the original ask
 * keeps them byte-identical.
 *
 * The invite composer is a later feature; this spec enters at Marta's seeded
 * personal link, which is the invite the coordinator sends. Every other step is
 * the real route or form.
 */

const FIRST_ASK =
  "I haven't had a Saturday morning to myself since March. Mum can't be alone for long, and she loves hymns and tea.";

const SECOND_ASK =
  "The coming week is heavy. Could someone sit with Mum on Saturday so I can sleep and shop?";

const THANK_YOU =
  "Thank you, Ruth. The hymns and the tea made her whole morning.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "closure",
);

type SlotRow = {
  id: string;
  kind: string;
  status: string;
  claimed_by: string | null;
  session_id: string | null;
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

async function slotsFor(db: E2eDatabase, askId: string): Promise<SlotRow[]> {
  return db.client<SlotRow[]>`
    SELECT id, kind, status, claimed_by, session_id
      FROM slot
     WHERE ask_id = ${askId}
     ORDER BY kind
  `;
}

async function notificationsFor(
  db: E2eDatabase,
  slotId: string,
): Promise<Array<{ kind: string }>> {
  return db.client<Array<{ kind: string }>>`
    SELECT kind FROM notification WHERE slot_id = ${slotId} ORDER BY created_at
  `;
}

async function askRow(
  db: E2eDatabase,
  askId: string,
): Promise<{ status: string; verbatim_text: string }> {
  const [row] = await db.client<
    Array<{ status: string; verbatim_text: string }>
  >`
    SELECT status, verbatim_text FROM ask WHERE id = ${askId}
  `;
  return row;
}

async function thankYouRows(
  db: E2eDatabase,
  slotId: string,
): Promise<Array<{ actor_id: string; detail: { note?: string } }>> {
  return db.client<Array<{ actor_id: string; detail: { note?: string } }>>`
    SELECT actor_id, detail
      FROM audit_event
     WHERE entity = 'slot'
       AND entity_id = ${slotId}
       AND action = 'slot_thanked'
     ORDER BY created_at
  `;
}

async function auditActions(
  db: E2eDatabase,
  action: string,
  entityId: string,
): Promise<number> {
  const [row] = await db.client<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
      FROM audit_event
     WHERE action = ${action}
       AND entity_id = ${entityId}
  `;
  return Number(row.count);
}

test.describe.configure({ timeout: 300_000 });

test.describe.serial("VAL-CONFIRM-005 and VAL-CROSS-001 — the loop closes", () => {
  let db: E2eDatabase;
  const createdAskIds: string[] = [];
  let firstAskId: string;
  let slotId: string;
  let secondAskId: string | null = null;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    db = await openE2eDatabase();

    // Marta arrives by her personal link and writes her own words.
    const marta = await signIn(browser, seedAccessTokens.marta);
    await marta.page.goto("/ask");
    await marta.page.getByLabel(/Tell us what a hard week looks like/i).fill(
      FIRST_ASK,
    );
    await marta.page
      .getByLabel(/i agree that the church may keep these words/i)
      .check();
    const submitted = marta.page.waitForResponse(
      (response) =>
        response.url().includes("/api/asks") &&
        response.request().method() === "POST",
      // The first ask of a cold run constructs draft slots on a cold compute.
      { timeout: 45_000 },
    );
    await marta.page.getByRole("button", { name: /send this to/i }).click();
    expect((await submitted).status()).toBe(201);
    await marta.page.waitForURL(/\/ask\/[0-9a-f-]{36}$/, { timeout: 45_000 });
    firstAskId = marta.page.url().split("/ask/")[1]!.split("?")[0]!;
    createdAskIds.push(firstAskId);
    await marta.context.close();

    // Grace publishes the one companion time plain code proposed.
    const grace = await signIn(browser, seedAccessTokens.grace);
    const desk = await grace.page.goto(`/desk/ask/${firstAskId}`);
    expect(desk?.status()).toBe(200);
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(1);
    await grace.page.getByTestId("approve-ask").click();
    await expect(grace.page.getByTestId("ask-review")).toHaveAttribute(
      "data-status",
      "approved",
      { timeout: 30_000 },
    );
    await grace.context.close();

    const slots = await slotsFor(db, firstAskId);
    const companion = slots.find((row) => row.kind === "companion");
    if (!companion) throw new Error("expected a companion slot");
    expect(companion.status).toBe("open");
    slotId = companion.id;

    // Ruth says yes on the board, in one real tap.
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    await ruth.page.goto("/circle");
    const card = ruth.page.locator(
      `[data-testid="board-slot"][data-slot-id="${slotId}"]`,
    );
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "I'll take this time" }).click();
    await ruth.page.waitForURL(/\/circle\?claim=claimed/, { timeout: 20_000 });
    await ruth.context.close();

    // Grace confirms the claim; exactly one human message is written.
    const graceAgain = await signIn(browser, seedAccessTokens.grace);
    await graceAgain.page.goto(`/desk/slot/${slotId}`);
    await graceAgain.page.getByTestId("approve-claim").click();
    await expect(graceAgain.page.getByTestId("claim-review")).toHaveAttribute(
      "data-status",
      "covered",
      { timeout: 30_000 },
    );
    await graceAgain.context.close();

    expect(await notificationsFor(db, slotId)).toHaveLength(1);
  });

  test.afterAll(async () => {
    for (const askId of createdAskIds) {
      await db.client`
        DELETE FROM notification
         WHERE slot_id IN (SELECT id FROM slot WHERE ask_id = ${askId})
      `;
      await db.client`
        DELETE FROM slot_candidate
         WHERE slot_id IN (SELECT id FROM slot WHERE ask_id = ${askId})
      `;
      await db.client`DELETE FROM slot WHERE ask_id = ${askId}`;
    }
    await db.client.end();
  });

  test("VAL-CONFIRM-005 — Marta reads the one confirmation before the time is closed", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    await marta.page.goto("/care");

    await expect(marta.page.getByTestId("care-confirmation")).toHaveCount(1);
    const card = marta.page.getByTestId("care-confirmation");
    await expect(card).toContainText("Ruth");
    await expect(card.getByTestId("care-confirmation-when")).toContainText(
      /Tuesday/,
    );
    // The closure options do not exist before the time is done.
    await expect(card.getByTestId("care-closure")).toHaveCount(0);

    await shot(marta.page, "care-confirmation-before-closure");
    await marta.context.close();
  });

  test("VAL-CONFIRM-005 — Ruth closes the time from the closure page and the ask closes", async ({
    browser,
  }) => {
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    await ruth.page.goto(`/my-claims/${slotId}`);
    const link = ruth.page.getByTestId("claim-closure-link");
    await expect(link).toBeVisible();
    await link.click();
    await ruth.page.waitForURL(new RegExp(`/claim/${slotId}/close`), {
      timeout: 20_000,
    });

    await expect(ruth.page.getByTestId("closure-panel")).toHaveAttribute(
      "data-status",
      "covered",
    );
    // The real window is still ahead, so the page says so calmly.
    await expect(ruth.page.getByTestId("closure-waiting")).toBeVisible();
    await expect(ruth.page.getByTestId("closure-done-form")).toHaveCount(0);
    await shot(ruth.page, "closure-before-the-window");

    // Move this one time into the past, exactly as the clock would.
    await db.client`
      UPDATE slot
         SET window_start = '2026-11-14T15:00:00.000Z'::timestamptz,
             window_end = '2026-11-14T17:00:00.000Z'::timestamptz
       WHERE id = ${slotId}
    `;
    await ruth.page.reload();

    const form = ruth.page.getByTestId("closure-done-form");
    await expect(form).toBeVisible();
    const posted = ruth.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/slots/${slotId}/done`) &&
        response.request().method() === "POST",
    );
    await ruth.page.getByRole("button", { name: "Mark this time done" }).click();
    expect([303, 200]).toContain((await posted).status());
    await ruth.page.waitForURL(/\/close\?done=done/, { timeout: 20_000 });

    await expect(ruth.page.getByTestId("closure-done")).toBeVisible();
    await expect(ruth.page.getByTestId("closure-status")).toHaveText(
      "Done — thank you",
    );
    await expect(ruth.page.getByTestId("closure-thank-you")).toHaveCount(0);

    const [slot] = await slotsFor(db, firstAskId);
    expect(slot?.status).toBe("done");
    const ask = await askRow(db, firstAskId);
    expect(ask.status).toBe("closed");
    expect(ask.verbatim_text).toBe(FIRST_ASK);
    expect(await auditActions(db, "slot_done", slotId)).toBe(1);
    expect(await auditActions(db, "ask_closed", firstAskId)).toBe(1);

    // Closing sends nothing: the one confirmation is still the only row.
    expect(await notificationsFor(db, slotId)).toHaveLength(1);
    await shot(ruth.page, "closure-done");
    await ruth.context.close();
  });

  test("VAL-CONFIRM-005 — Marta leaves a thank-you, and the ask shows closed with no new message", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    await marta.page.goto("/care");

    const card = marta.page.getByTestId("care-confirmation");
    await expect(card.getByTestId("care-closure")).toBeVisible();
    await expect(card.getByTestId("care-ask-closed")).toContainText(
      /this ask is closed/i,
    );
    await expect(card.getByTestId("care-thank-you-form")).toBeVisible();

    await card
      .getByLabel(/A thank-you for Ruth \(optional\)/)
      .fill(THANK_YOU);
    await card.getByTestId("care-thank-you-submit").click();
    await marta.page.waitForURL(/\/care\?thanks=added/, { timeout: 20_000 });

    await expect(marta.page.getByTestId("care-thanks-flash")).toContainText(
      /kept/i,
    );
    const kept = marta.page.getByTestId("care-thank-you-kept");
    await expect(kept).toBeVisible();
    await expect(kept).toContainText(THANK_YOU);
    await expect(marta.page.getByTestId("care-thank-you-form")).toHaveCount(0);

    const rows = await thankYouRows(db, slotId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_id).toBe(seedIds.people.marta);
    expect(rows[0]?.detail.note).toBe(THANK_YOU);

    // Not one new notification, reminder, or follow-up.
    expect(await notificationsFor(db, slotId)).toHaveLength(1);
    await shot(marta.page, "care-thank-you-kept");
    await marta.context.close();
  });

  test("VAL-CONFIRM-005 — Ruth reads the family's thank-you on the closure", async ({
    browser,
  }) => {
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    await ruth.page.goto(`/claim/${slotId}/close`);

    const thanks = ruth.page.getByTestId("closure-thank-you");
    await expect(thanks).toBeVisible();
    await expect(thanks.getByTestId("closure-thank-you-body")).toHaveText(
      THANK_YOU,
    );
    // The volunteer sees the words, never the family's identity or story.
    const html = await ruth.page.content();
    for (const forbidden of ["Marta", "Alvarez", FIRST_ASK]) {
      expect(html).not.toContain(forbidden);
    }

    await shot(ruth.page, "closure-thank-you");
    await ruth.context.close();
  });

  test("VAL-CROSS-001 — Marta asks again from a blank page, and the old words stay untouched", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    await marta.page.goto("/care");

    const askAgain = marta.page.getByTestId("care-ask-again");
    await expect(askAgain).toBeVisible();
    await askAgain.click();
    await marta.page.waitForURL(/\/ask\?again=1/, { timeout: 20_000 });

    await expect(marta.page.getByTestId("ask-again-note")).toBeVisible();
    const textarea = marta.page.locator("#ask-text");
    await expect(textarea).toHaveValue("");
    const html = await marta.page.content();
    expect(html).not.toContain(FIRST_ASK);

    await textarea.fill(SECOND_ASK);
    await marta.page
      .getByLabel(/i agree that the church may keep these words/i)
      .check();
    const submitted = marta.page.waitForResponse(
      (response) =>
        response.url().includes("/api/asks") &&
        response.request().method() === "POST",
      { timeout: 45_000 },
    );
    await marta.page.getByRole("button", { name: /send this to/i }).click();
    expect((await submitted).status()).toBe(201);
    await marta.page.waitForURL(/\/ask\/[0-9a-f-]{36}$/, { timeout: 45_000 });

    secondAskId = marta.page.url().split("/ask/")[1]!.split("?")[0]!;
    createdAskIds.push(secondAskId);
    expect(secondAskId).not.toBe(firstAskId);

    const fresh = await askRow(db, secondAskId);
    expect(fresh.verbatim_text).toBe(SECOND_ASK);
    expect(fresh.status).toBe("waiting_coordinator");

    const original = await askRow(db, firstAskId);
    expect(original.verbatim_text).toBe(FIRST_ASK);
    expect(original.status).toBe("closed");

    await shot(marta.page, "ask-again-fresh-ask");
    await marta.context.close();
  });

  test("another volunteer cannot open the closure", async ({ browser }) => {
    const sara = await signIn(browser, seedAccessTokens.sara);
    const response = await sara.page.goto(`/claim/${slotId}/close`);
    expect(response?.status()).toBe(404);
    await expect(sara.page.getByTestId("closure-panel")).toHaveCount(0);
    await sara.context.close();
  });
});

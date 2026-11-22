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
 * VAL-DESK-004, VAL-DESK-005, and VAL-DESK-006 on the real surface.
 *
 * Grace approves a hero ask: the companion draft becomes an open time on the
 * board with a visible "Approved — Grace, time" line; the held home draft stays
 * unpublished with its reason and can only be published after the hold is
 * resolved. A separate ask is sent back with a note, publishes nothing, and
 * shows that note to its caregiver exactly as written. Before approval, no ask
 * or draft appears in a volunteer or board payload.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.\n\nShe loves hymns and tea, and she naps after lunch.";

const MEAL_ASK =
  "Could someone bring a meal on Saturday? She can reheat it later. Nothing else is needed.";

const PRIYA_ASK =
  "I haven't had a Saturday morning to myself since March. Dad is fine with people he knows, he just can't be alone.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "approve-publish",
);

type SlotRow = {
  id: string;
  kind: string;
  status: string;
  approved_by: string | null;
  approved_at: Date | null;
  hold_reason: string | null;
  label: string;
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
    // Construction adds round trips to a cold Neon compute.
    timeout: 45_000,
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { askId: string };
  return body.askId;
}

async function slotsFor(db: E2eDatabase, askId: string): Promise<SlotRow[]> {
  return db.client<SlotRow[]>`
    SELECT id, kind, status, approved_by, approved_at, hold_reason, label
      FROM slot
     WHERE ask_id = ${askId}
     ORDER BY kind
  `;
}

async function askStatus(db: E2eDatabase, askId: string): Promise<string> {
  const [row] = await db.client<{ status: string }[]>`
    SELECT status FROM ask WHERE id = ${askId}
  `;
  return row.status;
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

test.describe.configure({ timeout: 180_000 });

test.describe("approve, publish, and send back", () => {
  let db: E2eDatabase;
  const createdAskIds: string[] = [];

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    // The browser suite shares one database. Remove the times this spec
    // published so later specs do not inherit a board full of test slots.
    // Ask rows are immutable-by-trigger and stay behind, but they are no longer
    // waiting and carry no published slot.
    for (const askId of createdAskIds) {
      await db.client`
        DELETE FROM slot_candidate
         WHERE slot_id IN (SELECT id FROM slot WHERE ask_id = ${askId})
      `;
      await db.client`DELETE FROM slot WHERE ask_id = ${askId}`;
    }
    await db.client.end();
  });

  test("approving publishes the non-held draft, keeps the held one, and shows the approval line on the board", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    const askId = await createAsk(marta.context, HERO_ASK);
    createdAskIds.push(askId);
    await marta.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    const deskResponse = await grace.page.goto(`/desk/ask/${askId}`);
    expect(deskResponse?.status()).toBe(200);
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(2);

    const homeCard = grace.page.locator(
      '[data-testid="draft-slot"][data-kind="home"]',
    );
    await homeCard
      .getByTestId("draft-hold-reason")
      .fill("Check with the family about the stairs first.");
    await homeCard.getByTestId("draft-hold-submit").click();
    await expect(homeCard).toHaveAttribute("data-held", "true", {
      timeout: 20_000,
    });

    await expect(grace.page.getByTestId("approval-counts")).toContainText(
      "Ready to publish: 1. Held: 1.",
    );
    await shot(grace.page, "desk-before-approval");

    await grace.page.getByTestId("approve-ask").click();
    await expect(grace.page.getByTestId("ask-review")).toHaveAttribute(
      "data-status",
      "approved",
      { timeout: 30_000 },
    );
    await expect(grace.page.getByTestId("published-slot")).toHaveCount(1);
    await expect(grace.page.getByTestId("published-approval-line")).toContainText(
      "Approved — Grace",
    );
    await expect(grace.page.getByTestId("held-draft")).toHaveCount(1);
    await expect(grace.page.getByTestId("held-draft-reason")).toContainText(
      "stairs",
    );
    await shot(grace.page, "desk-after-approval");

    const rows = await slotsFor(db, askId);
    const companion = rows.find((row) => row.kind === "companion");
    const home = rows.find((row) => row.kind === "home");
    if (!companion || !home) throw new Error("expected two slots");

    expect(await askStatus(db, askId)).toBe("approved");
    expect(companion.status).toBe("open");
    expect(companion.approved_by).toBe(seedIds.people.grace);
    expect(companion.approved_at).not.toBeNull();
    expect(home.status).toBe("draft");
    expect(home.hold_reason).toMatch(/stairs/i);

    const ruth = await signIn(browser, seedAccessTokens.ruth);
    const boardResponse = await ruth.page.goto("/circle");
    expect(boardResponse?.status()).toBe(200);

    const boardCompanion = ruth.page.locator(
      `[data-testid="board-slot"][data-slot-id="${companion.id}"]`,
    );
    await expect(boardCompanion).toBeVisible();
    await expect(boardCompanion.getByTestId("board-approval-line")).toContainText(
      "Approved — Grace",
    );
    await expect(
      ruth.page.locator(`[data-testid="board-slot"][data-slot-id="${home.id}"]`),
    ).toHaveCount(0);
    await shot(ruth.page, "board-after-approval");

    // Resolve the hold and publish the second time from the approved ask.
    await grace.page.reload();
    await expect(grace.page.getByTestId("held-draft")).toHaveCount(1);
    await grace.page.getByTestId("publish-held").click();
    await expect(grace.page.getByTestId("held-draft")).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(
      grace.page.locator(
        `[data-testid="published-slot"][data-slot-id="${home.id}"]`,
      ),
    ).toHaveCount(1);

    await ruth.page.reload();
    const boardHome = ruth.page.locator(
      `[data-testid="board-slot"][data-slot-id="${home.id}"]`,
    );
    await expect(boardHome).toBeVisible();
    await expect(boardHome.getByTestId("board-approval-line")).toContainText(
      "Approved — Grace",
    );
    await shot(ruth.page, "board-after-held-published");

    const afterHold = await slotsFor(db, askId);
    const publishedHome = afterHold.find((row) => row.id === home.id);
    expect(publishedHome?.status).toBe("open");
    expect(publishedHome?.hold_reason).toBeNull();

    const audit = await db.client<{ action: string; actor_id: string | null }[]>`
      SELECT action, actor_id
        FROM audit_event
       WHERE entity_id = ${askId} OR entity_id = ${home.id}
       ORDER BY created_at
    `;
    expect(audit.map((row) => row.action)).toContain("ask_approved");
    expect(audit.map((row) => row.action)).toContain("slot_published");
    expect(audit.map((row) => row.action)).toContain(
      "draft_slot_hold_resolved",
    );
    expect(
      audit
        .filter((row) => row.action === "ask_approved")
        .every((row) => row.actor_id === seedIds.people.grace),
    ).toBe(true);

    await grace.context.close();
    await ruth.context.close();
  });

  test("sending back requires a note, publishes nothing, and shows the note to its caregiver", async ({
    browser,
  }) => {
    const david = await signIn(browser, seedAccessTokens.david);
    const askId = await createAsk(david.context, MEAL_ASK);
    createdAskIds.push(askId);
    await david.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    const response = await grace.page.goto(`/desk/ask/${askId}`);
    expect(response?.status()).toBe(200);

    // An empty note is refused on the real form and nothing changes.
    await grace.page.getByTestId("send-back-note").fill("   \n\t ");
    await grace.page.getByTestId("send-back-submit").click();
    const noteError = grace.page.getByTestId("send-back-feedback");
    await expect(noteError).toHaveAttribute("role", "alert");
    await expect(noteError).toContainText("Write a short note");
    expect(await askStatus(db, askId)).toBe("waiting_coordinator");

    const note =
      "  Thank you for writing this down.\n\nI read it twice. Nothing is arranged yet — please call me on Thursday and we will look at the week together.  ";

    await grace.page.getByTestId("send-back-note").fill(note);
    await grace.page.getByTestId("send-back-submit").click();
    await expect(grace.page.getByTestId("ask-review")).toHaveAttribute(
      "data-status",
      "sent_back",
      { timeout: 30_000 },
    );
    // textContent, not toHaveText: Playwright's text assertion normalises
    // whitespace, and this note must be exactly what was written.
    expect(await grace.page.getByTestId("send-back-copy").textContent()).toBe(
      note,
    );
    await shot(grace.page, "desk-sent-back");

    const [askRow] = await db.client<
      {
        status: string;
        send_back_note: string | null;
        sent_back_by: string | null;
        sent_back_at: Date | null;
      }[]
    >`
      SELECT status, send_back_note, sent_back_by, sent_back_at
        FROM ask
       WHERE id = ${askId}
    `;
    expect(askRow.status).toBe("sent_back");
    // The platform's CRLF form encoding was normalised once at the boundary;
    // everything the writer typed, including leading and trailing spaces, is
    // stored unchanged.
    expect(askRow.send_back_note).toBe(note);
    expect(askRow.send_back_note?.startsWith("  ")).toBe(true);
    expect(askRow.send_back_note?.endsWith("  ")).toBe(true);
    expect(askRow.sent_back_by).toBe(seedIds.people.grace);
    expect(askRow.sent_back_at).not.toBeNull();

    const slots = await slotsFor(db, askId);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((slot) => slot.status === "draft")).toBe(true);

    const [published] = await db.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
        FROM slot
       WHERE ask_id = ${askId}
         AND status IN ('open', 'claimed', 'covered')
    `;
    expect(published.count).toBe(0);

    // The caregiver reads the same bytes on the receipt and on /care.
    const marta = await signIn(browser, seedAccessTokens.marta);
    const receipt = await marta.page.goto(`/ask/${askId}`);
    expect(receipt?.status()).toBe(404);
    await marta.context.close();

    const davidAgain = await signIn(browser, seedAccessTokens.david);
    const ownReceipt = await davidAgain.page.goto(`/ask/${askId}`);
    expect(ownReceipt?.status()).toBe(200);
    const receiptNote = davidAgain.page.getByTestId("send-back-note-body");
    await expect(receiptNote).toBeVisible();
    expect(await receiptNote.textContent()).toBe(note);
    await shot(davidAgain.page, "caregiver-send-back-receipt");

    const care = await davidAgain.page.goto("/care");
    expect(care?.status()).toBe(200);
    const careNote = davidAgain.page
      .locator(`[data-testid="care-note"][data-ask-id="${askId}"]`)
      .getByTestId("care-note-body");
    await expect(careNote).toBeVisible();
    expect(await careNote.textContent()).toBe(note);
    await shot(davidAgain.page, "caregiver-care-note");
    await davidAgain.context.close();

    // A volunteer and the board never see the note or the family's words.
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    const raw = await ruth.context.request.get("/circle");
    expect(raw.status()).toBe(200);
    const html = await raw.text();
    expect(html).not.toContain("I read it twice");
    expect(html).not.toContain("Nothing is arranged yet");
    expect(html).not.toContain(MEAL_ASK);
    for (const slot of slots) {
      await expect(
        ruth.page.locator(`[data-testid="board-slot"][data-slot-id="${slot.id}"]`),
      ).toHaveCount(0);
    }
    await ruth.context.close();
    await grace.context.close();
  });

  test("keeps a waiting ask and its drafts out of every volunteer and board payload", async ({
    browser,
  }) => {
    const priya = await signIn(browser, seedAccessTokens.priya);
    const askId = await createAsk(priya.context, PRIYA_ASK);
    createdAskIds.push(askId);
    await priya.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    const desk = await grace.page.goto(`/desk/ask/${askId}`);
    expect(desk?.status()).toBe(200);
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(2);
    await shot(grace.page, "desk-before-any-approval");

    const slots = await slotsFor(db, askId);
    expect(slots.every((slot) => slot.status === "draft")).toBe(true);

    const ruth = await signIn(browser, seedAccessTokens.ruth);
    for (const route of ["/circle", "/my-claims"]) {
      const response = await ruth.page.goto(route);
      expect(response?.status()).toBe(200);

      const body = await ruth.page.locator("body").innerText();
      expect(body).not.toContain(PRIYA_ASK);
      expect(body).not.toContain("Mr. Rao");
      for (const slot of slots) {
        expect(body).not.toContain(slot.id);
      }

      const raw = await ruth.context.request.get(route);
      expect(raw.status()).toBe(200);
      const html = await raw.text();
      expect(html).not.toContain(PRIYA_ASK);
      for (const slot of slots) {
        expect(html).not.toContain(slot.id);
      }
    }

    // Explicitly: the board has no card for any of these drafts.
    for (const slot of slots) {
      await expect(
        ruth.page.locator(`[data-testid="board-slot"][data-slot-id="${slot.id}"]`),
      ).toHaveCount(0);
    }
    await shot(ruth.page, "board-before-any-approval");
    await ruth.context.close();

    // Fixture cleanup: take the ask out of the waiting queue without publishing.
    // The ask trigger permits a status change; the words are untouched.
    await db.client`
      UPDATE ask
         SET status = 'sent_back',
             send_back_note = 'Test cleanup — this ask was never approved.',
             sent_back_by = ${seedIds.people.grace},
             sent_back_at = now()
       WHERE id = ${askId}
    `;
    expect(await askStatus(db, askId)).toBe("sent_back");
    await grace.context.close();
  });
});

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
 * VAL-CLAIM-005, VAL-CLAIM-006, VAL-ACCESS-004, and VAL-CROSS-004 on the real
 * surface.
 *
 * A real caregiver ask is approved by Grace, Ruth claims a companion time and a
 * home visit, and a second real ask is left waiting with its draft slots in the
 * database. The volunteer's list shows only her own claims and none of those
 * drafts. The orientation note is absent from every page she can fetch until the
 * coordinator approves the claim, then appears for her alone: another volunteer,
 * a caregiver, a coordinator, and an anonymous request all get no note.
 *
 * The home visit proves check-in, check-out, and done as real browser actions
 * with append-only audit rows.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

const WAITING_TEXT =
  "My father needs someone to sit with him on Saturday while I go to an appointment. He knows Ruth from church.";

const NOTE_CANARY =
  "ORIENTATION CANARY: the blue teapot is in the second cupboard, and Elena takes her tea weak.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "my-claims",
);

type SlotRow = {
  id: string;
  kind: string;
  status: string;
  claimed_by: string | null;
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
    SELECT id, kind, status, claimed_by
      FROM slot
     WHERE ask_id = ${askId}
     ORDER BY kind
  `;
}

async function auditActions(
  db: E2eDatabase,
  slotId: string,
): Promise<string[]> {
  const rows = await db.client<Array<{ action: string }>>`
    SELECT action
      FROM audit_event
     WHERE entity = 'slot'
       AND entity_id = ${slotId}
       AND action IN ('slot_checked_in', 'slot_checked_out', 'slot_done')
     ORDER BY created_at
  `;
  return rows.map((row) => row.action);
}

test.describe.configure({ timeout: 300_000 });

test.describe.serial("a volunteer's own claims", () => {
  let db: E2eDatabase;
  const createdAskIds: string[] = [];
  let mainAskId: string;
  let waitingAskId: string;
  let companionId: string;
  let homeId: string;
  let waitingSlotIds: string[] = [];
  let saraSlotId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    db = await openE2eDatabase();

    // A real caregiver ask, constructed by plain code and published by Grace.
    const marta = await signIn(browser, seedAccessTokens.marta);
    const created = await marta.context.request.post("/api/asks", {
      data: { text: HERO_ASK, consent: true },
      timeout: 45_000,
    });
    expect(created.status()).toBe(201);
    mainAskId = ((await created.json()) as { askId: string }).askId;
    createdAskIds.push(mainAskId);
    await marta.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    const desk = await grace.page.goto(`/desk/ask/${mainAskId}`);
    expect(desk?.status()).toBe(200);
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(2);
    await grace.page.getByTestId("approve-ask").click();
    await expect(grace.page.getByTestId("ask-review")).toHaveAttribute(
      "data-status",
      "approved",
      { timeout: 30_000 },
    );
    await grace.context.close();

    const rows = await slotsFor(db, mainAskId);
    const companion = rows.find((row) => row.kind === "companion");
    const home = rows.find((row) => row.kind === "home");
    if (!companion || !home) throw new Error("expected companion and home");
    companionId = companion.id;
    homeId = home.id;

    // The coordinator's own note, with a canary only this test knows.
    await db.client`
      UPDATE slot SET orientation_note = ${NOTE_CANARY}
       WHERE id = ${companionId} OR id = ${homeId}
    `;

    // Ruth says yes to both times through the real claim route.
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    for (const slotId of [companionId, homeId]) {
      const claimed = await ruth.context.request.post(
        `/api/slots/${slotId}/claim`,
        { headers: { accept: "application/json" } },
      );
      expect(claimed.status()).toBe(200);
    }
    await ruth.context.close();

    // Grace confirms the home claim through the real desk action, then the
    // fixture moves its window into the past so the done action is due.
    const graceHome = await signIn(browser, seedAccessTokens.grace);
    await graceHome.page.goto(`/desk/slot/${homeId}`);
    await expect(graceHome.page.getByTestId("claim-review")).toHaveAttribute(
      "data-status",
      "claimed",
    );
    await graceHome.page.getByTestId("approve-claim").click();
    await expect(graceHome.page.getByTestId("claim-review")).toHaveAttribute(
      "data-status",
      "covered",
      { timeout: 30_000 },
    );
    await graceHome.context.close();

    await db.client`
      UPDATE slot
         SET window_start = ${"2026-11-14T15:00:00.000Z"}::timestamptz,
             window_end = ${"2026-11-14T17:00:00.000Z"}::timestamptz
       WHERE id = ${homeId}
    `;

    // Another volunteer's own claim, so "only your claims" has a real
    // counterexample.
    saraSlotId = crypto.randomUUID();
    await db.client`
      INSERT INTO slot (
        id, ask_id, church_id, kind, tier, label, gated,
        window_start, window_end, status, approved_by, approved_at,
        claimed_by, claimed_at
      )
      VALUES (
        ${saraSlotId},
        ${mainAskId},
        ${seedIds.church},
        'meal',
        'doorstep',
        'A meal for a neighbour',
        false,
        ${"2026-11-28T17:00:00.000Z"}::timestamptz,
        ${"2026-11-28T18:00:00.000Z"}::timestamptz,
        'claimed',
        ${seedIds.people.grace},
        ${"2026-11-17T15:00:00.000Z"}::timestamptz,
        ${seedIds.people.sara},
        ${"2026-11-18T15:00:00.000Z"}::timestamptz
      )
    `;

    // A real waiting ask: its draft slots exist in the database while Ruth's
    // page is the thing we inspect.
    const priya = await signIn(browser, seedAccessTokens.priya);
    const waiting = await priya.context.request.post("/api/asks", {
      data: { text: WAITING_TEXT, consent: true },
      timeout: 45_000,
    });
    expect(waiting.status()).toBe(201);
    waitingAskId = ((await waiting.json()) as { askId: string }).askId;
    createdAskIds.push(waitingAskId);
    await priya.context.close();

    const waitingSlots = await slotsFor(db, waitingAskId);
    expect(waitingSlots.length).toBeGreaterThan(0);
    expect(waitingSlots.every((row) => row.status === "draft")).toBe(true);
    waitingSlotIds = waitingSlots.map((row) => row.id);
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
    // Ask rows are append-only and the suite truncates this database at the
    // start of every run.
    await db.client.end();
  });

  test("shows only Ruth's claims and none of a real waiting ask's drafts", async ({
    browser,
  }) => {
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    await ruth.page.goto("/my-claims");

    const claims = ruth.page.getByTestId("my-claim");
    await expect(claims).toHaveCount(2);

    const companion = ruth.page.locator(
      `[data-testid="my-claim"][data-slot-id="${companionId}"]`,
    );
    const home = ruth.page.locator(
      `[data-testid="my-claim"][data-slot-id="${homeId}"]`,
    );
    await expect(companion).toHaveAttribute("data-status", "claimed");
    await expect(companion.getByTestId("my-claim-status")).toHaveText(
      "Claimed — waiting for Grace",
    );
    await expect(home).toHaveAttribute("data-status", "covered");
    await expect(home.getByTestId("my-claim-status")).toHaveText(
      "Covered — Grace confirmed it",
    );
    await expect(companion.getByTestId("my-claim-window")).toContainText(
      /Tuesday/,
    );
    await expect(companion.getByTestId("my-claim-location")).toContainText(
      /church hall/i,
    );

    // The other volunteer's claim is nowhere on Ruth's page.
    await expect(
      ruth.page.locator(
        `[data-testid="my-claim"][data-slot-id="${saraSlotId}"]`,
      ),
    ).toHaveCount(0);

    const html = await ruth.page.content();
    for (const forbidden of [
      ...waitingSlotIds,
      saraSlotId,
      "My father needs someone",
      "appointment",
      NOTE_CANARY,
      "Elena",
      "hymns and tea",
      "since March",
    ]) {
      expect(html).not.toContain(forbidden);
    }
    // The list is genuinely populated, so the absences are not an empty page.
    expect(html).toContain(companionId);
    expect(html).toContain(homeId);

    await shot(ruth.page, "claims-list-only-own");
    await ruth.context.close();
  });

  test("withholds the orientation note before the coordinator approves", async ({
    browser,
  }) => {
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    const response = await ruth.page.goto(`/my-claims/${companionId}`);
    expect(response?.status()).toBe(200);

    await expect(ruth.page.getByTestId("claim-detail")).toHaveAttribute(
      "data-status",
      "claimed",
    );
    await expect(ruth.page.getByTestId("claim-window")).toContainText(
      /Tuesday/,
    );
    await expect(ruth.page.getByTestId("claim-location")).toContainText(
      /church hall/i,
    );
    await expect(ruth.page.getByTestId("claim-expect")).toBeVisible();
    await expect(ruth.page.getByTestId("claim-note-pending")).toBeVisible();
    await expect(ruth.page.getByTestId("claim-note-pending")).toContainText(
      /orientation note/i,
    );
    await expect(ruth.page.getByTestId("claim-note")).toHaveCount(0);

    // The note is absent from the visible page and from the whole payload.
    const html = await ruth.page.content();
    for (const forbidden of [
      NOTE_CANARY,
      "Elena",
      "hymns and tea",
      "since March",
      "My father needs someone",
    ]) {
      expect(html).not.toContain(forbidden);
    }
    expect(html).not.toContain("blue teapot");

    await shot(ruth.page, "before-approval-note-absent");
    await ruth.context.close();
  });

  test("reveals the note to the claimer alone after approval", async ({
    browser,
  }) => {
    // The coordinator approval is the real action, not a SQL fixture.
    const graceApproves = await signIn(browser, seedAccessTokens.grace);
    await graceApproves.page.goto(`/desk/slot/${companionId}`);
    await expect(
      graceApproves.page.getByTestId("claim-review"),
    ).toHaveAttribute("data-status", "claimed");
    await graceApproves.page.getByTestId("approve-claim").click();
    await expect(
      graceApproves.page.getByTestId("claim-review"),
    ).toHaveAttribute("data-status", "covered", { timeout: 30_000 });
    await expect(
      graceApproves.page.getByTestId("confirmation-body"),
    ).toContainText("Ruth");
    await graceApproves.context.close();

    const ruth = await signIn(browser, seedAccessTokens.ruth);
    const response = await ruth.page.goto(`/my-claims/${companionId}`);
    expect(response?.status()).toBe(200);
    await expect(ruth.page.getByTestId("claim-detail")).toHaveAttribute(
      "data-status",
      "covered",
    );
    await expect(ruth.page.getByTestId("claim-status")).toHaveText(
      "Covered — Grace confirmed it",
    );
    await expect(ruth.page.getByTestId("claim-note")).toHaveText(NOTE_CANARY);
    await expect(ruth.page.getByTestId("claim-note-pending")).toHaveCount(0);
    await shot(ruth.page, "after-approval-note-visible");

    // The list still never carries the note, even now that it is readable.
    await ruth.page.goto("/my-claims");
    const listHtml = await ruth.page.content();
    expect(listHtml).not.toContain(NOTE_CANARY);
    expect(listHtml).not.toContain("Elena");
    await ruth.context.close();

    // Another volunteer, by changing the id: 404 and no note.
    const sara = await signIn(browser, seedAccessTokens.sara);
    const saraResponse = await sara.page.goto(`/my-claims/${companionId}`);
    expect(saraResponse?.status()).toBe(404);
    const saraHtml = await sara.page.content();
    expect(saraHtml).not.toContain(NOTE_CANARY);
    expect(saraHtml).not.toContain("Elena");

    await sara.page.goto("/my-claims");
    const saraList = await sara.page.content();
    expect(saraList).not.toContain(companionId);
    expect(saraList).not.toContain(NOTE_CANARY);
    // Sara sees her own claim, so the list is not simply blank.
    expect(saraList).toContain(saraSlotId);
    await sara.context.close();

    // A caregiver not party to the slot.
    const marta = await signIn(browser, seedAccessTokens.marta);
    const martaResponse = await marta.page.goto(`/my-claims/${companionId}`);
    expect(martaResponse?.status()).toBe(403);
    expect(await marta.page.content()).not.toContain(NOTE_CANARY);
    await marta.context.close();

    // A coordinator is refused this volunteer-only surface.
    const grace = await signIn(browser, seedAccessTokens.grace);
    const graceResponse = await grace.page.goto("/my-claims");
    expect(graceResponse?.status()).toBe(403);
    expect(await grace.page.content()).not.toContain(NOTE_CANARY);
    await grace.context.close();

    // No session at all: the entry page, no note.
    const anonymousContext = await browser.newContext();
    const anonymous = await anonymousContext.newPage();
    await anonymous.goto(`/my-claims/${companionId}`);
    await expect(anonymous).toHaveURL(/\/enter/);
    expect(await anonymous.content()).not.toContain(NOTE_CANARY);
    expect(await anonymous.content()).not.toContain("Elena");
    await anonymousContext.close();
  });

  test("checks a home visit in and out and records both", async ({ browser }) => {
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    await ruth.page.goto(`/my-claims/${homeId}`);

    await expect(ruth.page.getByTestId("claim-visit")).toBeVisible();
    await expect(ruth.page.getByTestId("claim-check-in-form")).toBeVisible();

    const checkInPosted = ruth.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/slots/${homeId}/visit`) &&
        response.request().method() === "POST",
    );
    await ruth.page.getByRole("button", { name: "Check in" }).click();
    expect([303, 200]).toContain((await checkInPosted).status());
    await ruth.page.waitForURL(/visit=checked_in/, { timeout: 20_000 });
    await expect(ruth.page.getByTestId("claim-flash")).toContainText(
      /checked in/i,
    );
    await expect(ruth.page.getByTestId("claim-checked-in")).toBeVisible();
    expect(await auditActions(db, homeId)).toEqual(["slot_checked_in"]);

    const checkOutPosted = ruth.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/slots/${homeId}/visit`) &&
        response.request().method() === "POST",
    );
    await ruth.page.getByRole("button", { name: "Check out" }).click();
    expect([303, 200]).toContain((await checkOutPosted).status());
    await ruth.page.waitForURL(/visit=checked_out/, { timeout: 20_000 });
    await expect(ruth.page.getByTestId("claim-flash")).toContainText(
      /checked out/i,
    );
    await expect(ruth.page.getByTestId("claim-checked-out")).toBeVisible();
    expect(await auditActions(db, homeId)).toEqual([
      "slot_checked_in",
      "slot_checked_out",
    ]);

    await shot(ruth.page, "home-visit-checked-out");
    await ruth.context.close();
  });

  test("offers done after the time has passed and closes the claim", async ({
    browser,
  }) => {
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    await ruth.page.goto(`/my-claims/${homeId}`);

    await expect(ruth.page.getByTestId("claim-done-form")).toBeVisible();
    const donePosted = ruth.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/slots/${homeId}/done`) &&
        response.request().method() === "POST",
    );
    await ruth.page.getByRole("button", { name: "Mark this done" }).click();
    expect([303, 200]).toContain((await donePosted).status());
    await ruth.page.waitForURL(/done=done/, { timeout: 20_000 });
    await expect(ruth.page.getByTestId("claim-flash")).toContainText(
      /marked done/i,
    );
    await expect(ruth.page.getByTestId("claim-status")).toHaveText(
      "Done — thank you",
    );
    await expect(ruth.page.getByTestId("claim-done-form")).toHaveCount(0);

    const [row] = await db.client<Array<{ status: string }>>`
      SELECT status FROM slot WHERE id = ${homeId}
    `;
    expect(row.status).toBe("done");
    expect(await auditActions(db, homeId)).toContain("slot_done");

    await shot(ruth.page, "claim-done");
    await ruth.context.close();
  });

  test("the empty list names the next human action", async ({ browser }) => {
    const ben = await signIn(browser, seedAccessTokens.ben);
    await ben.page.goto("/my-claims");

    const empty = ben.page.getByTestId("my-claims-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(/nothing claimed yet/i);
    await expect(empty).toContainText(/Grace/);
    const link = empty.getByRole("link", { name: /see the times you can take/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/circle");

    await shot(ben.page, "claims-empty-names-next-action");
    await ben.context.close();
  });
});

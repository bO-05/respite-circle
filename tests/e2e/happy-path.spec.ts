import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { seedAccessTokens, seedIds } from "../../src/db/seed-data";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";
import { E2E_RESET_PATH, E2E_RESET_TOKEN } from "./helpers/e2e-env";

/**
 * The happy path, as its own flow: a caregiver asks, Grace approves, a
 * neighbour claims, Grace confirms, the family sees one human sentence, and
 * Ruth closes the loop when the visit is done.
 *
 * `claim-approval.spec.ts` and `closure.spec.ts` test the individual contracts
 * with their own fixtures. This spec walks the whole path end to end on the
 * demo-ready database, from the caregiver's first sentence to the closed ask,
 * so the suite has one green flow a reader can follow. The failure path lives
 * next door in `failure-path.spec.ts`.
 */

const ASK =
  "I haven't had a Saturday morning to myself since March. Mum can't be alone for long, and she loves hymns and tea.";

const RECEIPT_URL =
  /\/ask\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

async function reset(request: APIRequestContext): Promise<void> {
  const response = await request.post(E2E_RESET_PATH, {
    headers: { "x-demo-reset-token": E2E_RESET_TOKEN },
    failOnStatusCode: false,
    timeout: 90_000,
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).reset).toBe(true);
}

test.describe.configure({ timeout: 240_000 });

test.describe("VAL-CROSS-001 — the happy path", () => {
  let db: E2eDatabase;
  let askId: string | null = null;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    if (askId) {
      await db.client`
        DELETE FROM notification WHERE slot_id IN (SELECT id FROM slot WHERE ask_id = ${askId})
      `;
      await db.client`
        DELETE FROM slot_candidate WHERE slot_id IN (SELECT id FROM slot WHERE ask_id = ${askId})
      `;
      await db.client`DELETE FROM call_log WHERE slot_id IN (SELECT id FROM slot WHERE ask_id = ${askId})`;
      await db.client`DELETE FROM absence_proof WHERE slot_id IN (SELECT id FROM slot WHERE ask_id = ${askId})`;
      await db.client`DELETE FROM slot WHERE ask_id = ${askId}`;
    }
    await db.client.end();
  });

  test("VAL-CROSS-001 — one ask travels from Marta to Grace to Ruth and back", async ({
    browser,
    request,
  }) => {
    await reset(request);

    // 1. Marta asks, in her own words.
    const marta = await signIn(browser, seedAccessTokens.marta);
    await expect(marta.page).toHaveURL(/\/ask$/);
    await marta.page
      .getByLabel(/tell us what a hard week looks like/i)
      .fill(ASK);
    await marta.page
      .getByLabel(/i agree that the church may keep these words/i)
      .check();
    await marta.page
      .getByRole("button", { name: /send this to/i })
      .click();
    await marta.page.waitForURL(RECEIPT_URL, { timeout: 60_000 });
    askId = marta.page.url().split("/").at(-1) as string;

    await expect(marta.page.getByTestId("ask-status")).toContainText(
      /with Grace — not read yet/i,
    );
    await expect(marta.page.getByTestId("caregiver-verbatim")).toHaveText(ASK);

    // 2. Grace reads it and approves it. The single companion place is
    // published to the congregation board.
    const grace = await signIn(browser, seedAccessTokens.grace);
    const review = await grace.page.goto(`/desk/ask/${askId}`);
    expect(review?.status()).toBe(200);
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(1);
    await grace.page.getByTestId("approve-ask").click();
    await expect(grace.page.getByTestId("ask-review")).toHaveAttribute(
      "data-status",
      "approved",
      { timeout: 30_000 },
    );

    const [slot] = await db.client<
      Array<{ id: string; kind: string; status: string; approved_at: Date | null }>
    >`
      SELECT id, kind, status, approved_at FROM slot WHERE ask_id = ${askId}
    `;
    expect(slot.kind).toBe("companion");
    expect(slot.status).toBe("open");
    expect(slot.approved_at).not.toBeNull();

    // 3. Ruth sees the place on the board and claims it.
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    await ruth.page.goto("/circle");
    const card = ruth.page.locator(
      `[data-testid="board-slot"][data-slot-id="${slot.id}"]`,
    );
    await expect(card).toBeVisible();
    const posted = ruth.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/slots/${slot.id}/claim`) &&
        response.request().method() === "POST",
    );
    await card.getByRole("button", { name: "Claim this time" }).click();
    expect([200, 303]).toContain((await posted).status());
    await ruth.page.waitForURL(/\/circle\?claim=claimed/, { timeout: 30_000 });
    await expect(ruth.page.getByTestId("claim-banner")).toContainText(
      /thank you for saying yes/i,
    );

    const [claimed] = await db.client<Array<{ claimed_by: string | null }>>`
      SELECT claimed_by FROM slot WHERE id = ${slot.id}
    `;
    expect(claimed.claimed_by).toBe(seedIds.people.ruth);

    // 4. Grace confirms the claim. That is the only message the family gets.
    await grace.page.goto(`/desk/slot/${slot.id}`);
    await expect(grace.page.getByTestId("claim-review")).toHaveAttribute(
      "data-status",
      "claimed",
    );
    await grace.page.getByTestId("approve-claim").click();
    await expect(grace.page.getByTestId("claim-review")).toHaveAttribute(
      "data-status",
      "covered",
      { timeout: 30_000 },
    );
    await expect(grace.page.getByTestId("confirmation-body")).not.toBeEmpty();

    const [notification] = await db.client<
      Array<{ kind: string; body: string }>
    >`
      SELECT kind, body FROM notification WHERE slot_id = ${slot.id}
    `;
    expect(notification.kind).toBe("confirmation");

    await marta.page.goto("/care");
    await expect(marta.page.getByTestId("care-confirmation")).toHaveCount(1);
    const confirmation = marta.page.getByTestId("care-confirmation");
    await expect(confirmation).toHaveAttribute("data-slot-id", slot.id);
    await expect(confirmation.getByTestId("care-confirmation-body")).toHaveText(
      notification.body,
    );
    await expect(confirmation).toContainText("Ruth");

    // 5. The visit happens; Ruth marks it done and the ask closes. Still no
    // new message: the confirmation is the only thing the family received.
    await db.client`
      UPDATE slot
         SET window_start = now() - interval '3 hours',
             window_end = now() - interval '1 hour'
       WHERE id = ${slot.id}
    `;
    await ruth.page.goto(`/my-claims/${slot.id}`);
    await ruth.page.getByTestId("claim-closure-link").click();
    await ruth.page.waitForURL(new RegExp(`/claim/${slot.id}/close`), {
      timeout: 30_000,
    });
    await ruth.page.getByRole("button", { name: "Mark this time done" }).click();
    await ruth.page.waitForURL(/\/close\?done=done/, { timeout: 30_000 });
    await expect(ruth.page.getByTestId("closure-status")).toHaveText(
      "Done — thank you",
    );

    const [closedAsk] = await db.client<Array<{ status: string }>>`
      SELECT status FROM ask WHERE id = ${askId}
    `;
    expect(closedAsk.status).toBe("closed");
    const notifications = await db.client<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM notification WHERE slot_id = ${slot.id}
    `;
    expect(notifications[0].count).toBe(1);

    await marta.page.goto("/care");
    await expect(marta.page.getByTestId("care-confirmation")).toHaveCount(1);
    await expect(marta.page.getByTestId("care-ask-closed")).toContainText(
      "This ask is closed. Nothing else will be sent.",
    );

    // Marta's receipt shows the closed ask and a way to begin again.
    await marta.page.goto(`/ask/${askId}`);
    await expect(marta.page.getByTestId("ask-closed")).toBeVisible();
    await expect(marta.page.getByTestId("ask-again-link")).toBeVisible();

    await marta.context.close();
    await grace.context.close();
    await ruth.context.close();
  });
});

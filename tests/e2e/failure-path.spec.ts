import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { DEMO_IDS, DEMO_TEXT } from "../../src/db/demo-state";
import { seedAccessTokens, seedIds } from "../../src/db/seed-data";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";
import { E2E_RESET_PATH, E2E_RESET_TOKEN } from "./helpers/e2e-env";

/**
 * The failure path, as its own flow: a published time nobody has taken.
 *
 * The product's promise is that this produces a person — a coordinator call —
 * not a message, a count, or a nudge to the family. The demo reset seeds one
 * such time (a hot dinner, published, past its reminder window, no candidate,
 * no notification) so the flow is walked against the same state a judge sees.
 *
 * This is deliberately separate from `happy-path.spec.ts`: a claim never
 * happens here, and the family's page never learns the time exists.
 */

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

function expectNoDeskConcepts(text: string, where: string): void {
  const forbidden: Array<[RegExp, string]> = [
    [/\bunclaimed\b/i, "unclaimed"],
    [/\bwaiting\b/i, "waiting"],
    [/\bdeclines?\b/i, "declines"],
    [/\bdeclined\b/i, "declined"],
    [/\bcount(ed|s)?\b/i, "count"],
    [/\bexpired\b/i, "expired"],
    [/places? left/i, "places left"],
    [/remaining/i, "remaining"],
    [/nobody/i, "nobody"],
    [/no one has/i, "no one has"],
  ];

  for (const [pattern, label] of forbidden) {
    expect(
      pattern.test(text),
      `${where} must not contain the desk word "${label}"`,
    ).toBe(false);
  }
}

test.describe.configure({ timeout: 180_000 });

test.describe("the failure path", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    // The call this flow records is the only write; leave the demo time as
    // the reset left it.
    await db.client`DELETE FROM call_log WHERE slot_id = ${DEMO_IDS.slotFailure}`;
    await db.client.end();
  });

  test("a time nobody has taken produces a coordinator call, never a message", async ({
    browser,
    request,
  }) => {
    await reset(request);

    // The failure path exists in the seed: published, unclaimed, past its
    // reminder window, no candidate, no notification.
    const [failure] = await db.client<
      Array<{
        status: string;
        claimed_by: string | null;
        approved_by: string | null;
        window_start: Date | string;
        reminder_hours: number;
      }>
    >`
      SELECT s.status, s.claimed_by, s.approved_by, s.window_start,
             p.reminder_window_hours AS reminder_hours
        FROM slot AS s
        JOIN ask AS a ON a.id = s.ask_id
        JOIN policy AS p ON p.id = a.policy_version_id
       WHERE s.id = ${DEMO_IDS.slotFailure}
    `;
    expect(failure.status).toBe("open");
    expect(failure.claimed_by).toBeNull();
    expect(new Date(failure.window_start).getTime() - Date.now()).toBeLessThanOrEqual(
      failure.reminder_hours * 60 * 60 * 1_000,
    );

    // Grace's coverage watch sees it as work for a person.
    const grace = await signIn(browser, seedAccessTokens.grace);
    const deskResponse = await grace.page.goto("/desk/failures");
    expect(deskResponse?.status()).toBe(200);
    const card = grace.page.locator(
      `[data-testid="coverage-card"][data-slot-id="${DEMO_IDS.slotFailure}"]`,
    );
    await expect(card).toBeVisible();
    await expect(card.getByTestId("coverage-who")).toContainText("David");
    await expect(card.getByTestId("coverage-due")).toHaveText(
      "This time needs a call now.",
    );
    await expect(card.getByTestId("coverage-due")).toHaveAttribute(
      "data-call-recorded",
      "false",
    );
    await expect(card.getByTestId("coverage-message-count")).toHaveText(
      "Messages sent to the caregiver about this slot: 0",
    );
    await expect(card.getByTestId("coverage-message-count")).toHaveAttribute(
      "data-count",
      "0",
    );

    // The family's page never learns the time exists. David's only words are
    // the coordinator's human line for his waiting ask.
    const david = await signIn(browser, seedAccessTokens.david);
    const careResponse = await david.page.goto("/care");
    expect(careResponse?.status()).toBe(200);
    await expect(david.page.getByTestId("care-covered-empty")).toBeVisible();
    await expect(david.page.getByTestId("care-confirmations")).toHaveCount(0);
    await expect(david.page.getByTestId("care-reminders")).toHaveCount(0);
    await expect(david.page.getByTestId("care-coordinator-working")).toContainText(
      /Your coordinator is working on/,
    );
    const careText = await david.page.locator("body").innerText();
    expectNoDeskConcepts(careText, "/care");
    expect(careText).not.toContain(DEMO_TEXT.failureLabel);
    const careHtml = await (await david.page.request.get("/care")).text();
    expectNoDeskConcepts(careHtml, "/care (server payload)");

    // The coordinator's answer is a human call, recorded with a person's name
    // and a note the family does not see.
    await card.getByLabel("Reached them").check();
    await card
      .getByTestId("coverage-call-note")
      .fill("Left a voicemail with David; he will call back tonight.");
    await card.getByTestId("save-coverage-call").click();
    await expect(card.getByTestId("coverage-call-feedback")).toHaveText(
      /the call is recorded/i,
    );

    const [call] = await db.client<
      Array<{
        coordinator_id: string;
        outcome: string;
        note: string | null;
      }>
    >`
      SELECT coordinator_id, outcome, note
        FROM call_log
       WHERE slot_id = ${DEMO_IDS.slotFailure}
       ORDER BY created_at DESC
       LIMIT 1
    `;
    expect(call.coordinator_id).toBe(seedIds.people.grace);
    expect(call.outcome).toBe("reached");
    expect(call.note).toContain("voicemail");

    // The call did not become a message: still zero notifications, still no
    // candidate, still open and unclaimed, and still invisible to David.
    const [notifications] = await db.client<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM notification
       WHERE slot_id = ${DEMO_IDS.slotFailure}
    `;
    expect(notifications.count).toBe(0);
    const [candidates] = await db.client<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM slot_candidate
       WHERE slot_id = ${DEMO_IDS.slotFailure}
    `;
    expect(candidates.count).toBe(0);
    const [stillOpen] = await db.client<Array<{ status: string }>>`
      SELECT status FROM slot WHERE id = ${DEMO_IDS.slotFailure}
    `;
    expect(stillOpen.status).toBe("open");

    await david.page.reload();
    await expect(david.page.getByTestId("care-confirmations")).toHaveCount(0);
    const afterText = await david.page.locator("body").innerText();
    expectNoDeskConcepts(afterText, "/care after the call");
    expect(afterText).not.toContain("voicemail");

    await grace.context.close();
    await david.context.close();
  });
});

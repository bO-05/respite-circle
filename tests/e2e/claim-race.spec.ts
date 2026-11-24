import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { DEMO_IDS } from "../../src/db/demo-state";
import { seedAccessTokens, seedIds } from "../../src/db/seed-data";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * The atomic claim over real HTTP and real sessions.
 *
 * The integration suite proves the conditional `UPDATE` with two clients; this
 * spec proves the route, the signed cookie, and the response body. Two
 * volunteers post at the same instant; exactly one wins, the other gets a 409
 * with a human sentence, and the database holds exactly one claimant.
 *
 * It races the demo board's companion place, so the next `demo-reset` restores
 * it. When this file runs alone, `afterAll` releases the claim.
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

function noSqlIn(text: string): void {
  expect(text).not.toMatch(/SQLSTATE|constraint|pg_|postgres|stack/i);
}

test.describe.configure({ timeout: 120_000 });

test.describe("VAL-CLAIM-002 — the claim race", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.beforeEach(async () => {
    // A retry must start from the same open place, not from the previous
    // attempt's winner.
    await db.client`
      UPDATE slot
         SET status = 'open', claimed_by = NULL, claimed_at = NULL
       WHERE id = ${DEMO_IDS.slotCompanion}
    `;
  });

  test.afterAll(async () => {
    await db.client`
      UPDATE slot
         SET status = 'open', claimed_by = NULL, claimed_at = NULL
       WHERE id = ${DEMO_IDS.slotCompanion}
         AND claimed_by IN (${seedIds.people.ruth}, ${seedIds.people.sara})
    `;
    await db.client.end();
  });

  test("VAL-CLAIM-002 — two parallel claims yield one win, one human 409, and one claimant", async ({
    browser,
  }) => {
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    const sara = await signIn(browser, seedAccessTokens.sara);

    const url = `/api/slots/${DEMO_IDS.slotCompanion}/claim`;
    const [first, second] = await Promise.all([
      ruth.context.request.post(url, {
        failOnStatusCode: false,
        timeout: 30_000,
      }),
      sara.context.request.post(url, {
        failOnStatusCode: false,
        timeout: 30_000,
      }),
    ]);

    expect([first.status(), second.status()].sort()).toEqual([200, 409]);

    const winner = first.status() === 200 ? first : second;
    const loser = first.status() === 409 ? first : second;
    const winnerBody = await winner.json();
    const loserText = await loser.text();
    const loserBody = JSON.parse(loserText) as {
      ok: boolean;
      code: string;
      message: string;
    };

    expect(winnerBody).toMatchObject({
      ok: true,
      code: "claimed",
      slotId: DEMO_IDS.slotCompanion,
      status: "claimed",
    });
    expect(loserBody).toMatchObject({ ok: false, code: "taken" });
    expect(loserBody.message).toMatch(/someone else just claimed this/i);
    noSqlIn(loserText);

    const [slot] = await db.client<
      Array<{ status: string; claimed_by: string | null }>
    >`
      SELECT status, claimed_by FROM slot WHERE id = ${DEMO_IDS.slotCompanion}
    `;
    expect(slot.status).toBe("claimed");
    expect([seedIds.people.ruth, seedIds.people.sara]).toContain(
      slot.claimed_by,
    );

    await ruth.context.close();
    await sara.context.close();
  });
});

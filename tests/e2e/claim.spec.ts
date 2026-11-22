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
 * VAL-CLAIM-001 through VAL-CLAIM-004 on the real surface.
 *
 * One eligible volunteer takes a published time in one action and reads a calm
 * human state. Two real sessions race the same POST and the statuses are exactly
 * one 200 and one 409 whose body is a human sentence with no SQL. A forged
 * claim by an ineligible volunteer is refused with the row unchanged. A drive is
 * refused while the church's driver policy is unsigned. Every attempt, win or
 * refusal, leaves an audit row.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "claim",
);

type SlotRow = {
  id: string;
  kind: string;
  status: string;
  claimed_by: string | null;
  claimed_at: string | null;
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
    SELECT id, kind, status, claimed_by, claimed_at
      FROM slot
     WHERE ask_id = ${askId}
     ORDER BY kind
  `;
}

test.describe.configure({ timeout: 300_000 });

test.describe.serial("the atomic claim", () => {
  let db: E2eDatabase;
  const createdAskIds: string[] = [];
  let mainAskId: string;
  let driveAskId: string;
  let companionId: string;
  let homeId: string;
  let driveId: string;

  test.beforeAll(async ({ browser }) => {
    // The fixture proves the real path: a caregiver ask, plain-code
    // construction, and Grace's approval. That is several Neon round trips on a
    // cold compute, so the hook needs the same budget as the tests.
    test.setTimeout(300_000);
    db = await openE2eDatabase();

    // A real caregiver ask, constructed by plain code and published by Grace.
    const marta = await signIn(browser, seedAccessTokens.marta);
    const created = await marta.context.request.post("/api/asks", {
      data: { text: HERO_ASK, consent: true },
      // Construction adds round trips to a cold Neon compute.
      timeout: 45_000,
    });
    expect(created.status()).toBe(201);
    const { askId } = (await created.json()) as { askId: string };
    mainAskId = askId;
    createdAskIds.push(askId);
    await marta.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    const desk = await grace.page.goto(`/desk/ask/${askId}`);
    expect(desk?.status()).toBe(200);
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(2);
    await grace.page.getByTestId("approve-ask").click();
    await expect(grace.page.getByTestId("ask-review")).toHaveAttribute(
      "data-status",
      "approved",
      { timeout: 30_000 },
    );
    await grace.context.close();

    const rows = await slotsFor(db, askId);
    const companion = rows.find((row) => row.kind === "companion");
    const home = rows.find((row) => row.kind === "home");
    if (!companion || !home) throw new Error("expected companion and home");
    expect(companion.status).toBe("open");
    expect(home.status).toBe("open");
    companionId = companion.id;
    homeId = home.id;

    // A drive time cannot be constructed while transport is disabled, so the
    // refused-drive proof inserts the row the way a signed policy would leave
    // it, then relies on the very same claim statement to refuse it.
    const driveAsk = crypto.randomUUID();
    driveAskId = driveAsk;
    driveId = crypto.randomUUID();
    await db.client`
      INSERT INTO ask (
        id, church_id, caregiver_id, care_recipient_id, verbatim_text,
        status, policy_version_id, approved_by, approved_at
      )
      VALUES (
        ${driveAskId},
        ${seedIds.church},
        ${seedIds.people.marta},
        ${seedIds.careRecipients.elena},
        'A drive fixture ask for the claim gate.',
        'approved',
        ${seedIds.policyV1},
        ${seedIds.people.grace},
        ${"2026-11-17T15:00:00.000Z"}::timestamptz
      )
    `;
    createdAskIds.push(driveAskId);
    await db.client`
      INSERT INTO slot (
        id, ask_id, church_id, kind, tier, label, gated,
        window_start, window_end, status, approved_by, approved_at
      )
      VALUES (
        ${driveId},
        ${driveAskId},
        ${seedIds.church},
        'drive',
        'transport',
        'Drive to an appointment',
        true,
        ${"2026-11-29T15:00:00.000Z"}::timestamptz,
        ${"2026-11-29T17:00:00.000Z"}::timestamptz,
        'open',
        ${seedIds.people.grace},
        ${"2026-11-17T15:00:00.000Z"}::timestamptz
      )
    `;
  });

  test.afterAll(async () => {
    for (const askId of createdAskIds) {
      await db.client`
        DELETE FROM slot_candidate
         WHERE slot_id IN (SELECT id FROM slot WHERE ask_id = ${askId})
      `;
      await db.client`DELETE FROM slot WHERE ask_id = ${askId}`;
    }
    // The asks, revisions, and decisions are left in place: decision and
    // ask_revision reference the ask, and the suite truncates this database at
    // the start of every run anyway.
    await db.client.end();
  });

  test("one eligible claim succeeds and shows the calm human state", async ({
    browser,
  }) => {
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    await ruth.page.goto("/circle");

    const card = ruth.page.locator(
      `[data-testid="board-slot"][data-slot-id="${companionId}"]`,
    );
    await expect(card).toBeVisible();

    const posted = ruth.page.waitForResponse(
      (response) =>
        response.url().includes(`/api/slots/${companionId}/claim`) &&
        response.request().method() === "POST",
    );
    await card.getByRole("button", { name: "Claim this time" }).click();
    const claimResponse = await posted;
    expect([200, 303]).toContain(claimResponse.status());

    await ruth.page.waitForURL(/\/circle\?claim=claimed/, { timeout: 20_000 });
    const banner = ruth.page.getByTestId("claim-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/thank you for saying yes/i);
    await expect(banner).toContainText(/Grace/);
    await expect(banner).toContainText(/confirm/i);

    const claimedCard = ruth.page.locator(
      `[data-testid="board-slot"][data-slot-id="${companionId}"]`,
    );
    await expect(claimedCard).toHaveAttribute("data-status", "claimed");
    await expect(claimedCard.getByTestId("board-status")).toHaveText(
      "Claimed — waiting for Grace",
    );
    await expect(claimedCard.getByTestId("board-claim")).toHaveCount(0);
    await shot(ruth.page, "claim-eligible-success");

    const [row] = (await slotsFor(db, mainAskId)).filter(
      (entry) => entry.id === companionId,
    );
    expect(row.status).toBe("claimed");
    expect(row.claimed_by).toBe(seedIds.people.ruth);
    expect(row.claimed_at).not.toBeNull();
    await ruth.context.close();
  });

  test("a forged claim by an ineligible volunteer is refused and changes nothing", async ({
    browser,
  }) => {
    // Tom has no safeguarding checklist. The board already locks the in-home
    // time for him; this test forges the POST anyway.
    const tom = await signIn(browser, seedAccessTokens.tom);
    await tom.page.goto("/circle");
    const card = tom.page.locator(
      `[data-testid="board-slot"][data-slot-id="${homeId}"]`,
    );
    await expect(card).toHaveAttribute("data-eligible", "false");
    const lock = card.getByTestId("board-lock");
    await expect(lock).toBeVisible();
    await expect(card.getByTestId("board-lock-title")).toContainText(
      /safeguarding checklist/i,
    );
    await shot(tom.page, "claim-forged-lock");

    const before = await slotsFor(db, mainAskId);
    const posted = await tom.context.request.post(
      `/api/slots/${homeId}/claim`,
      { headers: { accept: "application/json" } },
    );
    expect(posted.status()).toBe(403);
    const body = await posted.text();
    expect(body).toMatch(/safeguarding checklist/i);
    expect(body).not.toMatch(
      /SELECT|UPDATE|INSERT|SQLSTATE|postgres|pg_|constraint|at .*\.ts:\d+/i,
    );

    const after = await slotsFor(db, mainAskId);
    const beforeHome = before.find((row) => row.id === homeId);
    const afterHome = after.find((row) => row.id === homeId);
    expect(afterHome).toEqual(beforeHome);
    expect(afterHome?.status).toBe("open");
    expect(afterHome?.claimed_by).toBeNull();
    await tom.context.close();
  });

  test("two concurrent claims yield exactly one 200 and one 409 with a human message", async ({
    browser,
  }) => {
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    const sara = await signIn(browser, seedAccessTokens.sara);

    const post = (context: BrowserContext) =>
      context.request.post(`/api/slots/${homeId}/claim`, {
        headers: { accept: "application/json" },
      });

    const [first, second] = await Promise.all([
      post(ruth.context),
      post(sara.context),
    ]);
    const statuses = [first.status(), second.status()].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = first.status() === 200 ? first : second;
    const loser = first.status() === 409 ? first : second;

    const winnerBody = (await winner.json()) as {
      ok: boolean;
      status: string;
      slotId: string;
    };
    expect(winnerBody.ok).toBe(true);
    expect(winnerBody.status).toBe("claimed");
    expect(winnerBody.slotId).toBe(homeId);

    const loserBody = (await loser.json()) as {
      ok: boolean;
      code: string;
      message: string;
    };
    expect(loserBody.ok).toBe(false);
    expect(loserBody.code).toBe("taken");
    expect(loserBody.message).toBe(
      "Someone else just claimed this — thank you for saying yes.",
    );
    expect(JSON.stringify(loserBody)).not.toMatch(
      /SELECT|UPDATE|SQLSTATE|postgres|pg_|constraint|at .*\.ts:\d+/i,
    );

    const [row] = (await slotsFor(db, mainAskId)).filter(
      (entry) => entry.id === homeId,
    );
    expect(row.status).toBe("claimed");
    expect([seedIds.people.ruth, seedIds.people.sara]).toContain(
      row.claimed_by,
    );
    expect(row.claimed_at).not.toBeNull();

    // The board shows the single calm claimed state to a third volunteer.
    const ben = await signIn(browser, seedAccessTokens.ben);
    await ben.page.goto("/circle");
    const claimedCard = ben.page.locator(
      `[data-testid="board-slot"][data-slot-id="${homeId}"]`,
    );
    await expect(claimedCard).toHaveAttribute("data-status", "claimed");
    await shot(ben.page, "claim-race-claimed-board");

    await ruth.context.close();
    await sara.context.close();
    await ben.context.close();
  });

  test("a drive cannot be claimed while transport is disabled", async ({
    browser,
  }) => {
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    const posted = await ruth.context.request.post(
      `/api/slots/${driveId}/claim`,
      { headers: { accept: "application/json" } },
    );
    expect(posted.status()).toBe(403);
    const body = await posted.text();
    expect(body).toMatch(/driver policy/i);
    expect(body).not.toMatch(/SQLSTATE|postgres|constraint/i);

    const [row] = (await slotsFor(db, driveAskId)).filter(
      (entry) => entry.id === driveId,
    );
    expect(row.status).toBe("open");
    expect(row.claimed_by).toBeNull();
    await ruth.context.close();
  });

  test("every claim attempt, win or refusal, is audited", async () => {
    const rows = await db.client<
      Array<{
        action: string;
        actor_id: string | null;
        entity_id: string | null;
        detail: Record<string, unknown>;
      }>
    >`
      SELECT action, actor_id, entity_id, detail
        FROM audit_event
       WHERE action IN ('slot_claimed', 'claim_refused')
       ORDER BY created_at
    `;

    const wins = rows.filter((row) => row.action === "slot_claimed");
    const refusals = rows.filter((row) => row.action === "claim_refused");

    // The companion win and the race winner.
    expect(wins.length).toBeGreaterThanOrEqual(2);
    expect(wins.some((row) => row.entity_id === companionId)).toBe(true);
    expect(wins.some((row) => row.entity_id === homeId)).toBe(true);

    // Tom's forged in-home claim and Ruth's drive refusal.
    expect(
      refusals.some(
        (row) =>
          row.entity_id === homeId &&
          row.actor_id === seedIds.people.tom &&
          row.detail.reason === "locked",
      ),
    ).toBe(true);
    expect(
      refusals.some(
        (row) =>
          row.entity_id === driveId &&
          row.actor_id === seedIds.people.ruth &&
          row.detail.reason === "locked" &&
          row.detail.ruleCode === "no_driver_policy",
      ),
    ).toBe(true);

    // No audit detail carries a query or a stack.
    for (const row of rows) {
      const serialized = JSON.stringify(row.detail);
      expect(serialized).not.toMatch(/SELECT|SQLSTATE|constraint|at .*\.ts:\d+/i);
    }
  });
});

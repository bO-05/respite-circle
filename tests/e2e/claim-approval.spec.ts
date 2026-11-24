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
 * VAL-CONFIRM-001, VAL-CONFIRM-002 and VAL-CLAIM-007 on the real surface.
 *
 * A real caregiver ask is published by Grace, Ruth claims the companion time
 * and Sara claims the home visit. The desk sees both claims before any message
 * exists. Grace confirms Ruth's claim through the real form: the slot becomes
 * covered, its own confirmation columns record Grace and the instant, and
 * exactly one human confirmation row appears. The board's publication approval
 * is unchanged. Marta reads the one line on `/care`; it names Ruth and the
 * time and contains no model prose.
 *
 * Grace then takes Sara's unconfirmed claim back with a required reason. The
 * time returns to open, Sara's own list drops it, and the outbox for that slot
 * stays empty.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

const EXPECTED_COMPANION_BODY =
  "Tuesday is covered — Elena has a place at Respite Morning, and Ruth will be their companion.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "claim-approval",
);

type SlotStateRow = {
  status: string;
  claimed_by: string | null;
  claim_confirmed_by: string | null;
  claim_confirmed_at: string | null;
  approved_by: string | null;
  approved_at: string;
};

type NotificationRow = {
  kind: string;
  body: string;
  template_code: string;
  caregiver_id: string;
  status: string;
};

type AuditRow = {
  action: string;
  actor_id: string | null;
  detail: Record<string, unknown>;
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

async function slotState(
  db: E2eDatabase,
  slotId: string,
): Promise<SlotStateRow> {
  const [row] = await db.client<SlotStateRow[]>`
    SELECT status,
           claimed_by,
           claim_confirmed_by,
           claim_confirmed_at::text AS claim_confirmed_at,
           approved_by,
           approved_at::text AS approved_at
      FROM slot
     WHERE id = ${slotId}
  `;
  return row;
}

async function notificationsFor(
  db: E2eDatabase,
  slotId: string,
): Promise<NotificationRow[]> {
  return db.client<NotificationRow[]>`
    SELECT kind, body, template_code, caregiver_id, status
      FROM notification
     WHERE slot_id = ${slotId}
     ORDER BY created_at, id
  `;
}

async function auditFor(
  db: E2eDatabase,
  slotId: string,
  actions: string[],
): Promise<AuditRow[]> {
  return db.client<AuditRow[]>`
    SELECT action, actor_id, detail
      FROM audit_event
     WHERE entity = 'slot'
       AND entity_id = ${slotId}
       AND action = ANY(${actions})
     ORDER BY created_at
  `;
}

test.describe.configure({ timeout: 300_000 });

test.describe.serial("VAL-CONFIRM-001, VAL-CONFIRM-002 and VAL-CLAIM-007 — claim approval and the one confirmation", () => {
  let db: E2eDatabase;
  const createdAskIds: string[] = [];
  let mainAskId: string;
  let companionId: string;
  let homeId: string;
  let publicationApprovedAt: string;
  let publicationApprovedBy: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    db = await openE2eDatabase();

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

    const rows = await db.client<Array<{ id: string; kind: string }>>`
      SELECT id, kind FROM slot WHERE ask_id = ${mainAskId} ORDER BY kind
    `;
    const companion = rows.find((row) => row.kind === "companion");
    const home = rows.find((row) => row.kind === "home");
    if (!companion || !home) throw new Error("expected companion and home");
    companionId = companion.id;
    homeId = home.id;

    const published = await slotState(db, companionId);
    publicationApprovedAt = published.approved_at;
    publicationApprovedBy = published.approved_by ?? "";

    const ruth = await signIn(browser, seedAccessTokens.ruth);
    const claimed = await ruth.context.request.post(
      `/api/slots/${companionId}/claim`,
      { headers: { accept: "application/json" } },
    );
    expect(claimed.status()).toBe(200);
    await ruth.context.close();

    const sara = await signIn(browser, seedAccessTokens.sara);
    const claimedHome = await sara.context.request.post(
      `/api/slots/${homeId}/claim`,
      { headers: { accept: "application/json" } },
    );
    expect(claimedHome.status()).toBe(200);
    await sara.context.close();
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

  test("VAL-CONFIRM-001 — the desk sees both claims and no message exists yet", async ({
    browser,
  }) => {
    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto("/desk");

    await expect(grace.page.getByTestId("desk-pending-claim")).toHaveCount(2);
    const companionRow = grace.page.locator(
      `[data-testid="desk-pending-claim"][data-slot-id="${companionId}"]`,
    );
    await expect(companionRow).toContainText("Ruth");
    await expect(companionRow).toContainText(/Companion place/);

    await grace.page.goto(`/desk/slot/${companionId}`);
    await expect(grace.page.getByTestId("claim-review")).toHaveAttribute(
      "data-status",
      "claimed",
    );
    await expect(grace.page.getByTestId("claim-volunteer-name")).toContainText(
      "Ruth",
    );
    await expect(grace.page.getByTestId("approve-claim")).toBeEnabled();
    await expect(grace.page.getByTestId("revoke-claim")).toBeVisible();
    // The publication line is already there; the confirmation line is not.
    await expect(
      grace.page.getByTestId("slot-publication-line"),
    ).toContainText(/^Approved — Grace/);
    await expect(grace.page.getByTestId("claim-confirmed-line")).toHaveCount(0);

    expect(await notificationsFor(db, companionId)).toEqual([]);
    expect((await slotState(db, companionId)).status).toBe("claimed");

    await shot(grace.page, "desk-claim-before-approval");
    await grace.context.close();
  });

  test("VAL-CONFIRM-001 — confirming covers the claim and writes exactly one human confirmation", async ({
    browser,
  }) => {
    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto(`/desk/slot/${companionId}`);

    await grace.page.getByTestId("approve-claim").click();
    await expect(grace.page.getByTestId("claim-review")).toHaveAttribute(
      "data-status",
      "covered",
      { timeout: 30_000 },
    );
    await expect(grace.page.getByTestId("claim-confirmed-line")).toContainText(
      "Confirmed — Grace",
    );
    await expect(grace.page.getByTestId("confirmation-body")).toHaveText(
      EXPECTED_COMPANION_BODY,
    );
    // A confirmed time offers no second confirmation or revoke action.
    await expect(grace.page.getByTestId("approve-claim")).toHaveCount(0);
    await expect(grace.page.getByTestId("revoke-claim")).toHaveCount(0);

    const state = await slotState(db, companionId);
    expect(state.status).toBe("covered");
    expect(state.claimed_by).toBe(seedIds.people.ruth);
    expect(state.claim_confirmed_by).toBe(seedIds.people.grace);
    expect(state.claim_confirmed_at).not.toBeNull();
    // The publication trail is untouched.
    expect(state.approved_by).toBe(publicationApprovedBy);
    expect(state.approved_at).toBe(publicationApprovedAt);
    await expect(
      grace.page.getByTestId("slot-publication-line"),
    ).toContainText(/^Approved — Grace/);

    const rows = await notificationsFor(db, companionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("confirmation");
    expect(rows[0].template_code).toBe("confirmation.companion");
    expect(rows[0].body).toBe(EXPECTED_COMPANION_BODY);
    expect(rows[0].caregiver_id).toBe(seedIds.people.marta);

    const audits = await auditFor(db, companionId, ["claim_approved"]);
    expect(audits).toHaveLength(1);
    expect(audits[0].actor_id).toBe(seedIds.people.grace);
    expect(audits[0].detail).toMatchObject({
      volunteerId: seedIds.people.ruth,
      notificationCreated: true,
    });

    await shot(grace.page, "desk-claim-confirmed");
    await grace.context.close();
  });

  test("VAL-CONFIRM-002 — the caregiver reads the one human line, with Ruth and the time", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    await marta.page.goto("/care");

    await expect(marta.page.getByTestId("care-confirmation")).toHaveCount(1);
    const card = marta.page.getByTestId("care-confirmation");
    await expect(card.getByTestId("care-confirmation-body")).toHaveText(
      EXPECTED_COMPANION_BODY,
    );
    await expect(card.getByTestId("care-confirmation-when")).toContainText(
      /Tuesday/,
    );
    await expect(card).toContainText("Ruth");
    await expect(card).toContainText("Companion place at Respite Morning");

    const html = await marta.page.content();
    expect(html).toContain(EXPECTED_COMPANION_BODY);
    for (const forbidden of [
      "Ruth Kim",
      "hymns and tea",
      "since March",
      "fake-typed-v1",
      "deterministic",
      "mistral",
    ]) {
      expect(html).not.toContain(forbidden);
    }
    // No coordinator note exists in this fixture; the confirmation is the only
    // message on the page.
    await expect(marta.page.getByTestId("care-note")).toHaveCount(0);

    await shot(marta.page, "caregiver-confirmation");
    await marta.context.close();

    // Another caregiver's own page never carries this family's confirmation.
    const priya = await signIn(browser, seedAccessTokens.priya);
    await priya.page.goto("/care");
    await expect(priya.page.getByTestId("care-confirmation")).toHaveCount(0);
    expect(await priya.page.content()).not.toContain(EXPECTED_COMPANION_BODY);
    await priya.context.close();
  });

  test("VAL-CLAIM-007 — revoking requires a reason, sends nothing, and returns the time to open", async ({
    browser,
  }) => {
    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto(`/desk/slot/${homeId}`);
    await expect(grace.page.getByTestId("claim-review")).toHaveAttribute(
      "data-status",
      "claimed",
    );
    await expect(grace.page.getByTestId("claim-volunteer-name")).toContainText(
      "Sara",
    );
    expect(await notificationsFor(db, homeId)).toEqual([]);

    // The server refuses a missing reason even if the browser's own required
    // check is bypassed.
    const reason = grace.page.getByTestId("revoke-claim-reason");
    await reason.evaluate((element) => element.removeAttribute("required"));
    await grace.page.getByTestId("revoke-claim").click();
    const feedback = grace.page.getByTestId("revoke-claim-feedback");
    await expect(feedback).toBeVisible();
    await expect(feedback).toHaveAttribute("role", "alert");
    await expect(feedback).toContainText(/reason/i);
    expect((await slotState(db, homeId)).status).toBe("claimed");

    await reason.fill("Sara is unwell. We will call her.");
    await grace.page.getByTestId("revoke-claim").click();
    await expect(grace.page.getByTestId("claim-review")).toHaveAttribute(
      "data-status",
      "open",
      { timeout: 30_000 },
    );
    await expect(grace.page.getByTestId("claim-review")).toContainText(
      /No one has said yes yet/i,
    );
    await expect(grace.page.getByTestId("claim-review-empty")).toContainText(
      /call the family yourself/i,
    );

    const state = await slotState(db, homeId);
    expect(state.status).toBe("open");
    expect(state.claimed_by).toBeNull();
    expect(state.claim_confirmed_at).toBeNull();
    expect(state.approved_at).toBeTruthy();
    expect(await notificationsFor(db, homeId)).toEqual([]);

    const audits = await auditFor(db, homeId, ["claim_revoked"]);
    expect(audits).toHaveLength(1);
    expect(audits[0].actor_id).toBe(seedIds.people.grace);
    expect(audits[0].detail).toMatchObject({
      volunteerId: seedIds.people.sara,
      reason: "Sara is unwell. We will call her.",
    });

    await shot(grace.page, "desk-claim-revoked");
    await grace.context.close();

    // The volunteer's view updates: the time is no longer hers.
    const sara = await signIn(browser, seedAccessTokens.sara);
    await sara.page.goto("/my-claims");
    await expect(
      sara.page.locator(
        `[data-testid="my-claim"][data-slot-id="${homeId}"]`,
      ),
    ).toHaveCount(0);
    await sara.context.close();

    // The family still has exactly the one confirmation, and nothing about
    // the revoked home claim.
    const marta = await signIn(browser, seedAccessTokens.marta);
    await marta.page.goto("/care");
    await expect(marta.page.getByTestId("care-confirmation")).toHaveCount(1);
    const careHtml = await marta.page.content();
    expect(careHtml).not.toContain("Sara");
    expect(careHtml).not.toContain(homeId);

    await shot(marta.page, "caregiver-after-revoke");
    await marta.context.close();
  });
});

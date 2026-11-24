import { mkdir } from "node:fs/promises";
import path from "node:path";
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
 * VAL-CROSS-001 as one committed story, on the demo-ready seed.
 *
 * This is deliberately not a second copy of the feature specs beside it. It
 * walks the whole loop in the order a church would live it: Grace sends an
 * invitation from the desk, Marta opens her own link and reads those words,
 * writes a hard week in her own words, the nine typed decisions run, Grace
 * edits a draft and approves the ask, a neighbour claims the published time,
 * Grace confirms the claim, the family reads exactly one human sentence, the
 * volunteer marks the time done, and the family thanks her.
 *
 * The edit is the point of this spec. Approving proves publication; only the
 * board card proves the coordinator's edit survived the approval. The card is
 * therefore required to carry the edited label and must not carry the label
 * plain code constructed.
 *
 * The invite composer is real, not bypassed: Marta's first entry shows the
 * sentence Grace wrote, and the database keeps the row, its author, and its
 * instant.
 *
 * Runs last alphabetically so the mid-run truncation in `demo-reset.spec.ts`
 * cannot disturb the policy version any earlier spec signed.
 */

const ASK =
  "I haven't had a Saturday morning to myself since March. Mum can't be alone for long, and she loves hymns and tea.";

const INVITE_BODY =
  "Marta — there is a Tuesday morning open for Elena. Open your link when you have a quiet minute. — Grace";

/** Plain code's constructed label for a companion draft. */
const CONSTRUCTED_LABEL = "Companion place at Respite Morning";

/** What Grace changes it to before approving. */
const EDITED_LABEL = "A companion morning in the quiet room";

const THANK_YOU =
  "Thank you, Ruth. The hymns and the tea made her whole morning.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "cross-flow",
);

type SlotRow = {
  id: string;
  kind: string;
  status: string;
  label: string;
  claimed_by: string | null;
  approved_by: string | null;
};

type NotificationRow = {
  id: string;
  kind: string;
  template_code: string;
  body: string;
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

async function reset(request: APIRequestContext): Promise<void> {
  const response = await request.post(E2E_RESET_PATH, {
    headers: { "x-demo-reset-token": E2E_RESET_TOKEN },
    failOnStatusCode: false,
    timeout: 90_000,
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    reset: boolean;
    assertions: { passed: number; total: number };
  };
  expect(body.reset).toBe(true);
  expect(body.assertions.passed).toBe(12);
  expect(body.assertions.total).toBe(12);
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
    SELECT id, kind, status, label, claimed_by, approved_by
      FROM slot
     WHERE ask_id = ${askId}
     ORDER BY kind
  `;
}

async function notificationsFor(
  db: E2eDatabase,
  slotId: string,
): Promise<NotificationRow[]> {
  return db.client<NotificationRow[]>`
    SELECT id, kind, template_code, body
      FROM notification
     WHERE slot_id = ${slotId}
     ORDER BY created_at
  `;
}

test.describe.configure({ timeout: 300_000 });

test.describe("VAL-CROSS-001 — invite, ask, edit, approve, claim, confirm, done, thanks", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    await db.client.end();
  });

  test("the whole story runs as one flow on the demo-ready seed", async ({
    browser,
    request,
  }) => {
    await reset(request);

    // 1. Grace sends the invitation from the desk. It is in-app only: the
    // family reads it the first time they open their own link.
    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto("/desk/invite");
    await expect(
      grace.page.getByRole("heading", { level: 1, name: "Invite a family" }),
    ).toBeVisible();

    await grace.page
      .getByLabel(/who is this invitation for/i)
      .selectOption({ label: "Marta Alvarez — for Elena" });
    await grace.page
      .getByLabel(/the message Marta will read/i)
      .fill(INVITE_BODY);
    await shot(grace.page, "01-invite-composed");

    await grace.page.getByTestId("invite-send").click();
    await expect(grace.page.getByTestId("invite-feedback")).toContainText(
      /saved with your name and today's date/i,
    );
    await expect(
      grace.page.getByTestId("invite-sent-body").first(),
    ).toHaveText(INVITE_BODY);
    await shot(grace.page, "02-invite-sent");

    const [storedInvite] = await db.client<
      Array<{ body: string; created_by: string; seen_at: Date | null }>
    >`
      SELECT body, created_by, seen_at
        FROM invite
       WHERE caregiver_id = ${seedIds.people.marta}
       ORDER BY created_at DESC
       LIMIT 1
    `;
    expect(storedInvite?.body).toBe(INVITE_BODY);
    expect(storedInvite?.created_by).toBe(seedIds.people.grace);
    expect(storedInvite?.seen_at).toBeNull();

    // 2. Marta enters by her own access link and reads Grace's sentence on the
    // first entry. That banner is the invitation arriving, not a fixture.
    const marta = await signIn(browser, seedAccessTokens.marta);
    await expect(marta.page).toHaveURL(/\/ask$/);
    await expect(marta.page.getByTestId("ask-invite")).toBeVisible();
    await expect(marta.page.getByTestId("ask-invite-body")).toHaveText(
      INVITE_BODY,
    );
    await expect(marta.page.getByTestId("ask-invite")).toContainText(
      "Grace Whitfield",
    );
    await shot(marta.page, "03-invite-read-on-first-entry");

    // 3. She writes the hard week in her own words.
    await marta.page
      .getByLabel(/tell us what a hard week looks like/i)
      .fill(ASK);
    await marta.page
      .getByLabel(/i understand that Grace reads this first/i)
      .check();
    await marta.page.getByRole("button", { name: /send this to/i }).click();
    await marta.page.waitForURL(
      /\/ask\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      { timeout: 60_000 },
    );
    const askId = marta.page.url().split("/").at(-1) as string;

    await expect(marta.page.getByTestId("ask-status")).toContainText(
      /with Grace — not read yet/i,
    );
    await expect(marta.page.getByTestId("caregiver-verbatim")).toHaveText(ASK);

    // 4. The nine typed decisions ran, one row per fixed question. No model
    // sentence is on the trail.
    const trail = marta.page.getByTestId("decision-trail");
    await expect(trail).toBeVisible();
    await expect(marta.page.getByTestId("decision-list").locator("li"))
      .toHaveCount(9);
    for (let question = 1; question <= 9; question += 1) {
      await expect(
        marta.page.getByTestId(`decision-Q${question}`),
      ).toBeVisible();
    }
    await expect(marta.page.getByTestId("trail-digest")).toContainText(
      /[0-9a-f]{64}/,
    );
    await shot(marta.page, "04-ask-receipt-and-nine-decisions");

    const [askRow] = await db.client<
      Array<{ status: string; verbatim_text: string }>
    >`
      SELECT status, verbatim_text FROM ask WHERE id = ${askId}
    `;
    expect(askRow?.status).toBe("waiting_coordinator");
    expect(askRow?.verbatim_text).toBe(ASK);

    const [decisionCount] = await db.client<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM decision WHERE ask_id = ${askId}
    `;
    expect(decisionCount?.count).toBe(9);

    // 5. Grace edits the companion draft, then approves the ask. The edit is
    // saved before approval so the published card can only carry it if the
    // approval preserves what a person wrote.
    await grace.page.goto(`/desk/ask/${askId}`);
    await expect(grace.page.getByTestId("draft-editor")).toBeVisible();
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(1);

    const companion = grace.page.getByTestId("draft-slot").first();
    const slotId = await companion.getAttribute("data-slot-id");
    expect(slotId).toMatch(/^[0-9a-f-]{36}$/);
    if (!slotId) return;

    await expect(companion.getByTestId("draft-label")).toHaveValue(
      CONSTRUCTED_LABEL,
    );
    await shot(grace.page, "05-draft-before-edit");

    await companion.getByTestId("draft-label").fill(EDITED_LABEL);
    await companion.getByTestId("draft-save").click();
    await expect(companion.getByTestId("draft-feedback")).toHaveText(
      /Saved\. It is still a draft/,
      { timeout: 20_000 },
    );
    await shot(grace.page, "06-draft-edited");

    const [edited] = await slotsFor(db, askId);
    expect(edited?.label).toBe(EDITED_LABEL);
    expect(edited?.status).toBe("draft");

    await grace.page.getByTestId("approve-ask").click();
    await expect(grace.page.getByTestId("ask-review")).toHaveAttribute(
      "data-status",
      "approved",
      { timeout: 30_000 },
    );
    await shot(grace.page, "07-ask-approved");

    const [published] = await slotsFor(db, askId);
    expect(published?.status).toBe("open");
    expect(published?.label).toBe(EDITED_LABEL);
    expect(published?.approved_by).toBe(seedIds.people.grace);

    // 6. The edited time is what reaches the congregation board. The card must
    // carry the coordinator's words, not the label plain code constructed, so
    // a dropped edit fails this spec rather than passing on the approval alone.
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    await ruth.page.goto("/circle");
    const card = ruth.page.locator(
      `[data-testid="board-slot"][data-slot-id="${slotId}"]`,
    );
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(
      EDITED_LABEL,
    );
    await expect(card).not.toContainText(CONSTRUCTED_LABEL);
    await shot(ruth.page, "08-board-carries-the-edited-label");

    // 7. Ruth claims it through the board's real form.
    await card.getByRole("button", { name: "Claim this time" }).click();
    await ruth.page.waitForURL(/\/circle\?claim=claimed/, {
      timeout: 30_000,
    });
    await expect(ruth.page.getByTestId("claim-banner")).toContainText(
      /thank you for saying yes/i,
    );
    await shot(ruth.page, "09-ruth-claim-banner");

    const [claimed] = await slotsFor(db, askId);
    expect(claimed?.status).toBe("claimed");
    expect(claimed?.claimed_by).toBe(seedIds.people.ruth);

    // 8. Grace approves the claim. Exactly one confirmation is written.
    await grace.page.goto(`/desk/slot/${slotId}`);
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
    await shot(grace.page, "10-claim-confirmed");

    const confirmations = await notificationsFor(db, slotId);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]?.kind).toBe("confirmation");
    expect(confirmations[0]?.template_code).toBe("confirmation.companion");
    expect(confirmations[0]?.body).toContain("Ruth");

    // 9. Marta reads that one sentence on /care. It is the only message.
    await marta.page.goto("/care");
    await expect(marta.page.getByTestId("care-confirmation")).toHaveCount(1);
    const confirmation = marta.page.getByTestId("care-confirmation");
    await expect(confirmation).toHaveAttribute("data-slot-id", slotId);
    await expect(
      confirmation.getByTestId("care-confirmation-body"),
    ).toHaveText(confirmations[0]!.body);
    await expect(confirmation).toContainText("Ruth");
    await shot(marta.page, "11-marta-reads-the-confirmation");

    // 10. The visit happens. Ruth marks the time done and the ask closes.
    await db.client`
      UPDATE slot
         SET window_start = now() - interval '3 hours',
             window_end = now() - interval '1 hour'
       WHERE id = ${slotId}
    `;
    await ruth.page.goto(`/my-claims/${slotId}`);
    await ruth.page.getByTestId("claim-closure-link").click();
    await ruth.page.waitForURL(new RegExp(`/claim/${slotId}/close`), {
      timeout: 30_000,
    });
    await ruth.page.getByRole("button", { name: "Mark this time done" }).click();
    await ruth.page.waitForURL(/\/close\?done=done/, { timeout: 30_000 });
    await expect(ruth.page.getByTestId("closure-status")).toHaveText(
      "Done — thank you",
    );
    await shot(ruth.page, "12-ruth-marks-the-time-done");

    const [closedAsk] = await db.client<Array<{ status: string }>>`
      SELECT status FROM ask WHERE id = ${askId}
    `;
    expect(closedAsk?.status).toBe("closed");
    const [doneSlot] = await slotsFor(db, askId);
    expect(doneSlot?.status).toBe("done");

    // 11. Marta thanks Ruth. Nothing new is sent; the thank-you is kept for the
    // volunteer and the ask stays closed.
    await marta.page.goto("/care");
    await expect(marta.page.getByTestId("care-ask-closed")).toContainText(
      "This ask is closed. Nothing else will be sent.",
    );
    await expect(marta.page.getByTestId("care-thank-you-form")).toBeVisible();
    await marta.page
      .getByLabel(/A thank-you for Ruth \(optional\)/)
      .fill(THANK_YOU);
    await marta.page.getByTestId("care-thank-you-submit").click();
    await marta.page.waitForURL(/\/care\?thanks=added/, { timeout: 20_000 });
    await expect(marta.page.getByTestId("care-thanks-flash")).toContainText(
      /kept/i,
    );
    await expect(marta.page.getByTestId("care-thank-you-kept")).toContainText(
      THANK_YOU,
    );
    await shot(marta.page, "13-marta-thanks-ruth");

    const [thanks] = await db.client<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
        FROM audit_event
       WHERE entity = 'slot'
         AND entity_id = ${slotId}
         AND action = 'slot_thanked'
    `;
    expect(thanks?.count).toBe(1);

    // 12. The database tells the same story the screens did: the ask reached
    // closed, the family's words are byte-identical, and the only notification
    // rows in the whole church are the single confirmation for this time.
    const [finalAsk] = await db.client<
      Array<{ status: string; verbatim_text: string }>
    >`
      SELECT status, verbatim_text FROM ask WHERE id = ${askId}
    `;
    expect(finalAsk?.status).toBe("closed");
    expect(finalAsk?.verbatim_text).toBe(ASK);

    const finalNotifications = await notificationsFor(db, slotId);
    expect(finalNotifications).toHaveLength(1);
    expect(finalNotifications[0]?.kind).toBe("confirmation");

    const [noReminder] = await db.client<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
        FROM notification
       WHERE slot_id = ${slotId} AND kind = 'reminder'
    `;
    expect(noReminder?.count).toBe(0);

    const [churchTotal] = await db.client<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM notification
    `;
    expect(churchTotal?.count).toBe(1);

    await marta.context.close();
    await grace.context.close();
    await ruth.context.close();
  });
});

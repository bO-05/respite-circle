import { mkdir } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { seedAccessTokens, seedIds } from "../../src/db/seed-data";
import {
  careRecipient,
  caregiver,
  church,
  invite,
  person,
} from "../../src/db/schema";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-POLICY-007 on the real surface, both roles.
 *
 * Grace chooses Marta's family, reads the church's own sentence already in the
 * box, changes it the way she would say it, and sends it. The desk stores the
 * words with her name and the instant; no notification row is written, and the
 * page says plainly that nothing was emailed or texted. Marta opens her own
 * link for the first time and reads the same words on `/ask`; the first look is
 * recorded, and the invitation stays on `/care`. Priya, another caregiver, sees
 * none of it. A caregiver id from another church is refused by the guarded
 * write path and stores nothing.
 */

const TEMPLATE =
  "We've set up Respite Morning for Elena — would a Tuesday morning help? — Grace";

const EDITED_BODY = `${TEMPLATE}\n\nParking is by the side door, and I will meet you at 9:40.`;

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "invite-composer",
);

const FOREIGN = {
  churchId: "c6666666-6666-4666-8666-666666666661",
  coordinatorId: "a6666666-6666-4666-8666-666666666661",
  caregiverId: "a6666666-6666-4666-8666-666666666662",
  recipientId: "f6666666-6666-4666-8666-666666666661",
} as const;

type InviteRecord = typeof invite.$inferSelect;

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

async function latestInviteFor(
  db: E2eDatabase,
  caregiverId: string,
): Promise<InviteRecord | null> {
  const rows = await db.db
    .select()
    .from(invite)
    .where(eq(invite.caregiverId, caregiverId))
    .orderBy(desc(invite.createdAt), desc(invite.id))
    .limit(1);
  return rows[0] ?? null;
}

async function inviteWithBody(
  db: E2eDatabase,
  caregiverId: string,
  body: string,
): Promise<InviteRecord | null> {
  const rows = await db.db
    .select()
    .from(invite)
    .where(and(eq(invite.caregiverId, caregiverId), eq(invite.body, body)))
    .orderBy(desc(invite.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function notificationCount(db: E2eDatabase): Promise<number> {
  const rows = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM notification
  `;
  return rows[0]?.count ?? 0;
}

async function inviteCountForChurch(
  db: E2eDatabase,
  churchId: string,
): Promise<number> {
  const rows = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM invite WHERE church_id = ${churchId}
  `;
  return rows[0]?.count ?? 0;
}

async function inviteAudit(
  db: E2eDatabase,
  inviteId: string,
): Promise<Array<{ action: string; actor_id: string | null }>> {
  return db.client<Array<{ action: string; actor_id: string | null }>>`
    SELECT action, actor_id
      FROM audit_event
     WHERE entity = 'invite' AND entity_id = ${inviteId}
     ORDER BY created_at
  `;
}

async function insertForeignChurch(db: E2eDatabase): Promise<void> {
  await db.db
    .insert(church)
    .values({
      id: FOREIGN.churchId,
      name: "Outside Community Church",
      timezone: "America/New_York",
      demoMode: false,
    })
    .onConflictDoNothing();

  await db.db
    .insert(person)
    .values([
      {
        id: FOREIGN.coordinatorId,
        churchId: FOREIGN.churchId,
        firstName: "Rosa",
        lastName: "Outside",
        roles: ["coordinator"],
        accessToken: "outside-coordinator-6f6f",
      },
      {
        id: FOREIGN.caregiverId,
        churchId: FOREIGN.churchId,
        firstName: "Ana",
        lastName: "Outside",
        roles: ["caregiver"],
        accessToken: "outside-caregiver-6a6a",
      },
    ])
    .onConflictDoNothing();

  await db.db
    .insert(caregiver)
    .values({ personId: FOREIGN.caregiverId })
    .onConflictDoNothing();

  await db.db
    .insert(careRecipient)
    .values({
      id: FOREIGN.recipientId,
      churchId: FOREIGN.churchId,
      firstName: "Rosa",
      relation: "mother",
      createdByCaregiverId: FOREIGN.caregiverId,
    })
    .onConflictDoNothing();
}

test.describe.configure({ timeout: 300_000 });

test.describe("the invitation composer", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
    await insertForeignChurch(db);
  });

  test.afterAll(async () => {
    if (!db) return;

    for (const caregiverId of [seedIds.people.marta, seedIds.people.priya]) {
      // `audit_event` is append-only by trigger; its rows stay. They are
      // filtered by invite id in the assertions and the next global setup
      // truncates the whole test database.
      await db.client`DELETE FROM invite WHERE caregiver_id = ${caregiverId}`;
    }

    await db.client`
      DELETE FROM care_recipient WHERE church_id = ${FOREIGN.churchId}
    `;
    await db.client`
      DELETE FROM caregiver
       WHERE person_id IN (
         SELECT id FROM person WHERE church_id = ${FOREIGN.churchId}
       )
    `;
    await db.client`DELETE FROM person WHERE church_id = ${FOREIGN.churchId}`;
    await db.client`DELETE FROM church WHERE id = ${FOREIGN.churchId}`;

    await db.client.end();
  });

  test("Grace writes and sends one invitation; Marta reads it on first entry; Priya never sees it", async ({
    browser,
  }) => {
    const notificationsBefore = await notificationCount(db);

    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto("/desk/invite");

    await expect(
      grace.page.getByRole("heading", { level: 1, name: "Invite a family" }),
    ).toBeVisible();
    await expect(grace.page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(grace.page.getByTestId("invite-composer")).toBeVisible();

    const select = grace.page.getByLabel(/who is this invitation for/i);
    const options = await select.locator("option").allTextContents();
    expect(options).toContain("Marta Alvarez — for Elena");
    expect(options).toContain("David Chen — for June");
    expect(options).toContain("Priya Raman — for Mr. Rao");

    await select.selectOption({ label: "Marta Alvarez — for Elena" });

    const message = grace.page.getByLabel(/the message Marta will read/i);
    await expect(message).toHaveValue(TEMPLATE);
    await expect(
      grace.page.getByText(/nothing is emailed or texted/i),
    ).toBeVisible();
    await shot(grace.page, "desk-invite-before");

    await message.fill(EDITED_BODY);
    await expect(
      grace.page.getByText(/you have changed the church's sentence/i),
    ).toBeVisible();
    await shot(grace.page, "desk-invite-edited");

    await grace.page.getByTestId("invite-send").click();
    await expect(grace.page.getByTestId("invite-feedback")).toContainText(
      /saved with your name and today's date/i,
    );
    await expect(grace.page.getByTestId("invite-feedback")).toHaveAttribute(
      "role",
      "status",
    );
    // The family the coordinator chose and the words she wrote remain the
    // form's state after the action; the next sentence is not composed for a
    // different family behind her back.
    await expect(select).toHaveValue(seedIds.people.marta);
    await expect(select.locator("option:checked")).toHaveText(
      "Marta Alvarez — for Elena",
    );
    await expect(message).toHaveValue(EDITED_BODY);
    await shot(grace.page, "desk-invite-sent");

    await grace.page.reload();
    await expect(grace.page.getByTestId("invite-sent-row").first()).toBeVisible();
    await expect(
      grace.page.getByTestId("invite-sent-body").first(),
    ).toHaveText(EDITED_BODY);

    const row = await inviteWithBody(db, seedIds.people.marta, EDITED_BODY);
    expect(row).not.toBeNull();
    if (!row) return;

    expect(row.churchId).toBe(seedIds.church);
    expect(row.caregiverId).toBe(seedIds.people.marta);
    expect(row.body).toBe(EDITED_BODY);
    expect(row.createdBy).toBe(seedIds.people.grace);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.seenAt).toBeNull();

    // In-app only: no caregiver message row was created by the invitation.
    expect(await notificationCount(db)).toBe(notificationsBefore);

    const audits = await inviteAudit(db, row.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toEqual({
      action: "invite_sent",
      actor_id: seedIds.people.grace,
    });

    // The coordinator's page names the author and the date, and shows that the
    // family has not opened it yet.
    await expect(grace.page.getByTestId("invite-seen-state").first()).toHaveText(
      "Not opened yet.",
    );
    await shot(grace.page, "desk-invite-recent");

    // First entry: Marta opens her own link and lands on /ask.
    const marta = await signIn(browser, seedAccessTokens.marta);
    await expect(marta.page).toHaveURL(/\/ask$/);
    await expect(marta.page.getByTestId("ask-invite")).toBeVisible();
    await expect(marta.page.getByTestId("ask-invite-body")).toHaveText(
      EDITED_BODY,
    );
    await expect(
      marta.page.getByRole("heading", { name: /an invitation from grace/i }),
    ).toBeVisible();
    await expect(
      marta.page.getByText(/nothing was emailed or texted/i),
    ).toBeVisible();
    await expect(marta.page.getByTestId("ask-invite")).toContainText(
      "Grace Whitfield",
    );
    await shot(marta.page, "caregiver-ask-invite");

    const seen = await inviteWithBody(
      db,
      seedIds.people.marta,
      EDITED_BODY,
    );
    expect(seen?.seenAt).toBeInstanceOf(Date);

    // The banner is the family's first entry, not a permanent fixture. The
    // words remain on /care, where they are kept.
    await marta.page.reload();
    await expect(marta.page.getByTestId("ask-invite")).toHaveCount(0);

    // The invitation stays on the care page, word for word.
    await marta.page.goto("/care");
    await expect(marta.page.getByTestId("care-invites")).toBeVisible();
    await expect(marta.page.getByTestId("care-invite").first()).toBeVisible();
    await expect(
      marta.page.getByTestId("care-invite-body").first(),
    ).toHaveText(EDITED_BODY);
    await expect(marta.page.getByTestId("care-invite").first()).toContainText(
      "Grace Whitfield",
    );
    await shot(marta.page, "caregiver-care-invite");

    const martaHtml = await marta.page.content();
    expect(martaHtml).not.toMatch(/mailto:|sms:/i);

    // Another family's caregiver sees none of it.
    const priya = await signIn(browser, seedAccessTokens.priya);
    await priya.page.goto("/care");
    await expect(priya.page.getByTestId("care-invites")).toHaveCount(0);
    await expect(priya.page.getByText("Marta")).toHaveCount(0);

    await priya.context.close();
    await marta.context.close();
    await grace.context.close();
  });

  test("a caregiver id from another church is refused with no writes", async ({
    browser,
  }) => {
    const grace = await signIn(browser, seedAccessTokens.grace);
    const before = await inviteCountForChurch(db, seedIds.church);

    const response = await grace.page.request.post("/api/desk/invite", {
      data: {
        caregiverId: FOREIGN.caregiverId,
        body: "A message that must never be stored.",
      },
    });

    expect(response.status()).toBe(403);
    const payload = (await response.json()) as {
      ok: boolean;
      code: string;
      message: string;
    };
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("not_in_church");
    expect(payload.message).toMatch(/isn't part of this church/i);
    expect(payload.message).not.toMatch(
      /postgres|SQLSTATE|constraint|stack|pg_/i,
    );

    expect(await inviteCountForChurch(db, seedIds.church)).toBe(before);
    expect(await latestInviteFor(db, FOREIGN.caregiverId)).toBeNull();

    await grace.context.close();
  });

  test("a caregiver's own session cannot use the invitation write path", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    const before = await inviteCountForChurch(db, seedIds.church);

    const response = await marta.page.request.post("/api/desk/invite", {
      data: {
        caregiverId: seedIds.people.marta,
        body: "A caregiver cannot invite herself.",
      },
    });

    expect(response.status()).toBe(403);
    expect(await inviteCountForChurch(db, seedIds.church)).toBe(before);

    await marta.context.close();
  });
});

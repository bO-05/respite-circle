import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-R2PROM-005 — the waiting state stops claiming "not read yet" once it is
 * read.
 *
 * A quiet church of its own holds one waiting ask, so nothing another spec does
 * to the seeded congregation can move this state. The caregiver reads the pill
 * before anyone at the desk has looked; the coordinator's first render of the
 * ask records the desk read; a second render and a second coordinator's look
 * leave the instant byte-identical; the caregiver's reload shows the cleared
 * state, which says what happens next instead of repeating a claim the code can
 * no longer keep.
 */

const CHURCH = "da000000-0000-4000-8000-000000000001";
const COORDINATOR = "da000000-0000-4000-8000-000000000002";
const DEPUTY = "da000000-0000-4000-8000-000000000003";
const CAREGIVER = "da000000-0000-4000-8000-000000000004";
const RECIPIENT = "da000000-0000-4000-8000-000000000005";
const ASK = "da000000-0000-4000-8000-000000000006";
const POLICY = "da000000-0000-4000-8000-000000000007";

const COORDINATOR_TOKEN = "e2e-desk-read-coordinator";
const DEPUTY_TOKEN = "e2e-desk-read-deputy";
const CAREGIVER_TOKEN = "e2e-desk-read-caregiver";

const VERBATIM =
  "The weeks are long and I am running on empty. June is content with company and a cup of tea, and she naps after lunch.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "r2-desk-read",
);

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

/** The stored instant, as text: an exact comparison, not a parsed guess. */
async function deskReadAt(
  db: E2eDatabase,
  askId: string,
): Promise<string | null> {
  const [row] = await db.client<{ desk_read_at: string | null }[]>`
    SELECT desk_read_at::text AS desk_read_at FROM ask WHERE id = ${askId}
  `;
  return row?.desk_read_at ?? null;
}

async function ensureFixture(db: E2eDatabase): Promise<void> {
  await db.client`
    INSERT INTO church (id, name, timezone, demo_mode)
    VALUES (${CHURCH}, 'Quiet Fellowship', 'America/New_York', false)
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO person (id, church_id, first_name, last_name, roles, access_token)
    VALUES
      (${COORDINATOR}, ${CHURCH}, 'Nora', 'Desk', '["coordinator"]'::jsonb, ${COORDINATOR_TOKEN}),
      (${DEPUTY}, ${CHURCH}, 'Owen', 'Desk', '["deputy"]'::jsonb, ${DEPUTY_TOKEN}),
      (${CAREGIVER}, ${CHURCH}, 'Marta', 'Desk', '["caregiver"]'::jsonb, ${CAREGIVER_TOKEN})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO caregiver (person_id) VALUES (${CAREGIVER})
    ON CONFLICT (person_id) DO NOTHING
  `;

  await db.client`
    INSERT INTO care_recipient (id, church_id, first_name, relation, created_by_caregiver_id)
    VALUES (${RECIPIENT}, ${CHURCH}, 'June', 'mother', ${CAREGIVER})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO policy (
      id, church_id, version, safeguarding_promises, question_set,
      crisis_script, referral_resources, reminder_window_hours,
      call_threshold_hours, signed_off_by, signed_off_at
    )
    VALUES (
      ${POLICY}, ${CHURCH}, 1, '[]'::jsonb, '[]'::jsonb,
      'Call the family today.', '[]'::jsonb, 24, 48, 'Nora', now()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO ask (
      id, church_id, caregiver_id, care_recipient_id, verbatim_text,
      status, policy_version_id
    )
    VALUES (
      ${ASK}, ${CHURCH}, ${CAREGIVER}, ${RECIPIENT}, ${VERBATIM},
      'waiting_coordinator', ${POLICY}
    )
    ON CONFLICT (id) DO NOTHING
  `;

  // A retry starts minutes later against the same rows. Clear the one column
  // this spec writes so the attempt meets the state it means to test; the
  // caregiver's words are untouched, as the trigger requires.
  await db.client`UPDATE ask SET desk_read_at = NULL WHERE id = ${ASK}`;
}

test.describe.configure({ timeout: 180_000 });

test("VAL-R2PROM-005 — the first desk look clears 'not read yet', and later looks change nothing", async ({
  browser,
}) => {
  const db = await openE2eDatabase();

  try {
    await ensureFixture(db);
    expect(await deskReadAt(db, ASK)).toBeNull();

    // 1. Nobody at the desk has looked yet, so the pill is allowed to say so.
    const marta = await signIn(browser, CAREGIVER_TOKEN);
    const receipt = await marta.page.goto(`/ask/${ASK}`);
    expect(receipt?.status()).toBe(200);
    const status = marta.page.getByTestId("ask-status");
    await expect(status).toHaveText(/With Nora — not read yet/i);
    await shot(marta.page, "01-caregiver-not-read-yet");

    // 2. The coordinator renders the ask. Rendering it is the desk read.
    const nora = await signIn(browser, COORDINATOR_TOKEN);
    const firstView = await nora.page.goto(`/desk/ask/${ASK}`);
    expect(firstView?.status()).toBe(200);
    await expect(nora.page.getByTestId("desk-verbatim")).toHaveText(VERBATIM);

    const firstRead = await deskReadAt(db, ASK);
    expect(firstRead).not.toBeNull();
    await shot(nora.page, "02-desk-first-read");

    // 3. A second render leaves the instant exactly as it was.
    await nora.page.reload();
    await expect(nora.page.getByTestId("desk-verbatim")).toHaveText(VERBATIM);
    expect(await deskReadAt(db, ASK)).toBe(firstRead);

    // 4. A different coordinator's look changes nothing either: the instant
    //    belongs to the ask, not to the viewer.
    const owen = await signIn(browser, DEPUTY_TOKEN);
    const deputyView = await owen.page.goto(`/desk/ask/${ASK}`);
    expect(deputyView?.status()).toBe(200);
    await expect(owen.page.getByTestId("desk-verbatim")).toHaveText(VERBATIM);
    expect(await deskReadAt(db, ASK)).toBe(firstRead);

    // 5. The caregiver reloads and sees the cleared state, which says what
    //    happens next instead of claiming nobody has read her words.
    await marta.page.reload();
    await expect(status).toHaveText(/Read by Nora — she may call you/i);
    await expect(status).not.toContainText(/not read yet/i);
    const clearedText = await marta.page.locator("#main").innerText();
    expect(clearedText).not.toMatch(/not read yet/i);
    // What happens next is still named, and it is the call the pill points at.
    await expect(
      marta.page.getByText(/Nora may call to talk the week through/i).first(),
    ).toBeVisible();
    await shot(marta.page, "03-caregiver-read-cleared");

    // 6. It stays cleared on another reload, and no render moved the instant.
    await marta.page.reload();
    await expect(status).toHaveText(/Read by Nora — she may call you/i);
    expect(await deskReadAt(db, ASK)).toBe(firstRead);

    await marta.context.close();
    await nora.context.close();
    await owen.context.close();
  } finally {
    await db.client.end();
  }
});

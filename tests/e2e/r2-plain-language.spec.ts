import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-R2UI-003, VAL-R2UI-004 and VAL-R2UI-006 on the real surfaces.
 *
 * A church of its own whose coordinator is Nora, not the seeded Grace, so a
 * hardcoded name cannot pass: every sentence that names a person must render
 * the resolved first name. The fixture holds two asks — one still waiting, one
 * published but unclaimed — so the receipt and the care page can be read in the
 * published state VAL-R2UI-004 is about.
 *
 * The retired sentences are grepped here rather than trusted to a code review:
 * a phrasing that comes back on a rendered page fails this spec.
 */

const CHURCH = "d4000000-0000-4000-8000-000000000001";
const COORDINATOR = "d4000000-0000-4000-8000-000000000002";
const DEPUTY = "d4000000-0000-4000-8000-000000000003";
const CAREGIVER = "d4000000-0000-4000-8000-000000000004";
const RECIPIENT = "d4000000-0000-4000-8000-000000000005";
const POLICY = "d4000000-0000-4000-8000-000000000006";
const WAITING_ASK = "d4000000-0000-4000-8000-000000000007";
const PUBLISHED_ASK = "d4000000-0000-4000-8000-000000000008";
const PUBLISHED_REVISION = "d4000000-0000-4000-8000-000000000009";
const PUBLISHED_SLOT = "d4000000-0000-4000-8000-00000000000a";

const CAREGIVER_TOKEN = "e2e-plain-language-caregiver";
const COORDINATOR_TOKEN = "e2e-plain-language-coordinator";
const DEPUTY_TOKEN = "e2e-plain-language-deputy";

const WAITING_WORDS =
  "The nights are long and I have not had a morning to myself since March. June is happy with company and a cup of tea.";
const PUBLISHED_WORDS =
  "Could someone bring a hot meal on Saturday? June eats early and naps after lunch.";

/** Saturday 4 January 2031, 10:00 in New York. */
const SLOT_START = "2031-01-04T15:00:00.000Z";
const SLOT_END = "2031-01-04T16:00:00.000Z";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "r2-plain-language",
);

/**
 * The sentences the round-2 visual audit retired. Each must return zero on
 * every page this spec renders.
 */
const RETIRED = [
  "Your coordinator is working on",
  "About June",
  "Nothing is decided without you",
  "you decide whether it helps",
  "You can change it later",
  "3 samples",
  "below a confidence of 0.60 it abstains",
  "Every time belongs to a tier",
  "Fills a sentence a person wrote with two first names",
  "Converting this hold is a separate, recorded decision",
  "Eight commitments",
  "eight refusals",
  "Engine badge",
  "numerator and denominator",
  "4 of 4 future Tuesdays are scheduled.",
  "It signs you in as you, and only you.",
  "Nothing is shown to anyone until she approves it.",
  "plain code",
  "Plain code",
];

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

async function ensureFixture(db: E2eDatabase): Promise<void> {
  await db.client`
    INSERT INTO church (id, name, timezone)
    VALUES (${CHURCH}, 'Plain Language Fellowship', 'America/New_York')
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO person (id, church_id, first_name, last_name, roles, access_token)
    VALUES
      (${COORDINATOR}, ${CHURCH}, 'Nora', 'Lang', '["coordinator"]'::jsonb, ${COORDINATOR_TOKEN}),
      (${DEPUTY}, ${CHURCH}, 'Owen', 'Lang', '["deputy"]'::jsonb, ${DEPUTY_TOKEN}),
      (${CAREGIVER}, ${CHURCH}, 'Marta', 'Lang', '["caregiver"]'::jsonb, ${CAREGIVER_TOKEN})
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
      'Call the family today.', '[]'::jsonb, 24, 48, 'Nora Lang', now()
    )
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO ask (
      id, church_id, caregiver_id, care_recipient_id, verbatim_text,
      status, policy_version_id, approved_by, approved_at
    )
    VALUES
      (
        ${WAITING_ASK}, ${CHURCH}, ${CAREGIVER}, ${RECIPIENT},
        ${WAITING_WORDS}, 'waiting_coordinator', ${POLICY}, NULL, NULL
      ),
      (
        ${PUBLISHED_ASK}, ${CHURCH}, ${CAREGIVER}, ${RECIPIENT},
        ${PUBLISHED_WORDS}, 'approved', ${POLICY}, ${COORDINATOR}, now()
      )
    ON CONFLICT (id) DO NOTHING
  `;

  // One revision, so the published ask has a receipt to read the trail from.
  await db.client`
    INSERT INTO ask_revision (id, ask_id, verbatim_text, digest)
    VALUES (
      ${PUBLISHED_REVISION}, ${PUBLISHED_ASK}, ${PUBLISHED_WORDS},
      ${sha256Hex(PUBLISHED_WORDS)}
    )
    ON CONFLICT (id) DO NOTHING
  `;

  // Published but unclaimed: the state VAL-R2UI-004 is about.
  await db.client`
    INSERT INTO slot (
      id, ask_id, church_id, kind, tier, label, window_start, window_end,
      gated, orientation_note, rule_ref, status, approved_by, approved_at
    )
    VALUES (
      ${PUBLISHED_SLOT}, ${PUBLISHED_ASK}, ${CHURCH}, 'meal', 'doorstep',
      'A hot meal at home', ${SLOT_START}::timestamptz,
      ${SLOT_END}::timestamptz, false, NULL, 'q3_meal', 'open',
      ${COORDINATOR}, now()
    )
    ON CONFLICT (id) DO NOTHING
  `;
}

function expectNoRetiredCopy(text: string, where: string): void {
  for (const sentence of RETIRED) {
    expect(text, `${where} still says "${sentence}"`).not.toContain(sentence);
  }
}

test.describe.configure({ timeout: 180_000 });

test("VAL-R2UI-003 and VAL-R2UI-006 — the compose screen names Nora once, not Grace, and marks the two refusals", async ({
  browser,
}) => {
  const db = await openE2eDatabase();
  try {
    await ensureFixture(db);

    const marta = await signIn(browser, CAREGIVER_TOKEN);
    const response = await marta.page.goto("/ask");
    expect(response?.status()).toBe(200);

    // The consent line names the reader and the deputy beside her.
    await expect(
      marta.page.getByLabel(
        /i agree that the church may keep these words and that Nora, or the deputy who covers when she is away, may read them/i,
      ),
    ).toBeVisible();

    // One reassurance, and it is Nora's. The old screen said the same thing
    // twice, in the consent line and again below the button.
    const consentHelp = marta.page.locator("#ask-consent-help");
    await expect(consentHelp).toHaveText(
      "Nora reads every ask first. Nothing is shown to a neighbour until she approves it, except a meal under the church's signed low-risk policy.",
    );
    await expect(
      marta.page.getByText(/reads every ask first/i),
    ).toHaveCount(1);

    // Two examples stop instead of offering a time, and their labels say so
    // before the button is pressed.
    const refusalButtons = marta.page.locator(
      'button[data-refusal-example="true"]',
    );
    await expect(refusalButtons).toHaveCount(2);
    for (const label of [
      /personal care — the ask stops, and a person calls/i,
      /safety — the ask stops, and a person calls today/i,
    ]) {
      await expect(
        marta.page.getByRole("button", { name: label }),
      ).toBeVisible();
    }
    await expect(
      marta.page.locator('section[aria-labelledby="ask-samples"]').getByText(
        /sending it raises a hold, and a person calls instead of offering a time/i,
      ),
    ).toHaveCount(2);

    // A differently named church never displays the seeded coordinator's name.
    const body = await marta.page.locator("body").innerText();
    expect(body).not.toContain("Grace");
    expectNoRetiredCopy(body, "/ask");
    expect(body).not.toMatch(/change it later/i);

    await shot(marta.page, "01-compose-one-reassurance");
    await marta.context.close();
  } finally {
    await db.client.end();
  }
});

test("VAL-R2UI-003 and VAL-R2UI-006 — the waiting receipt names Nora, hides the digest, and keeps the meal exception", async ({
  browser,
}) => {
  const db = await openE2eDatabase();
  try {
    await ensureFixture(db);

    const marta = await signIn(browser, CAREGIVER_TOKEN);
    const response = await marta.page.goto(`/ask/${WAITING_ASK}`);
    expect(response?.status()).toBe(200);

    // Nobody has decided yet: the empty state names the person who will read.
    await expect(marta.page.getByTestId("trail-empty")).toHaveText(
      "The answers for your newest words are being prepared. Nora will read them; a person will decide.",
    );

    // Zero published, with the signed exception in the same breath.
    await expect(marta.page.getByTestId("publication-state")).toContainText(
      "Nothing has been published yet. No time is shown to a neighbour until Nora approves it, except a meal under the church's signed low-risk policy.",
    );

    // The caretaker-facing words name Nora and the deputy, not Grace.
    await expect(marta.page.getByTestId("caregiver-verbatim")).toBeVisible();
    const body = await marta.page.locator("body").innerText();
    expect(body).not.toContain("Grace");
    expectNoRetiredCopy(body, "/ask/<waiting>");
    expect(body).not.toMatch(/the model's stated confidence:\s*\d+%/i);
    expect(body).not.toMatch(/\d+ samples?/i);

    await shot(marta.page, "02-waiting-receipt");
    await marta.context.close();
  } finally {
    await db.client.end();
  }
});

test("VAL-R2UI-004 — the published receipt and the care page agree that published is not booked, each with one next action", async ({
  browser,
}) => {
  const db = await openE2eDatabase();
  try {
    await ensureFixture(db);

    const marta = await signIn(browser, CAREGIVER_TOKEN);
    const response = await marta.page.goto(`/ask/${PUBLISHED_ASK}`);
    expect(response?.status()).toBe(200);

    const publication = marta.page.getByTestId("publication-state");
    await expect(publication).toContainText(
      "Nora has published 1 time.",
    );
    await expect(publication).toContainText(
      "A published time is not booked yet: it appears on your care page only after Nora confirms a neighbour.",
    );
    // One next action, and it goes to the page that lists covered times.
    await expect(publication.getByRole("link")).toHaveCount(1);
    await expect(
      publication.getByRole("link", {
        name: /see what is covered for my family/i,
      }),
    ).toHaveAttribute("href", "/care");

    // The 64-character digest is behind a summary a family can understand, so
    // it is not the first thing a tired reader meets.
    const digest = marta.page.getByTestId("trail-digest");
    await expect(digest).toContainText(
      "A fingerprint of your words, kept so they cannot be changed.",
    );
    expect(await digest.innerText()).not.toMatch(/[0-9a-f]{64}/);
    await digest.getByText(/fingerprint of your words/i).click();
    await expect(digest).toContainText(/[0-9a-f]{64}/);

    const receiptText = await marta.page.locator("body").innerText();
    expectNoRetiredCopy(receiptText, "/ask/<published>");
    expect(receiptText).not.toContain("Grace");

    await shot(marta.page, "03-published-receipt");

    // The care page says the same thing in the same words, with its own one
    // next action back to the ask.
    const careResponse = await marta.page.goto("/care");
    expect(careResponse?.status()).toBe(200);

    const working = marta.page.getByTestId("care-coordinator-working");
    await expect(working).toContainText(
      "Nora is looking for someone for your Saturday meal. No one has said yes yet.",
    );
    await expect(
      marta.page.getByTestId("care-published-not-booked"),
    ).toHaveText(
      "A published time is not booked yet: it appears here only after Nora confirms a neighbour.",
    );
    await expect(
      working.getByTestId("care-working-next-action"),
    ).toHaveAttribute("href", `/ask/${PUBLISHED_ASK}`);
    await expect(working.getByRole("link")).toHaveCount(1);

    // Published but unclaimed is not covered.
    await expect(marta.page.getByTestId("care-covered-empty")).toBeVisible();
    await expect(marta.page.getByTestId("care-confirmations")).toHaveCount(0);

    const careText = await marta.page.locator("body").innerText();
    expect(careText).not.toContain("Grace");
    expectNoRetiredCopy(careText, "/care");

    await shot(marta.page, "04-care-published-not-booked");
    await marta.context.close();
  } finally {
    await db.client.end();
  }
});

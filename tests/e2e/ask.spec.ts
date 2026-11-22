import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { seedAccessTokens, seedIds } from "../../src/db/seed-data";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-ASK-001…007 on the real surface, against the isolated
 * `respite_circle_e2e` database. The suite proves the stored value, not only
 * the rendered one: verbatim byte equality, one revision, nine decisions, and
 * a coordinator read that offers no edit control.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.\n\nShe loves hymns and tea, and she naps after lunch.";

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

async function fillAsk(
  page: Page,
  text: string,
  options: { consent?: boolean } = {},
): Promise<void> {
  const textarea = page.getByLabel(/tell us what a hard week looks like/i);
  await textarea.fill(text);
  if (options.consent !== false) {
    await page.getByLabel(/i understand that Grace reads this first/i).check();
  }
}

async function submitAsk(page: Page): Promise<void> {
  await page.getByRole("button", { name: /send this to/i }).click();
}

async function countMartaAsks(db: E2eDatabase): Promise<number> {
  const [row] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
      FROM ask
     WHERE caregiver_id = ${seedIds.people.marta}
  `;
  return row.count;
}

async function readAsk(
  db: E2eDatabase,
  askId: string,
): Promise<{ verbatimText: string; status: string } | null> {
  const rows = await db.client<
    { verbatim_text: string; status: string }[]
  >`SELECT verbatim_text, status FROM ask WHERE id = ${askId}`;
  const row = rows[0];
  return row
    ? { verbatimText: row.verbatim_text, status: row.status }
    : null;
}

test.describe("caregiver ask intake", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    await db.client.end();
  });

  test("offers one large question, typing, dictation, consent, and five fictional examples", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, seedAccessTokens.marta);

    await expect(page).toHaveURL(/\/ask$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /what does a hard week look like/i,
      }),
    ).toBeVisible();

    const textarea = page.getByLabel(/tell us what a hard week looks like/i);
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveAttribute("aria-required", "true");

    await expect(
      page.getByLabel(/i understand that Grace reads this first/i),
    ).toBeVisible();
    await expect(
      page.getByText(/these examples are fictional/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /use the example/i }),
    ).toHaveCount(5);
    await expect(page.getByRole("button", { name: /dictat/i })).toBeVisible();

    // No password, no account: the one access link is the whole sign-in.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByText(/password or an account/i)).toHaveCount(0);

    await context.close();
  });

  test("empty and whitespace-only submissions show an associated error and create no ask", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, seedAccessTokens.marta);
    const before = await countMartaAsks(db);

    const textarea = page.getByLabel(/tell us what a hard week looks like/i);

    await submitAsk(page);
    const emptyAlert = page.getByTestId("ask-error");
    await expect(emptyAlert).toBeVisible();
    await expect(emptyAlert).toContainText(/please write a few words/i);
    await expect(textarea).toHaveAttribute("aria-invalid", "true");
    await expect(textarea).toBeFocused();
    expect(await countMartaAsks(db)).toBe(before);

    await textarea.fill("   \n\t  ");
    await submitAsk(page);
    await expect(page.getByTestId("ask-error")).toContainText(
      /please write a few words/i,
    );
    expect(await countMartaAsks(db)).toBe(before);

    await context.close();
  });

  test("the consent line is required: no acknowledgement, no ask", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, seedAccessTokens.marta);
    const before = await countMartaAsks(db);

    await fillAsk(page, HERO_ASK, { consent: false });
    await submitAsk(page);

    await expect(page.getByTestId("ask-error")).toContainText(/tick the box/i);
    await expect(
      page.getByLabel(/i understand that Grace reads this first/i),
    ).toBeFocused();
    expect(await countMartaAsks(db)).toBe(before);

    await context.close();
  });

  test("submitting shows a plain receipt with the exact words and Grace's name", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, seedAccessTokens.marta);
    const before = await countMartaAsks(db);

    await fillAsk(page, HERO_ASK);
    await submitAsk(page);
    await page.waitForURL(RECEIPT_URL, { timeout: 30_000 });

    const askId = page.url().split("/").at(-1) as string;

    await expect(page.getByTestId("ask-status")).toContainText(
      /waiting — Grace reads this first/i,
    );
    await expect(
      page.getByText(/Grace reads every ask first/i).first(),
    ).toBeVisible();
    await expect(
      page.getByText(/nothing is shown to anyone until she approves it/i).first(),
    ).toBeVisible();

    const shown = await page.getByTestId("caregiver-verbatim").textContent();
    expect(shown).toBe(HERO_ASK);
    await expect(page.getByText(/nobody can edit them/i)).toBeVisible();

    expect(await countMartaAsks(db)).toBe(before + 1);

    const stored = await readAsk(db, askId);
    expect(stored).not.toBeNull();
    expect(stored?.verbatimText).toBe(HERO_ASK);
    expect(stored?.status).toBe("waiting_coordinator");

    const revisions = await db.client<
      { verbatim_text: string; digest: string; supersedes_id: string | null }[]
    >`SELECT verbatim_text, digest, supersedes_id
        FROM ask_revision
       WHERE ask_id = ${askId}`;
    expect(revisions).toHaveLength(1);
    expect(revisions[0].verbatim_text).toBe(HERO_ASK);
    expect(revisions[0].digest).toBe(sha256Hex(HERO_ASK));
    expect(revisions[0].supersedes_id).toBeNull();

    const decisions = await db.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM decision WHERE ask_id = ${askId}
    `;
    expect(decisions[0].count).toBe(9);

    // The coordinator's view is the same bytes and has no edit affordance.
    const grace = await signIn(browser, seedAccessTokens.grace);
    const response = await grace.page.goto(`/desk/ask/${askId}`);
    expect(response?.status()).toBe(200);
    expect(await grace.page.getByTestId("desk-verbatim").textContent()).toBe(
      HERO_ASK,
    );
    // The words' own section has no field and no button. The page also carries
    // the draft editor's forms, so the check is scoped to the words.
    const wordsSection = grace.page.locator("section", {
      has: grace.page.getByTestId("desk-verbatim"),
    });
    await expect(wordsSection.getByRole("textbox")).toHaveCount(0);
    await expect(wordsSection.getByRole("button")).toHaveCount(0);
    const fieldsAroundWords = await grace.page
      .getByTestId("desk-verbatim")
      .evaluate((element) => {
        const offenders: string[] = [];
        for (
          let node: Element | null = element;
          node;
          node = node.parentElement
        ) {
          if (
            node.matches(
              "form, input, textarea, select, [contenteditable='true']",
            )
          ) {
            offenders.push(node.tagName.toLowerCase());
          }
        }
        return offenders;
      });
    expect(fieldsAroundWords).toEqual([]);
    await grace.context.close();

    await context.close();
  });

  test("a 4,000-character ask is stored and shown intact", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, seedAccessTokens.marta);
    const text = "word ".repeat(800);
    expect(text.length).toBe(4_000);

    await fillAsk(page, text);
    await submitAsk(page);
    await page.waitForURL(RECEIPT_URL, { timeout: 30_000 });

    const askId = page.url().split("/").at(-1) as string;
    expect(await page.getByTestId("caregiver-verbatim").textContent()).toBe(
      text,
    );

    const stored = await readAsk(db, askId);
    expect(stored?.verbatimText.length).toBe(4_000);
    expect(stored?.verbatimText).toBe(text);

    const revisions = await db.client<{ verbatim_text: string }[]>`
      SELECT verbatim_text FROM ask_revision WHERE ask_id = ${askId}
    `;
    expect(revisions[0].verbatim_text).toBe(text);

    await context.close();
  });

  test("without SpeechRecognition it explains the browser and typing still sends", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    // Emulate a browser with no dictation API before any app script runs.
    await context.addInitScript(() => {
      const speechWindow = window as unknown as Record<string, unknown>;
      delete speechWindow.SpeechRecognition;
      delete speechWindow.webkitSpeechRecognition;
    });

    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto(`/enter/${seedAccessTokens.marta}`);
    expect(response?.status()).toBe(200);

    await expect(page.getByText(/this browser can't dictate/i)).toBeVisible();
    const dictate = page.getByRole("button", { name: /dictat/i });
    await expect(dictate).toBeVisible();
    await dictate.click();
    await expect(page.getByText(/you can type your words instead/i)).toBeVisible();
    await expect(page.getByTestId("ask-error")).toHaveCount(0);

    await fillAsk(page, HERO_ASK);
    await submitAsk(page);
    await page.waitForURL(RECEIPT_URL, { timeout: 30_000 });
    expect(await page.getByTestId("caregiver-verbatim").textContent()).toBe(
      HERO_ASK,
    );

    expect(pageErrors).toEqual([]);
    await context.close();
  });

  test("a caregiver edit appends a revision and leaves the original untouched", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, seedAccessTokens.marta);

    const created = await context.request.post("/api/asks", {
      data: { text: HERO_ASK, consent: true },
      // The first write after a cold Neon compute can take longer than
      // Playwright's 10 s default; draft construction adds a few round trips.
      timeout: 45_000,
    });
    expect(created.status()).toBe(201);
    const createdBody = (await created.json()) as { askId: string };

    const edited =
      "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows — she just can't be alone.\n\nShe loves hymns and tea.";

    const revised = await context.request.post("/api/asks", {
      data: { text: edited, consent: true, revisionOf: createdBody.askId },
      timeout: 45_000,
    });
    expect(revised.status()).toBe(201);

    await page.goto(`/ask/${createdBody.askId}`);
    expect(await page.getByTestId("caregiver-verbatim").textContent()).toBe(
      edited,
    );
    await expect(page.getByText(/you have changed these words/i)).toBeVisible();

    const stored = await readAsk(db, createdBody.askId);
    expect(stored?.verbatimText).toBe(HERO_ASK);

    const revisions = await db.client<
      { verbatim_text: string; supersedes_id: string | null }[]
    >`SELECT verbatim_text, supersedes_id
        FROM ask_revision
       WHERE ask_id = ${createdBody.askId}
       ORDER BY created_at`;
    expect(revisions).toHaveLength(2);
    expect(revisions[0].verbatim_text).toBe(HERO_ASK);
    expect(revisions[1].verbatim_text).toBe(edited);
    expect(revisions[1].supersedes_id).not.toBeNull();

    await context.close();
  });

  test("another caregiver cannot open the receipt by guessing its address", async ({
    browser,
  }) => {
    const inserted = await db.client<{ id: string }[]>`
      INSERT INTO ask (church_id, caregiver_id, care_recipient_id, verbatim_text, status, policy_version_id)
      VALUES (${seedIds.church}, ${seedIds.people.marta}, ${seedIds.careRecipients.elena}, ${"Private words for Marta only."}, 'waiting_coordinator', ${seedIds.policyV1})
      RETURNING id
    `;
    const askId = inserted[0].id;

    const { context, page } = await signIn(browser, seedAccessTokens.david);
    const response = await page.goto(`/ask/${askId}`);
    expect(response?.status()).toBe(404);

    const body = await page.content();
    expect(body).not.toContain("Private words for Marta only");
    await expect(page.getByTestId("caregiver-verbatim")).toHaveCount(0);

    await context.close();
  });

  test("the API refuses empty words, missing consent, and the wrong roles", async ({
    browser,
    request,
  }) => {
    const anonymous = await request.post("/api/asks", {
      data: { text: HERO_ASK, consent: true },
    });
    expect(anonymous.status()).toBe(401);

    const marta = await signIn(browser, seedAccessTokens.marta);

    for (const payload of [
      { text: "", consent: true },
      { text: "   \n\t ", consent: true },
      { text: HERO_ASK, consent: false },
    ]) {
      const response = await marta.context.request.post("/api/asks", {
        data: payload,
      });
      expect(response.status()).toBe(400);
      const body = (await response.json()) as { ok: boolean; code: string };
      expect(body.ok).toBe(false);
    }

    const grace = await signIn(browser, seedAccessTokens.grace);
    const coordinatorResponse = await grace.context.request.post("/api/asks", {
      data: { text: HERO_ASK, consent: true },
    });
    expect(coordinatorResponse.status()).toBe(403);

    const ruth = await signIn(browser, seedAccessTokens.ruth);
    const volunteerResponse = await ruth.context.request.post("/api/asks", {
      data: { text: HERO_ASK, consent: true },
    });
    expect(volunteerResponse.status()).toBe(403);

    await grace.context.close();
    await ruth.context.close();
    await marta.context.close();
  });
});

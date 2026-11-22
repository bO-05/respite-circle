import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { seedAccessTokens } from "../../src/db/seed-data";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-DESK-001 and VAL-DESK-002 on the real surface.
 *
 * The queue is read from the real server and the real database: only waiting,
 * safety-held, and personal-care-held asks appear; safety and personal care are
 * pinned as categories in that order; the ordinary queue is oldest first; every
 * row carries the caregiver's first name, a typed reason summary, and a human
 * wait. The detail page shows the exact words with no edit control and a lock
 * note, and a POST that tries to replace them is refused.
 */

const WAITING_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.";
const SECOND_WAITING_ASK =
  "A Tuesday morning would help. She loves hymns and tea, and she naps after lunch.";
const SAFETY_ASK =
  "She fell last week and I am scared she will wander out of the house.";
const CARE_ASK = "I need help with bathing and remembering her medication.";
const EXCLUDED_ASK =
  "Could someone sit with her on Sunday? I would like to go to church.";

const VERBATIM =
  "  Two  spaces, a line\nbreak, and a dash — kept.\nThank you.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "desk-queue",
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

async function createAsk(
  context: BrowserContext,
  text: string,
): Promise<string> {
  const response = await context.request.post("/api/asks", {
    data: { text, consent: true },
    // The first write after a cold Neon compute can take longer than
    // Playwright's 10 s default; the documented wake is 5.4–5.6 s.
    timeout: 45_000,
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { askId: string };
  return body.askId;
}

async function setQueueStatus(
  db: E2eDatabase,
  askId: string,
  status: string,
): Promise<void> {
  await db.client`UPDATE ask SET status = ${status} WHERE id = ${askId}`;
}

async function backdate(
  db: E2eDatabase,
  askId: string,
  days: number,
): Promise<void> {
  const createdAt = new Date(
    Date.now() - days * 24 * 60 * 60 * 1_000,
  ).toISOString();
  await db.client`
    UPDATE ask SET created_at = ${createdAt}::timestamptz WHERE id = ${askId}
  `;
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

test.describe.configure({ timeout: 150_000 });

test.describe("coordinator desk queue", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    await db.client.end();
  });

  test("pins safety and personal care, then lists ordinary asks oldest first with typed reasons and waits", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    const waitingId = await createAsk(marta.context, WAITING_ASK);
    const secondWaitingId = await createAsk(
      marta.context,
      SECOND_WAITING_ASK,
    );
    const excludedId = await createAsk(marta.context, EXCLUDED_ASK);
    await marta.context.close();

    const david = await signIn(browser, seedAccessTokens.david);
    const safetyId = await createAsk(david.context, SAFETY_ASK);
    await david.context.close();

    const priya = await signIn(browser, seedAccessTokens.priya);
    const careId = await createAsk(priya.context, CARE_ASK);
    await priya.context.close();

    await backdate(db, waitingId, 3);
    await backdate(db, secondWaitingId, 1);
    await backdate(db, safetyId, 2);
    await backdate(db, careId, 0.25);

    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto("/desk");

    // Only the three queue statuses are on the page. An approved, sent-back,
    // or closed ask never appears.
    for (const status of ["approved", "sent_back", "closed"]) {
      await setQueueStatus(db, excludedId, status);
      await grace.page.reload();
      await expect(
        grace.page.locator(`[data-ask-id="${excludedId}"]`),
      ).toHaveCount(0);
    }

    // The pinned categories come first, in this order.
    const sections = await grace.page
      .locator('[data-testid^="desk-category-"]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-testid")),
      );
    expect(sections).toEqual([
      "desk-category-safety",
      "desk-category-personal_care",
      "desk-category-waiting",
    ]);

    const safetyRow = grace.page.locator(`[data-ask-id="${safetyId}"]`);
    const careRow = grace.page.locator(`[data-ask-id="${careId}"]`);
    const waitingRow = grace.page.locator(`[data-ask-id="${waitingId}"]`);

    await expect(safetyRow).toBeVisible();
    await expect(careRow).toBeVisible();
    await expect(waitingRow).toBeVisible();

    await expect(
      grace.page.locator(
        `[data-testid="desk-category-safety"] [data-ask-id="${safetyId}"]`,
      ),
    ).toHaveCount(1);
    await expect(
      grace.page.locator(
        `[data-testid="desk-category-personal_care"] [data-ask-id="${careId}"]`,
      ),
    ).toHaveCount(1);
    await expect(
      grace.page.locator(
        `[data-testid="desk-category-waiting"] [data-ask-id="${waitingId}"]`,
      ),
    ).toHaveCount(1);

    // Every row names the caregiver, a typed reason summary, and a wait.
    const rows = grace.page.getByTestId("desk-row");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      await expect(row.getByTestId("desk-reason-summary")).not.toHaveText("");
      await expect(row.getByTestId("desk-waiting-time")).toContainText(
        "Waiting",
      );
    }

    await expect(waitingRow).toContainText("Marta");
    await expect(waitingRow.getByTestId("desk-reason-summary")).toContainText(
      "Companionship",
    );
    await expect(waitingRow.getByTestId("desk-reason-summary")).toContainText(
      "A Saturday",
    );
    await expect(waitingRow.getByTestId("desk-waiting-time")).toHaveText(
      "Waiting 3 days",
    );
    await expect(waitingRow.getByTestId("desk-pin-label")).toHaveCount(0);
    await expect(waitingRow.getByTestId("desk-hold-reason")).toHaveCount(0);

    await expect(safetyRow.getByTestId("desk-pin-label")).toHaveText(
      "Safety hold",
    );
    await expect(safetyRow.getByTestId("desk-waiting-time")).toHaveText(
      "Waiting 2 days",
    );
    await expect(safetyRow.getByTestId("desk-hold-reason")).toContainText(
      "call the family today",
    );
    await expect(safetyRow.getByTestId("desk-hold-reason")).toContainText(
      "No time is offered",
    );

    await expect(careRow.getByTestId("desk-pin-label")).toHaveText(
      "Personal-care hold",
    );
    await expect(careRow.getByTestId("desk-hold-reason")).toContainText(
      "professional help",
    );

    // The ordinary queue is oldest first, even when a newer safety ask exists.
    const waitingTimes = await grace.page
      .locator(
        '[data-testid="desk-category-waiting"] [data-testid="desk-row"]',
      )
      .evaluateAll((elements) =>
        elements.map((element) =>
          element.getAttribute("data-created-at"),
        ),
      );
    const sorted = [...waitingTimes].sort();
    expect(waitingTimes).toEqual(sorted);

    const mainText = await grace.page.locator("main").innerText();
    expect(mainText).not.toMatch(/urgent|priority|urgency/i);
    expect(mainText).toContain("Safety hold");
    expect(mainText).toContain("Personal-care hold");

    await shot(grace.page, "desk-queue-desktop");
    await grace.page.setViewportSize({ width: 360, height: 740 });
    await shot(grace.page, "desk-queue-360");

    await grace.context.close();
  });

  test("shows the family's exact words read-only, with a lock note and no edit action", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    const askId = await createAsk(marta.context, VERBATIM);

    const grace = await signIn(browser, seedAccessTokens.grace);
    const response = await grace.page.goto(`/desk/ask/${askId}`);
    expect(response?.status()).toBe(200);

    // Character-for-character, including the leading spaces and the line break.
    expect(
      await grace.page.getByTestId("desk-verbatim").textContent(),
    ).toBe(VERBATIM);

    await expect(grace.page.getByTestId("verbatim-lock")).toBeVisible();
    const lockText = await grace.page
      .getByTestId("verbatim-lock")
      .innerText();
    expect(lockText).toMatch(/Locked\./);
    expect(lockText).toMatch(/No one can edit them from this screen/i);
    expect(lockText).toMatch(/new version/i);

    // No edit affordance for the words: they are not inside a field, a form,
    // or anything contenteditable. (The same page carries the draft editor's
    // forms and fields, so this is scoped to the words themselves.)
    const fieldsAroundWords =
      await grace.page.getByTestId("desk-verbatim").evaluate((element) => {
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
    await expect(
      grace.page.getByTestId("desk-verbatim").getByRole("textbox"),
    ).toHaveCount(0);
    await expect(
      grace.page.getByTestId("desk-verbatim").locator("form"),
    ).toHaveCount(0);

    await shot(grace.page, "desk-ask-readonly");

    // A POST that tries to replace the words is refused by the page's method
    // gate, and the stored text is untouched. There is no server action that
    // accepts an edit.
    const refused = await grace.context.request.post(`/desk/ask/${askId}`, {
      data: { verbatimText: "replaced by a coordinator" },
      timeout: 30_000,
    });
    expect(refused.status()).toBe(405);
    expect(refused.headers()["allow"]).toContain("GET");

    // A forged Server Action request cannot reach an edit either: no action is
    // registered for a verbatim write, so Next refuses to run one.
    const forgedAction = await grace.context.request.post(
      `/desk/ask/${askId}`,
      {
        headers: { "Next-Action": "0".repeat(40) },
        data: { verbatimText: "replaced by a coordinator" },
        timeout: 30_000,
      },
    );
    expect(forgedAction.status()).toBeGreaterThanOrEqual(400);

    const stored = await db.client<{ verbatim_text: string }[]>`
      SELECT verbatim_text FROM ask WHERE id = ${askId}
    `;
    expect(stored[0].verbatim_text).toBe(VERBATIM);
    const revisions = await db.client<{ verbatim_text: string }[]>`
      SELECT verbatim_text FROM ask_revision WHERE ask_id = ${askId}
      ORDER BY created_at
    `;
    expect(revisions).toHaveLength(1);
    expect(revisions[0].verbatim_text).toBe(VERBATIM);

    await grace.context.close();
    await marta.context.close();
  });

  test("shows a calm empty state that names the next human action", async ({
    browser,
  }) => {
    await db.client`
      UPDATE ask
         SET status = 'closed'
       WHERE status IN ('waiting_coordinator', 'safety_hold', 'care_hold')
    `;

    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto("/desk");

    await expect(grace.page.getByTestId("desk-empty")).toBeVisible();
    await expect(grace.page.getByTestId("desk-empty")).toContainText(
      "No asks are waiting for a coordinator right now.",
    );
    await expect(grace.page.getByTestId("desk-empty")).toContainText("Next:");
    await expect(
      grace.page.getByRole("link", {
        name: "Open the Respite Morning board",
      }),
    ).toHaveAttribute("href", "/circle");
    await expect(grace.page.getByTestId("desk-row")).toHaveCount(0);

    await shot(grace.page, "desk-empty");
    await grace.context.close();
  });
});

import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { seedAccessTokens, seedIds } from "../../src/db/seed-data";
import { constructionBlockedForStatus } from "../../src/server/domain/slots";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-AUDITFIX-003 on the real desk surface.
 *
 * A coordinator who types personal-care instructions into a draft label or
 * orientation note is refused with the same sentence the Q9 hold uses. The
 * refusal is scoped to the field, the coordinator's typed words stay on screen
 * (React resets a form after its action, so the action hands them back), the
 * stored row is unchanged, and nothing carries the words to the congregation
 * board after the ask is published. A legitimate note still saves.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.\n\nShe loves hymns and tea, and she naps after lunch.";

const REFUSED_NOTE = "Could a volunteer change her pads in the morning?";
// One of the eleven exact strings from the round-2 audit (VAL-R2CARE-003):
// "change his nappies". The plain word a family uses must be refused in the
// label field the coordinator types into.
const REFUSED_LABEL = "Change his nappies";
const LEGIT_NOTE = "Two people for the first visit.";
const LEGIT_LABEL = "Home visit — Saturday";

const CARE_MESSAGE = constructionBlockedForStatus("care_hold")?.message ?? "";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "audit-draft-text",
);

type DraftRow = {
  id: string;
  kind: string;
  label: string;
  status: string;
  orientation_note: string | null;
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

async function draftsFor(db: E2eDatabase, askId: string): Promise<DraftRow[]> {
  return db.client<DraftRow[]>`
    SELECT id, kind, label, status, orientation_note
      FROM slot
     WHERE ask_id = ${askId}
     ORDER BY kind
  `;
}

async function askStatus(db: E2eDatabase, askId: string): Promise<string> {
  const [row] = await db.client<{ status: string }[]>`
    SELECT status FROM ask WHERE id = ${askId}
  `;
  return row.status;
}

async function openDeskAsk(page: Page, askId: string): Promise<void> {
  const response = await page.goto(`/desk/ask/${askId}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("draft-editor")).toBeVisible();
}

function card(page: Page, slotId: string): Locator {
  return page.locator(`[data-testid="draft-slot"][data-slot-id="${slotId}"]`);
}

async function storedDraft(
  db: E2eDatabase,
  slotId: string,
): Promise<{ label: string; orientation_note: string | null; status: string }> {
  const [row] = await db.client<
    { label: string; orientation_note: string | null; status: string }[]
  >`
    SELECT label, orientation_note, status
      FROM slot
     WHERE id = ${slotId}
  `;
  return row;
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

test.describe.configure({ timeout: 180_000 });

test.describe("VAL-AUDITFIX-003 — the draft editor refuses personal-care text", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    await db.client.end();
  });

  test("VAL-AUDITFIX-003 — refuses a label or a note, keeps the typed words, and publishes only the legitimate text", async ({
    browser,
  }) => {
    expect(CARE_MESSAGE).toMatch(/personal care/i);

    const marta = await signIn(browser, seedAccessTokens.marta);
    const askId = await createAsk(marta.context, HERO_ASK);
    await marta.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    await openDeskAsk(grace.page, askId);

    const homeRow = (await draftsFor(db, askId)).find(
      (row) => row.kind === "home",
    );
    expect(homeRow).toBeTruthy();
    if (!homeRow) return;

    const home = card(grace.page, homeRow.id);

    // 1. The orientation-note bypass.
    await home.getByTestId("draft-orientation").fill(REFUSED_NOTE);
    await home.getByTestId("draft-save").click();

    const noteError = grace.page.locator(
      `[id="${homeRow.id}-orientation-error"]`,
    );
    await expect(noteError).toHaveAttribute("role", "alert", {
      timeout: 20_000,
    });
    await expect(noteError).toHaveText(CARE_MESSAGE);
    // The coordinator's typed words are still there; the form did not reset.
    await expect(home.getByTestId("draft-orientation")).toHaveValue(
      REFUSED_NOTE,
    );
    await expect(home.getByTestId("draft-label")).toHaveValue(homeRow.label);
    await shot(grace.page, "note-refused");

    let stored = await storedDraft(db, homeRow.id);
    expect(stored.orientation_note).toBe(homeRow.orientation_note);
    expect(stored.label).toBe(homeRow.label);
    expect(stored.status).toBe("draft");
    expect(await askStatus(db, askId)).toBe("waiting_coordinator");

    // 2. The label bypass.
    await home.getByTestId("draft-label").fill(REFUSED_LABEL);
    await home.getByTestId("draft-orientation").fill(LEGIT_NOTE);
    await home.getByTestId("draft-save").click();

    const labelError = grace.page.locator(
      `[id="${homeRow.id}-label-error"]`,
    );
    await expect(labelError).toHaveAttribute("role", "alert", {
      timeout: 20_000,
    });
    await expect(labelError).toHaveText(CARE_MESSAGE);
    await expect(home.getByTestId("draft-label")).toHaveValue(REFUSED_LABEL);
    await expect(home.getByTestId("draft-orientation")).toHaveValue(
      LEGIT_NOTE,
    );
    await shot(grace.page, "label-refused");

    stored = await storedDraft(db, homeRow.id);
    expect(stored.label).toBe(homeRow.label);
    expect(stored.orientation_note).toBe(homeRow.orientation_note);
    expect(stored.status).toBe("draft");

    // 3. A legitimate note and label still save.
    await home.getByTestId("draft-label").fill(LEGIT_LABEL);
    await home.getByTestId("draft-orientation").fill(LEGIT_NOTE);
    await home.getByTestId("draft-save").click();
    await expect(home.getByTestId("draft-feedback")).toHaveText(
      /Saved\. It is still a draft/,
      // Saving also refreshes the exclusion explanations; the Neon round trip
      // is ~325 ms from this host, so the action takes longer than one write.
      { timeout: 20_000 },
    );

    stored = await storedDraft(db, homeRow.id);
    expect(stored.label).toBe(LEGIT_LABEL);
    expect(stored.orientation_note).toBe(LEGIT_NOTE);
    expect(stored.status).toBe("draft");

    await grace.page.reload();
    const saved = card(grace.page, homeRow.id);
    await expect(saved.getByTestId("draft-label")).toHaveValue(LEGIT_LABEL);
    await expect(saved.getByTestId("draft-orientation")).toHaveValue(
      LEGIT_NOTE,
    );

    // 4. Publish the ask, then read the congregation board.
    await grace.page.getByTestId("approve-ask").click();
    await expect(grace.page.getByTestId("ask-review")).toHaveAttribute(
      "data-status",
      "approved",
      { timeout: 60_000 },
    );
    expect(await askStatus(db, askId)).toBe("approved");
    await shot(grace.page, "approved-with-legitimate-note");
    await grace.context.close();

    // No slot row anywhere carries the refused words.
    const [scan] = await db.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
        FROM slot
       WHERE church_id = ${seedIds.church}
         AND (label ILIKE '%pads%' OR orientation_note ILIKE '%pads%'
              OR label ILIKE '%nappies%' OR orientation_note ILIKE '%nappies%'
              OR label ILIKE '%wash and get dressed%'
              OR orientation_note ILIKE '%wash and get dressed%')
    `;
    expect(scan.count).toBe(0);

    const ruth = await signIn(browser, seedAccessTokens.ruth);
    const response = await ruth.page.goto("/circle");
    expect(response?.status()).toBe(200);

    const published = ruth.page
      .getByTestId("board-slot")
      .filter({ hasText: LEGIT_LABEL })
      .first();
    await expect(published).toBeVisible();

    const body = await ruth.page.locator("body").innerText();
    expect(body).not.toMatch(/pads|nappies/i);
    expect(body).not.toContain(CARE_MESSAGE);
    expect(body).not.toContain(REFUSED_NOTE);

    // The server-rendered board payload is clean too, not just the visible text.
    const boardResponse = await ruth.context.request.get("/circle");
    expect(boardResponse.status()).toBe(200);
    const html = await boardResponse.text();
    expect(html).not.toMatch(/pads|nappies/i);
    expect(html).not.toContain(REFUSED_NOTE);

    await shot(ruth.page, "board-with-legitimate-label");
    await ruth.context.close();
  });
});

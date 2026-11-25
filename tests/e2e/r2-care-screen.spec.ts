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
import { NEVER_COMMITMENTS } from "../../src/lib/trust-content";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-R2CARE-003 and VAL-R2CARE-004 on the real surface.
 *
 * A caregiver writes one of the audit's plain personal-care phrases — "change
 * his nappies". The ask stops at a care hold, no slot row exists, and the
 * receipt a family actually reads offers no time and names what happens next.
 * The coordinator's desk refuses the ask entirely rather than letting a draft
 * be typed around the hold, and both public promises are read back verbatim:
 * `/never` says the ask stops with no times proposed, and `/promises` carries
 * the signed "No personal care, ever."
 *
 * The label/note screen itself is driven in `audit-draft-text.spec.ts`, which
 * types the same audited word into a real draft. This spec covers the other
 * entry point and the two pages a family and a neighbour can read.
 */

const CARE_ASK =
  "Could someone change his nappies before bed on Saturday? He is fine with people he knows and loves hymns.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "r2-draft-screen-personal-care",
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

async function askStatus(
  db: E2eDatabase,
  askId: string,
): Promise<string | null> {
  const rows = await db.client<{ status: string }[]>`
    SELECT status FROM ask WHERE id = ${askId}
  `;
  return rows[0]?.status ?? null;
}

async function slotCount(db: E2eDatabase, askId: string): Promise<number> {
  const [row] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM slot WHERE ask_id = ${askId}
  `;
  return Number(row.count);
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

test.describe.configure({ timeout: 180_000 });

test.describe("VAL-R2CARE-003 and VAL-R2CARE-004 — personal care stops at a person", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    await db.client.end();
  });

  test("a plain personal-care phrase ends at a human, and both public promises read true", async ({
    browser,
  }) => {
    const priya = await signIn(browser, seedAccessTokens.priya);
    const askId = await createAsk(priya.context, CARE_ASK);

    // The ask route stops before a single time is proposed.
    expect(await askStatus(db, askId)).toBe("care_hold");
    expect(await slotCount(db, askId)).toBe(0);

    // 1. The receipt the family actually reads: no time, and the next human
    //    step in plain words.
    const receiptResponse = await priya.page.goto(`/ask/${askId}`);
    expect(receiptResponse?.status()).toBe(200);

    await expect(priya.page.getByTestId("ask-status")).toHaveText(
      "Grace will call you about this",
    );
    const banner = priya.page.getByTestId("care-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Personal care is not arranged here");
    await expect(banner).toContainText(
      "Next step: Grace calls you about professional respite referrals",
    );
    await expect(banner).toContainText(
      "No time or visit is arranged for this from here",
    );

    const receiptText = await priya.page.locator("#main").innerText();
    expect(receiptText).not.toMatch(/times? (?:are|is) offered/i);
    expect(receiptText).not.toMatch(/time offered/i);
    await shot(priya.page, "caregiver-receipt-no-times");
    await priya.context.close();

    // 2. The coordinator's desk refuses the ask as a whole: no draft editor,
    //    no manual add, and the reason on screen.
    const grace = await signIn(browser, seedAccessTokens.grace);
    const deskResponse = await grace.page.goto(`/desk/ask/${askId}`);
    expect(deskResponse?.status()).toBe(200);

    const holdCard = grace.page.getByTestId("hold-card");
    await expect(holdCard).toBeVisible();
    await expect(holdCard).toHaveAttribute("data-kind", "personal_care");
    await expect(grace.page.getByTestId("hold-title")).toHaveText(
      "Personal care is not arranged here",
    );
    await expect(grace.page.getByTestId("draft-add")).toHaveCount(0);
    await expect(
      grace.page.getByTestId("draft-construction-refused"),
    ).toContainText(/professional help|personal care/i);
    await shot(grace.page, "desk-care-hold-no-draft");
    expect(await slotCount(db, askId)).toBe(0);

    // 3. `/never`: the quoted commitment, read from the page a neighbour sees.
    const neverResponse = await grace.page.goto("/never");
    expect(neverResponse?.status()).toBe(200);

    const careCommitmentCopy =
      NEVER_COMMITMENTS.find((entry) => entry.id === "no-personal-care")?.body ??
      "";
    expect(careCommitmentCopy).toContain(
      "If your words raise them, the ask stops, no times are proposed",
    );
    const careCommitment = grace.page
      .getByTestId("commitment")
      .filter({ hasText: "No personal care as a slot" });
    await expect(careCommitment).toContainText(careCommitmentCopy);
    await expect(careCommitment).toContainText("going to the toilet");
    await expect(careCommitment).toContainText("brushing teeth");
    await shot(grace.page, "never-personal-care-commitment");

    // 4. `/promises`: the signed sentence, read from the page a family sees.
    const promisesResponse = await grace.page.goto("/promises");
    expect(promisesResponse?.status()).toBe(200);
    const promise = grace.page.getByText(/^No personal care, ever\./);
    await expect(promise).toBeVisible();
    await expect(promise).toContainText("Area Agency on Aging");
    await expect(promise).toContainText("ARCH Respite Locator");
    await shot(grace.page, "promises-no-personal-care-ever");
    await grace.context.close();
  });
});

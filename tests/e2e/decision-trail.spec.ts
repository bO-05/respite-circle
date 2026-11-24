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
import { sha256Hex } from "../../src/server/services/decision-contract";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-DECIDE-003 and VAL-DECIDE-004 on the real surface.
 *
 * The trail is read from the real server and the real database: nine typed
 * answers for the exact revision shown, the model's stated confidence, the
 * model/provider/latency, abstentions as a human handoff, safety and
 * personal-care banners, the policy version, the digest, and the plain-code
 * note. A revision re-runs the nine questions; earlier answers never appear on
 * the page again.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.\n\nShe loves hymns and tea, and she naps after lunch.";

const REVISED_ASK =
  "I need a ride to her appointment on Saturday. She can't be alone for long, and she loves hymns and tea.";

const SPANISH_ASK =
  "Mi mamá necesita ayuda el sábado. No puede estar sola y yo trabajo todo el día.";

// Q3 sees both a meal need and "meals are covered", so the rules engine
// abstains at 0.45 instead of guessing. The ask is otherwise ordinary.
const CONTRADICTORY_MEAL_ASK =
  "She needs meals delivered, but meals are covered by the church. She cannot be alone on Saturday and would love company.";

const SAFETY_ASK =
  "She fell last week and I am scared she will wander out of the house.";

const CARE_ASK = "I need help with bathing and remembering her medication.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "decision-trail",
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
  revisionOf?: string,
): Promise<{
  askId: string;
  revisionId: string;
  decisionsRan: boolean;
  decisionsPersisted: boolean;
}> {
  const response = await context.request.post("/api/asks", {
    data: { text, consent: true, ...(revisionOf ? { revisionOf } : {}) },
    // The first write after a cold Neon compute can take longer than
    // Playwright's 10 s default; the documented wake is 5.4–5.6 s.
    timeout: 45_000,
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as {
    askId: string;
    revisionId: string;
    decisionsRan: boolean;
    decisionsPersisted: boolean;
  };
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

async function readAskStatus(
  db: E2eDatabase,
  askId: string,
): Promise<string> {
  const rows = await db.client<{ status: string }[]>`
    SELECT status FROM ask WHERE id = ${askId}
  `;
  return rows[0].status;
}

async function countSlots(db: E2eDatabase, askId: string): Promise<number> {
  const [row] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM slot WHERE ask_id = ${askId}
  `;
  return row.count;
}

test.describe("decision trail", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    await db.client.end();
  });

  test("shows Q1–Q9, the model's stated confidence, metadata, policy, digest, and the receipt first", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, seedAccessTokens.marta);
    const created = await createAsk(context, HERO_ASK);

    const response = await page.goto(`/ask/${created.askId}`);
    expect(response?.status()).toBe(200);

    // The receipt the caregiver already knows comes first and is unchanged.
    expect(await page.getByTestId("caregiver-verbatim").textContent()).toBe(
      HERO_ASK,
    );
    await expect(page.getByTestId("ask-status")).toHaveText(
      /with Grace — not read yet/i,
    );
    await expect(
      page.getByText(
        "Grace reads every ask first. Nothing is shown to anyone until she approves it.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /what's covered for my family/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /tell us about another week/i }),
    ).toBeVisible();

    // The trail sits below the receipt.
    const trail = page.getByTestId("decision-trail");
    await expect(trail).toBeVisible();
    await expect(page.getByTestId("trail-revision")).toHaveText(
      "These answers are about your first words.",
    );
    await expect(page.getByTestId("decision-list").locator("li")).toHaveCount(
      9,
    );
    await expect(
      trail.locator('[data-testid="decision-answer"]'),
    ).toHaveCount(9);
    await expect(
      trail.getByText("the model's stated confidence"),
    ).toHaveCount(9);

    await expect(page.getByTestId("decision-Q1")).toContainText("Yes");
    await expect(page.getByTestId("decision-Q4")).toContainText("Saturday");
    await expect(page.getByTestId("decision-Q9")).toContainText("No");

    const metadata = page.getByTestId("trail-run-metadata");
    await expect(metadata).toContainText("rule-engine-v1");
    await expect(metadata).toContainText("deterministic");
    await expect(metadata).toContainText(/Latency \d/);

    await expect(page.getByTestId("trail-digest")).toContainText(
      /[0-9a-f]{64}/,
    );
    await expect(page.getByTestId("trail-policy")).toContainText(
      "policy version 1",
    );
    await expect(page.getByTestId("rules-banner")).toContainText(
      "Auto-filled by rules, not AI — please verify.",
    );

    await expect(page.getByTestId("plain-code-note")).toContainText(
      "Plain code — not the model — builds every proposed time",
    );
    await expect(page.getByTestId("publication-state")).toContainText(
      "Nothing has been published yet.",
    );

    // No generated sentence about either person, and no model text at all.
    const trailText = (await trail.textContent()) ?? "";
    expect(trailText).not.toContain("Marta");
    expect(trailText).not.toContain("Elena");
    expect(trailText).not.toContain("GENERATED_PROSE_CANARY");
    expect(trailText).not.toContain(HERO_ASK.slice(0, 40));

    // The digest is of the exact words, not of a prompt or a summary.
    const [revision] = await db.client<{ digest: string }[]>`
      SELECT digest FROM ask_revision WHERE id = ${created.revisionId}
    `;
    expect(revision.digest).toBe(sha256Hex(HERO_ASK));

    await shot(page, "trail-nine-answers");
    await context.close();
  });

  test("re-runs the nine answers on a revision and names the revision it answered", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, seedAccessTokens.marta);
    const created = await createAsk(context, HERO_ASK);
    const revised = await createAsk(context, REVISED_ASK, created.askId);

    expect(revised.decisionsRan).toBe(true);
    expect(revised.decisionsPersisted).toBe(true);
    expect(revised.revisionId).not.toBe(created.revisionId);

    await page.goto(`/ask/${created.askId}`);
    expect(await page.getByTestId("caregiver-verbatim").textContent()).toBe(
      REVISED_ASK,
    );
    await expect(page.getByTestId("trail-revision")).toContainText(
      "version 2 of your words",
    );
    await expect(page.getByTestId("trail-revision")).toContainText(
      "latest wording",
    );

    // The latest wording asks for a ride; the superseded wording did not.
    await expect(
      page.getByTestId("decision-Q2").getByTestId("decision-answer"),
    ).toHaveText("Yes");

    const rows = await db.client<
      { ask_revision_id: string; question_id: string; answer: unknown }[]
    >`
      SELECT ask_revision_id, question_id, answer
        FROM decision
       WHERE ask_id = ${created.askId}
    `;
    expect(rows).toHaveLength(18);
    const firstRun = rows.filter(
      (row) => row.ask_revision_id === created.revisionId,
    );
    const secondRun = rows.filter(
      (row) => row.ask_revision_id === revised.revisionId,
    );
    expect(firstRun).toHaveLength(9);
    expect(secondRun).toHaveLength(9);
    expect(
      firstRun.find((row) => row.question_id === "Q2")?.answer,
    ).toBe(false);
    expect(
      secondRun.find((row) => row.question_id === "Q2")?.answer,
    ).toBe(true);

    await shot(page, "trail-revision-2");
    await context.close();
  });

  test("abstains on a contradictory answer instead of guessing, and waits for a person", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, seedAccessTokens.marta);
    const created = await createAsk(context, CONTRADICTORY_MEAL_ASK);

    await page.goto(`/ask/${created.askId}`);

    const q3 = page.getByTestId("decision-Q3");
    await expect(q3.getByTestId("decision-abstention")).toHaveText(
      "This isn't mine to answer — a person will decide.",
    );
    await expect(q3.getByTestId("decision-answer")).toHaveCount(0);
    await expect(q3).toContainText("the model's stated confidence: 45%");

    // The other questions are still answered; only Q3 is handed off.
    await expect(
      page.getByTestId("decision-Q1").getByTestId("decision-answer"),
    ).toHaveText("Yes");
    await expect(page.getByTestId("decision-list").locator("li")).toHaveCount(
      9,
    );
    await expect(page.locator('[data-testid="decision-abstention"]')).toHaveCount(
      1,
    );

    expect(await readAskStatus(db, created.askId)).toBe("waiting_coordinator");
    expect(await countSlots(db, created.askId)).toBe(0);

    await shot(page, "trail-contradictory-abstention");
    await context.close();
  });

  test("names a bilingual handoff on the trail and the desk, with no guessed answer and no slot", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, seedAccessTokens.marta);
    const created = await createAsk(context, SPANISH_ASK);

    await page.goto(`/ask/${created.askId}`);

    // The page says why a person is needed instead of implying the model was
    // unsure about the family.
    const notice = page.getByTestId("trail-bilingual");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText(/written in Spanish/i);
    await expect(notice).toHaveText(/nothing was translated or guessed/i);
    await expect(notice).toHaveText(/no time is proposed/i);

    const abstentions = page.locator('[data-testid="decision-abstention"]');
    await expect(abstentions).toHaveCount(9);
    for (let index = 0; index < 9; index += 1) {
      await expect(abstentions.nth(index)).toHaveText(
        "This was written in Spanish. A bilingual person will read it with you.",
      );
    }

    await expect(page.getByTestId("decision-Q1")).toContainText(
      "A bilingual person will read it with you.",
    );
    await expect(
      page.getByTestId("decision-Q1").getByTestId("decision-answer"),
    ).toHaveCount(0);
    await expect(page.getByTestId("decision-list")).not.toContainText(
      "answers uncertain",
    );
    await expect(page.getByTestId("trail-run-metadata")).toContainText(
      "language-router-v1",
    );
    await expect(page.getByTestId("publication-state")).toContainText(
      "Nothing has been published yet.",
    );

    const [stored] = await db.client<
      { language: string; bilingual_needed: boolean }[]
    >`
      SELECT language, bilingual_needed FROM ask WHERE id = ${created.askId}
    `;
    expect(stored.language).toBe("es");
    expect(stored.bilingual_needed).toBe(true);
    expect(await readAskStatus(db, created.askId)).toBe("waiting_coordinator");
    expect(await countSlots(db, created.askId)).toBe(0);

    await shot(page, "trail-abstention");
    await context.close();

    // The coordinator's queue row and detail name the same handoff.
    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto("/desk");
    const deskRow = grace.page.locator(
      `[data-testid="desk-row"][data-ask-id="${created.askId}"]`,
    );
    await expect(deskRow).toHaveAttribute("data-bilingual", "true");
    await expect(deskRow.getByTestId("desk-reason-summary")).toHaveText(
      "Written in Spanish — a bilingual person is needed. No English answers were guessed.",
    );

    await grace.page.goto(`/desk/ask/${created.askId}`);
    await expect(grace.page.getByTestId("desk-detail-bilingual")).toHaveText(
      "Written in Spanish — a bilingual person is needed. No English answers were guessed.",
    );
    await shot(grace.page, "desk-bilingual-handoff");
    await grace.context.close();
  });

  test("shows the safety banner and next human step for a safety hold", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, seedAccessTokens.marta);
    const created = await createAsk(context, SAFETY_ASK);

    await page.goto(`/ask/${created.askId}`);

    const banner = page.getByTestId("safety-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Safety comes first.");
    await expect(banner).toContainText("Next step: Grace calls you today");
    await expect(banner).toContainText("call 911");
    await expect(banner).toContainText("call or text 988");
    await expect(banner.getByRole("link", { name: "988" })).toHaveAttribute(
      "href",
      "tel:988",
    );
    await expect(banner.getByRole("link", { name: "911" })).toHaveAttribute(
      "href",
      "tel:911",
    );
    await expect(page.getByTestId("care-banner")).toHaveCount(0);
    await expect(page.getByTestId("ask-status")).toContainText(
      "Grace will call you today",
    );
    await expect(page.getByTestId("publication-state")).toContainText(
      "Nothing has been published yet.",
    );

    expect(await readAskStatus(db, created.askId)).toBe("safety_hold");
    expect(await countSlots(db, created.askId)).toBe(0);

    await shot(page, "trail-safety-hold");
    await context.close();
  });

  test("shows the personal-care banner and human referrals for a care hold", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, seedAccessTokens.marta);
    const created = await createAsk(context, CARE_ASK);

    await page.goto(`/ask/${created.askId}`);

    const banner = page.getByTestId("care-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Personal care is not arranged here.");
    await expect(banner).toContainText("professional respite referrals");
    await expect(banner).toContainText("Next step: Grace calls you");
    await expect(banner).not.toContainText("call 911");
    await expect(page.getByTestId("safety-banner")).toHaveCount(0);
    await expect(page.getByTestId("ask-status")).toContainText(
      "Grace will call you about this",
    );

    expect(await readAskStatus(db, created.askId)).toBe("care_hold");
    expect(await countSlots(db, created.askId)).toBe(0);

    await shot(page, "trail-personal-care-hold");
    await context.close();
  });

  test("another caregiver cannot open the trail by guessing its address", async ({
    browser,
  }) => {
    const { context: martaContext } = await signIn(
      browser,
      seedAccessTokens.marta,
    );
    const created = await createAsk(martaContext, HERO_ASK);
    await martaContext.close();

    const { context, page } = await signIn(browser, seedAccessTokens.david);
    const response = await page.goto(`/ask/${created.askId}`);
    expect(response?.status()).toBe(404);

    const body = await page.content();
    expect(body).not.toContain("Hymns");
    expect(body).not.toContain("the model's stated confidence");
    await expect(page.getByTestId("decision-trail")).toHaveCount(0);
    await context.close();
  });
});

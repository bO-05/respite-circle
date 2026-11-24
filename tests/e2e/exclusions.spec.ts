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
 * VAL-DESK-008 on the real surface.
 *
 * The coordinator's "why a volunteer was not proposed" panel shows every active
 * volunteer against every draft time, the exact rule that stopped a proposal,
 * the fix, and its owner. Nothing is ranked or scored. Changing a volunteer's
 * record changes the explanation on the next check. Caregivers and volunteers
 * never receive the panel or its rule codes.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.\n\nShe loves hymns and tea, and she naps after lunch.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "exclusions",
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
    // The first write after a cold Neon compute can exceed the 10 s default.
    timeout: 45_000,
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { askId: string };
  return body.askId;
}

async function openDeskAsk(page: Page, askId: string): Promise<void> {
  const response = await page.goto(`/desk/ask/${askId}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("exclusion-panel")).toBeVisible();
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

function rowFor(
  page: Page,
  slotKind: "companion" | "home",
  volunteerId: string,
) {
  return page.locator(
    `[data-testid="exclusion-slot"][data-kind="${slotKind}"] [data-testid="exclusion-row"][data-volunteer-id="${volunteerId}"]`,
  );
}

const RULE_CODES = [
  "no_checklist",
  "checklist_expired",
  "not_familiar",
  "unavailable_window",
  "already_serving_twice",
  "no_driver_policy",
  "driver_not_ok",
];

test.describe.configure({ timeout: 150_000 });

test.describe("VAL-DESK-008 — why a volunteer was not proposed", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    await db.client.end();
  });

  test("VAL-DESK-008 — shows every volunteer, the rule, the fix, and the owner on each draft time", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    const askId = await createAsk(marta.context, HERO_ASK);
    await marta.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    await openDeskAsk(grace.page, askId);

    await expect(
      grace.page.getByRole("heading", {
        name: "Why a volunteer was not proposed",
      }),
    ).toBeVisible();
    await expect(grace.page.getByTestId("exclusion-desk-only")).toContainText(
      "caregiver and a volunteer never see it",
    );
    await expect(grace.page.getByTestId("exclusion-no-ranking")).toContainText(
      "alphabetical",
    );
    await expect(grace.page.getByTestId("exclusion-no-ranking")).toContainText(
      "no score",
    );

    const slots = grace.page.getByTestId("exclusion-slot");
    await expect(slots).toHaveCount(2);

    const homes = grace.page.locator(
      '[data-testid="exclusion-slot"][data-kind="home"]',
    );
    await expect(homes).toHaveCount(1);
    await expect(
      homes.locator('[data-testid="exclusion-row"]'),
    ).toHaveCount(4);

    // Alphabetical, not ranked.
    await expect(
      homes.locator('[data-testid="exclusion-row"]'),
    ).toHaveText([
      /Ben Osei/,
      /Ruth Kim/,
      /Sara Bennett/,
      /Tom Nguyen/,
    ]);

    const tom = rowFor(grace.page, "home", seedIds.people.tom);
    await expect(tom).toHaveAttribute("data-eligible", "false");
    await expect(tom).toHaveAttribute("data-rule-code", "no_checklist");
    await expect(tom.getByTestId("exclusion-rule-code")).toHaveText(
      "no_checklist",
    );
    await expect(tom.getByTestId("exclusion-rule")).toContainText(
      "Safeguarding checklist not complete",
    );
    await expect(tom.getByTestId("exclusion-fix")).toContainText(
      /checklist/i,
    );
    await expect(tom.getByTestId("exclusion-owner")).toHaveText("Coordinator");

    const ruth = rowFor(grace.page, "home", seedIds.people.ruth);
    await expect(ruth).toHaveAttribute("data-eligible", "true");
    await expect(ruth.getByTestId("exclusion-result")).toHaveText(
      "Could be asked",
    );

    const companionRows = grace.page.locator(
      '[data-testid="exclusion-slot"][data-kind="companion"] [data-testid="exclusion-row"]',
    );
    await expect(companionRows).toHaveCount(4);
    for (const volunteerId of [
      seedIds.people.ruth,
      seedIds.people.sara,
      seedIds.people.tom,
      seedIds.people.ben,
    ]) {
      await expect(rowFor(grace.page, "companion", volunteerId)).toHaveAttribute(
        "data-eligible",
        "true",
      );
    }

    // The legend names every rule family a judge or coordinator can ask about.
    const legend = grace.page.getByTestId("exclusion-legend");
    for (const code of RULE_CODES) {
      await expect(
        legend.locator(`[data-rule-code="${code}"]`),
      ).toBeVisible();
    }
    await expect(legend).toContainText("No volunteer-driver policy signed");
    await expect(legend).toContainText("Already serving twice that day");

    // No score or priority control exists anywhere in the panel.
    await expect(
      grace.page.locator('[data-testid*="score"], [data-testid*="priority"]'),
    ).toHaveCount(0);
    await expect(grace.page.getByTestId("exclusion-panel")).not.toContainText(
      /priority/i,
    );

    await shot(grace.page, "exclusion-panel");
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await grace.page.getByTestId("exclusion-panel").screenshot({
      path: path.join(EVIDENCE_DIR, "exclusion-panel-only.png"),
    });
    await grace.context.close();
  });

  test("changes the explanation when a volunteer's record changes", async ({
    browser,
  }) => {
    // Start from the seeded "no checklist" state even after a retry, because a
    // retry reuses the same database and the previous attempt may have fixed
    // Tom's record already.
    await db.client`
      UPDATE volunteer
         SET checklist_completed_at = NULL,
             checklist_version = NULL,
             references_contacted = 1,
             training_expires_on = '2027-01-15',
             background_renews_on = '2026-12-30'
       WHERE person_id = ${seedIds.people.tom}
    `;

    const marta = await signIn(browser, seedAccessTokens.marta);
    const askId = await createAsk(marta.context, HERO_ASK);
    await marta.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    await openDeskAsk(grace.page, askId);

    const tom = rowFor(grace.page, "home", seedIds.people.tom);
    await expect(tom).toHaveAttribute("data-rule-code", "no_checklist");
    await shot(grace.page, "exclusion-before-change");

    // Record a current checklist, two references, and current dated checks.
    await db.client`
      UPDATE volunteer
         SET checklist_completed_at = '2026-10-01T14:00:00.000Z',
             checklist_version = 'safeguarding-2026.1',
             references_contacted = 2,
             training_expires_on = '2027-09-30',
             background_renews_on = '2027-09-30'
       WHERE person_id = ${seedIds.people.tom}
    `;

    // The recorded explanation is still the old one until a check runs.
    await grace.page.reload();
    await expect(grace.page.getByTestId("exclusion-panel")).toBeVisible();
    await expect(rowFor(grace.page, "home", seedIds.people.tom)).toHaveAttribute(
      "data-rule-code",
      "no_checklist",
    );

    await grace.page.getByTestId("exclusion-reevaluate").click();
    // The action re-evaluates every pair and re-renders the page; the Neon round
    // trip is ~325 ms, so give the whole server action realistic headroom.
    await expect(grace.page.getByTestId("exclusion-feedback")).toContainText(
      "Checked 4 active volunteers",
      { timeout: 45_000 },
    );

    const updated = rowFor(grace.page, "home", seedIds.people.tom);
    await expect(updated).toHaveAttribute("data-eligible", "true");
    await expect(updated).toHaveAttribute("data-rule-code", "eligible");
    await expect(updated.getByTestId("exclusion-result")).toHaveText(
      "Could be asked",
    );
    await shot(grace.page, "exclusion-after-change");
    await grace.context.close();
  });

  test("never reaches a caregiver or a volunteer", async ({ browser }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    const askId = await createAsk(marta.context, HERO_ASK);

    const care = await marta.page.goto("/care");
    expect(care?.status()).toBe(200);
    const careBody = await marta.page.content();
    expect(careBody).not.toContain("exclusion-panel");
    expect(careBody).not.toContain("Why a volunteer was not proposed");
    for (const code of RULE_CODES) {
      expect(careBody).not.toContain(code);
    }

    const trail = await marta.page.goto(`/ask/${askId}`);
    expect(trail?.status()).toBe(200);
    const trailBody = await marta.page.content();
    expect(trailBody).not.toContain("Why a volunteer was not proposed");
    for (const code of RULE_CODES) {
      expect(trailBody).not.toContain(code);
    }

    // A direct request for the desk review is refused for a caregiver, and the
    // refusal carries none of the panel's data.
    const refused = await marta.context.request.get(`/desk/ask/${askId}`, {
      maxRedirects: 0,
    });
    expect([307, 403]).toContain(refused.status());
    const refusedBody = await refused.text();
    expect(refusedBody).not.toContain("Why a volunteer was not proposed");
    for (const code of RULE_CODES) {
      expect(refusedBody).not.toContain(code);
    }
    await marta.context.close();

    const ruth = await signIn(browser, seedAccessTokens.ruth);
    const circle = await ruth.page.goto("/circle");
    expect(circle?.status()).toBe(200);
    const circleBody = await ruth.page.content();
    expect(circleBody).not.toContain("exclusion-panel");
    expect(circleBody).not.toContain("Why a volunteer was not proposed");
    for (const code of RULE_CODES) {
      expect(circleBody).not.toContain(code);
    }
    await ruth.context.close();
  });
});

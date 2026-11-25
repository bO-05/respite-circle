import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { DEMO_IDS, DEMO_TEXT } from "../../src/db/demo-state";
import { seedAccessTokens } from "../../src/db/seed-data";
import { E2E_RESET_PATH, E2E_RESET_TOKEN } from "./helpers/e2e-env";

/**
 * VAL-R2PROM-003 — the caregiver is never told they hold a power they do not
 * have.
 *
 * The receipt used to say "If a time can be offered, you decide whether it
 * helps" and "Nothing is decided without you". No caregiver-reachable server
 * action accepts or declines a time: every `"use server"` module is scoped to
 * the desk roles (proven by `tests/unit/caregiver-agency.test.ts`), and the
 * only caregiver slot action keeps a thank-you after the time is done.
 *
 * This spec reads the rendered receipt on Marta's approved ask — a published
 * time already on the board — and asserts that the page names the real
 * decision point instead: the call, and the coordinator. It also asserts the
 * page offers no accept/decline control, because a sentence may never be the
 * only thing that grants a decision.
 *
 * Screenshots land in `.research/validation-runs/r2-receipt-agency/`.
 */

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "r2-receipt-agency",
);

const HERO_RECEIPT = `/ask/${DEMO_IDS.askHero}`;

/** Every shape of the claim the receipt must not make. */
const CLAIMED_POWER =
  /\byou (decide|approve|accept|decline)\b|\byour (decision|approval)\b|\bnothing is decided without you\b/i;

/** Words that would name a control for accepting or declining a time. */
const DECISION_CONTROL = /\b(accept|decline|approve)\b/i;

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
  expect((await response.json()).reset).toBe(true);
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

/** The labels of every control a mouse or keyboard could press. */
async function controlLabels(page: Page): Promise<string[]> {
  return page
    .locator("button, a, input[type=submit], input[type=button]")
    .evaluateAll((nodes) =>
      nodes
        .map((node) =>
          (
            (node as HTMLInputElement).value ||
            node.textContent ||
            ""
          ).trim(),
        )
        .filter(Boolean),
    );
}

test.describe.configure({ timeout: 180_000 });

test.describe("VAL-R2PROM-003 — the receipt names the real decision point", () => {
  test("the caregiver receipt gives no power the app cannot take", async ({
    browser,
    request,
  }) => {
    await reset(request);
    const marta = await signIn(browser, seedAccessTokens.marta);

    // The hero ask is approved, so a published time exists while the family
    // reads this page: the state where "you decide whether it helps" used to
    // do the most damage.
    const receiptResponse = await marta.page.goto(HERO_RECEIPT);
    expect(receiptResponse?.status()).toBe(200);
    await expect(marta.page.getByTestId("ask-status")).toHaveText(
      "Approved by Grace",
    );

    const nextSteps = marta.page.locator(
      'section[aria-labelledby="what-happens-next"]',
    );
    await expect(nextSteps).toBeVisible();
    const copy = await nextSteps.innerText();

    // 1. No sentence claims a decision the app cannot record.
    expect(
      copy,
      `rendered "What happens next":\n${copy}`,
    ).not.toMatch(CLAIMED_POWER);
    expect(copy).not.toContain("you decide whether it helps");
    expect(copy).not.toContain("Nothing is decided without you");

    // 2. It names the real decision point in plain words: the call, and the
    //    coordinator. A reader can say what happens next.
    expect(copy).toContain("Grace may call to talk the week through");
    expect(copy).toContain(
      "If a time does not suit you, tell Grace on the phone",
    );
    expect(copy).toContain("there is no button here to say whether it helps");
    expect(copy).toContain(
      "Nothing is shown to a neighbour until Grace approves it",
    );

    // 3. The rest of the receipt is unchanged: the exact words, the status,
    //    and all nine typed answers.
    await expect(marta.page.getByTestId("caregiver-verbatim")).toHaveText(
      DEMO_TEXT.hero,
    );
    await expect(marta.page.getByTestId("decision-list").locator("li")).toHaveCount(
      9,
    );
    await expect(
      marta.page.getByRole("heading", {
        name: "The nine answers about your words",
      }),
    ).toBeVisible();

    // 4. No control on the page accepts or declines a time. The sentence and
    //    the surface agree.
    const labels = await controlLabels(marta.page);
    expect(
      labels.filter((label) => DECISION_CONTROL.test(label)),
      `controls: ${labels.join(" | ")}`,
    ).toEqual([]);

    const formActions = await marta.page
      .locator("form")
      .evaluateAll((forms) =>
        forms.map((form) => form.getAttribute("action") ?? ""),
      );
    expect(
      formActions.filter((action) => DECISION_CONTROL.test(action)),
      `form actions: ${formActions.join(" | ")}`,
    ).toEqual([]);
    await expect(
      marta.page.locator('[data-testid*="accept"], [data-testid*="decline"]'),
    ).toHaveCount(0);

    await shot(marta.page, "receipt-real-decision-point");
    // The quoted sentences, kept beside the screenshot for the validator.
    await writeFile(
      path.join(EVIDENCE_DIR, "what-happens-next.txt"),
      `${copy}\n`,
      "utf8",
    );

    // 5. The care page carries no such claim either.
    const careResponse = await marta.page.goto("/care");
    expect(careResponse?.status()).toBe(200);
    const careText = await marta.page.locator("#main").innerText();
    expect(
      careText,
      `rendered care page:\n${careText}`,
    ).not.toMatch(CLAIMED_POWER);
    await shot(marta.page, "care-no-claimed-power");

    await marta.context.close();
  });
});

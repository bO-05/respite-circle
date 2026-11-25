import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { seedAccessTokens } from "../../src/db/seed-data";

/**
 * VAL-R2PROM-004 and VAL-R2PROM-008 — the desk states the whole rule and the
 * demo states what it actually does.
 *
 * The desk audit page used to end its lead by handing a person every decision
 * the AI did not make; the low-risk meal makes that false. The demo page said
 * nothing about which part of the board the live model produces. This spec
 * reads the served pages, and renders a reset receipt from a canned run where
 * the model and the church's policy disagreed, so the plain-word reason is
 * proven on the real client component rather than only in source.
 *
 * Screenshots and the rendered copy land in
 * `.research/validation-runs/r2-desk-and-demo-honest-copy/`.
 */

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "r2-desk-and-demo-honest-copy",
);

const OLD_ABSOLUTE = /decides?\s+everything|approves?\s+everything\b/i;

/** A reset response with one live ask and one policy-disagreement fallback. */
const CANNED_RESET = {
  reset: true,
  mode: "live",
  engines: [
    {
      askId: "ask-hero",
      label: "Marta's hero ask",
      engine: "live",
      providers: ["mistral"],
      models: ["mistral-small-latest"],
      latencyMs: 2100,
      questionCount: 9,
      fallbackReason: null,
    },
    {
      askId: "ask-waiting",
      label: "David's queued ask",
      engine: "deterministic",
      providers: ["deterministic"],
      models: ["rule-engine-v1"],
      latencyMs: 12,
      questionCount: 9,
      fallbackReason: "structure_mismatch",
    },
  ],
  church: "Grace Community Church",
  seedDigest: `sha256:${"a".repeat(64)}`,
  assertions: { passed: 12, total: 12, failed: [] },
};

const PLAIN_FALLBACK =
  "The model's answers disagreed with the church's policy for this ask, so the labelled rules engine answered.";

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

test.describe.configure({ timeout: 120_000 });

test.describe("round 2 — honest desk and demo copy", () => {
  test("VAL-R2PROM-004 — the desk audit page states both halves of who decides", async ({
    browser,
  }) => {
    const grace = await signIn(browser, seedAccessTokens.grace);

    try {
      await grace.page.goto("/desk/audit");
      await expect(
        grace.page.getByRole("heading", { level: 1, name: "Decision log" }),
      ).toBeVisible();

      const pageText = await grace.page.locator("body").innerText();
      expect(pageText).not.toMatch(OLD_ABSOLUTE);

      // The lead states the person half and the signed meal exception.
      await expect(
        grace.page.getByText(/A person approves what the rules flag/i).first(),
      ).toBeVisible();
      await expect(
        grace.page.getByText(/a reheatable meal may publish itself first/i),
      ).toBeVisible();
      await expect(
        grace.page.getByText(/this log records that automatic publication/i),
      ).toBeVisible();

      // The panel names the low-risk tier and the log line that carries it.
      const panel = grace.page.getByTestId("audit-who-decides");
      await expect(panel).toBeVisible();
      await expect(
        panel.getByRole("heading", {
          name: /who decides, and the one exception/i,
        }),
      ).toBeVisible();
      await expect(panel).toContainText(
        "Only a meal can publish without a coordinator approving that time",
      );
      await expect(panel).toContainText("slot_auto_published");
      await expect(panel).toContainText("Published a time automatically");
      await expect(panel).toContainText(
        "A companion place, a drive, and an in-home visit always wait for a person.",
      );

      await shot(grace.page, "desk-audit-whole-rule");
      await mkdir(EVIDENCE_DIR, { recursive: true });
      await grace.page
        .locator("h1 + p")
        .screenshot({
          path: path.join(EVIDENCE_DIR, "desk-audit-lead.png"),
        });
      await panel.screenshot({
        path: path.join(EVIDENCE_DIR, "desk-audit-who-decides.png"),
      });
    } finally {
      await grace.context.close();
    }
  });

  test("VAL-R2PROM-008 — the demo says what the live model does and what it does not", async ({
    page,
  }) => {
    await page.goto("/demo");
    await expect(
      page.getByRole("heading", { level: 1, name: /choose a role for the demo/i }),
    ).toBeVisible();

    const note = page.getByTestId("demo-model-note");
    await expect(note).toBeVisible();
    await expect(
      note.getByRole("heading", { name: /what this demo really does/i }),
    ).toBeVisible();
    await expect(note).toContainText("The routing is the live model's");
    await expect(note).toContainText("The calendar around it is fixed");
    await expect(note).toContainText("so the demonstration repeats");
    await expect(note).toContainText("The model does not build the board");
    await expect(note).toContainText(
      "falls back to the labelled rules engine",
    );
    await expect(note).toContainText("names the reason in plain words");

    // No sentence on the demo surface claims the model produced the board.
    const pageText = await page.locator("body").innerText();
    expect(pageText).not.toMatch(
      /model (?:built|builds|produced|produces|wrote|writes) the (?:whole )?board/i,
    );

    await shot(page, "demo-what-it-does");
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await writeFile(
      path.join(EVIDENCE_DIR, "demo-what-it-does.txt"),
      `${await note.innerText()}\n`,
      "utf8",
    );
  });

  test("VAL-R2PROM-008 — a receipt from a run that fell back names the reason in plain words", async ({
    page,
  }) => {
    await page.route("**/api/demo/reset", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(CANNED_RESET),
      });
    });

    await page.goto("/demo/reset");
    await expect(page.getByTestId("demo-reset-disclosure")).toContainText(
      "falls back to the labelled rules engine",
    );

    await page.getByLabel("Demo reset token").fill("intercepted-for-the-spec");
    await page.getByTestId("demo-reset-submit").click();

    await expect(page.getByTestId("demo-reset-result")).toBeVisible();
    await expect(
      page.getByTestId("demo-reset-fallback-ask-waiting"),
    ).toHaveText(PLAIN_FALLBACK);

    // The stored code never reaches the receipt.
    const receipt = await page.getByTestId("demo-reset-result").innerText();
    expect(receipt).not.toContain("structure_mismatch");
    expect(receipt).not.toMatch(/fell back:/i);

    await shot(page, "demo-reset-receipt-plain-reason");
    await writeFile(
      path.join(EVIDENCE_DIR, "demo-reset-receipt.txt"),
      `${receipt}\n`,
      "utf8",
    );
  });
});

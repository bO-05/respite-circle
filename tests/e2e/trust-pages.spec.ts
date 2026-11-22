import { expect, test, type Browser, type Page } from "@playwright/test";
import { seedAccessTokens } from "../../src/db/seed-data";

const STAMP = "Fictional church, fictional families. Sample data.";

const BANNED_CLAIMS = [
  "vetted",
  "HIPAA compliant",
  "HIPAA-compliant",
  "AI-powered care",
  "certified safe",
  "fully screened",
  "platform",
  "ecosystem",
  "marketplace",
  "orchestration",
  "seamless",
  "revolutionize",
  "empathy at scale",
  "compassionate AI",
  "AI that understands",
  "replaces your coordinator",
  "zero-touch",
];

function bannedHits(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_CLAIMS.filter((claim) => lower.includes(claim.toLowerCase()));
}

async function signIn(
  browser: Browser,
  token: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.goto(`/enter/${token}`);
  expect(response?.status()).toBe(200);
  return { page, close: () => context.close() };
}

test("how it works carries the AI table and the who-decides table", async ({
  page,
}) => {
  const response = await page.goto("/how-it-works");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /how it works, and who decides/i,
    }),
  ).toBeVisible();

  const aiTable = page.getByRole("table", {
    name: /what the ai sees, and what it never sees/i,
  });
  await expect(aiTable).toBeVisible();
  const wordsRow = aiTable.getByRole("row", {
    name: /^The words you typed or dictated/,
  });
  await expect(wordsRow).toBeVisible();
  await expect(wordsRow).toContainText("The only free text the model reads");
  await expect(
    aiTable.getByRole("rowheader", {
      name: "Your name, email, or phone number",
    }),
  ).toBeVisible();
  await expect(
    aiTable.getByRole("rowheader", { name: "Your address" }),
  ).toBeVisible();
  await expect(
    aiTable.getByRole("rowheader", {
      name: "The times offered, or who claimed them",
    }),
  ).toBeVisible();

  const decideTable = page.getByRole("table", {
    name: /who decides what/i,
  });
  await expect(decideTable).toBeVisible();
  for (const header of ["AI", "Plain code", "Coordinator"]) {
    await expect(
      decideTable.getByRole("columnheader", { name: header, exact: true }),
    ).toBeVisible();
  }
  const publishRow = decideTable.getByRole("row", {
    name: /publishes a time to the board/i,
  });
  await expect(publishRow).toBeVisible();

  await expect(page.getByText(STAMP, { exact: true })).toBeVisible();
  expect(bannedHits(await page.locator("body").innerText())).toEqual([]);
  expect(bannedHits(await page.content())).toEqual([]);

  await page.screenshot({
    path: "test-results/evidence/how-it-works.png",
    fullPage: true,
  });
});

test("the privacy matrix names four fields for four viewers", async ({
  page,
}) => {
  await page.goto("/how-it-works");

  const table = page.getByRole("table", { name: /who can see what/i });
  await expect(table).toBeVisible();

  for (const viewer of [
    "You (the family)",
    "Coordinator",
    "The neighbour who said yes",
    "The congregation board",
  ]) {
    await expect(
      table.getByRole("columnheader", { name: viewer, exact: true }),
    ).toBeVisible();
  }

  for (const field of [
    "Your words",
    "The orientation note",
    "Your family member's name",
    "The time",
  ]) {
    await expect(
      table.getByRole("rowheader", { name: field, exact: true }),
    ).toBeVisible();
  }

  const words = table.getByRole("row", { name: /^Your words/ });
  await expect(words).toContainText("Yes — your own, and you cannot change them");
  await expect(words).toContainText("Never");

  const note = table.getByRole("row", { name: /^The orientation note/ });
  await expect(note).toContainText(
    "Only after the coordinator approves the claim",
  );

  await page.screenshot({
    path: "test-results/evidence/privacy-matrix.png",
    fullPage: true,
  });
});

test("consent tiers list group, drive, meal, and in-home with requirements", async ({
  page,
}) => {
  await page.goto("/how-it-works");

  const table = page.getByRole("table", {
    name: /what each kind of time requires/i,
  });
  await expect(table).toBeVisible();

  for (const tier of [
    "Group — Respite Morning",
    "Drive",
    "Meal",
    "In-home",
  ]) {
    await expect(
      table.getByRole("rowheader", { name: tier, exact: true }),
    ).toBeVisible();
  }

  const drive = table.getByRole("row", { name: /^Drive/ });
  await expect(drive).toContainText("volunteer-driver policy");
  await expect(drive).toContainText("licence and insurance");

  const home = table.getByRole("row", { name: /^In-home/ });
  await expect(home).toContainText("familiar-faces list");
  await expect(home).toContainText("two references");
  await expect(home).toContainText("two people");

  await page.screenshot({
    path: "test-results/evidence/consent-tiers.png",
    fullPage: true,
  });
});

test("never lists all eight commitments with no banned claim", async ({
  page,
}) => {
  const response = await page.goto("/never");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 1, name: /what we never do/i }),
  ).toBeVisible();

  const commitments = page.getByTestId("commitment");
  await expect(commitments).toHaveCount(8);

  for (const title of [
    "No AI sentences about a person",
    "No scoring",
    "No chasing",
    "No story to the congregation",
    "No fake success",
    "No personal care as a slot",
    "No screening families",
    "No editing words",
  ]) {
    await expect(
      page.getByRole("heading", { level: 2, name: title, exact: true }),
    ).toBeVisible();
  }

  await expect(page.getByText(STAMP, { exact: true })).toBeVisible();
  expect(bannedHits(await page.locator("body").innerText())).toEqual([]);
  expect(bannedHits(await page.content())).toEqual([]);

  await page.screenshot({
    path: "test-results/evidence/never.png",
    fullPage: true,
  });
});

test("the trust page reads at 360px without horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/how-it-works");

  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  // The narrow layout is a definition list, not a clipped table.
  const privacyCards = page.getByTestId("privacy-cards");
  await expect(
    privacyCards.getByRole("heading", {
      level: 3,
      name: "The orientation note",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByTestId("consent-tiers-cards").getByRole("heading", {
      level: 3,
      name: "In-home",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    privacyCards.getByText("Only after the coordinator approves the claim", {
      exact: true,
    }),
  ).toBeVisible();

  await page.screenshot({
    path: "test-results/evidence/how-it-works-360.png",
    fullPage: true,
  });
});

test("promises stays signed, linked, and free of banned claims", async ({
  page,
}) => {
  const response = await page.goto("/promises");
  expect(response?.status()).toBe(200);

  await expect(
    page.getByRole("heading", { level: 1, name: /what we promise/i }),
  ).toBeVisible();
  await expect(page.getByTestId("policy-signoff")).toContainText("Signed by");
  const main = page.locator("#main");
  await expect(
    main.getByRole("link", { name: /how it works/i }),
  ).toHaveAttribute("href", "/how-it-works");
  await expect(
    main.getByRole("link", { name: /what we never do/i }),
  ).toHaveAttribute("href", "/never");

  expect(bannedHits(await page.locator("body").innerText())).toEqual([]);
  expect(bannedHits(await page.content())).toEqual([]);

  await page.screenshot({
    path: "test-results/evidence/promises.png",
    fullPage: true,
  });
});

test("the board keeps the story off the congregation screen the matrix promises", async ({
  browser,
}) => {
  const { page, close } = await signIn(browser, seedAccessTokens.ruth);

  await page.goto("/circle");
  const text = await page.locator("body").innerText();

  // Names from the seeded cast and the church record never reach a neighbour.
  // "June" is omitted deliberately: it is also a month a window may render.
  for (const hidden of ["Marta", "Elena", "Priya", "Mr. Rao"]) {
    expect(text, `${hidden} must not reach the board`).not.toContain(hidden);
  }
  expect(text).not.toMatch(/orientation note/i);
  expect(bannedHits(text)).toEqual([]);

  await close();
});

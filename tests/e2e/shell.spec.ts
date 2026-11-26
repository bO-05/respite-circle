import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { seedAccessTokens } from "../../src/db/seed-data";

const STAMP = "Fictional church, fictional families. Sample data.";
const AI_CHIP =
  "A person decides. No message you read was written by the computer.";

async function signIn(
  browser: Browser,
  token: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.goto(`/enter/${token}`);
  expect(response?.status()).toBe(200);
  return { context, page };
}

async function navLabels(page: Page): Promise<string[]> {
  const nav = page.getByRole("navigation", { name: "Your pages" });
  await expect(nav).toBeVisible();
  return nav.getByRole("link").allTextContents();
}

test("VAL-SHELL-001 — landing explains the loop and gives the failure path equal weight", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: /a break for the person who does the caring/i }),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: /you write it in your own words/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /a person approves what is offered/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /a neighbour claims a time/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /if nobody claims it, a person calls/i,
    }),
  ).toBeVisible();

  // The loop must not read as "every time waits for a person". One line under
  // it names the signed meal exception and links to the page that explains it,
  // so the landing loop and the trust page cannot contradict each other.
  const qualifier = page.getByTestId("landing-auto-publish-note");
  await expect(qualifier).toBeVisible();
  await expect(qualifier).toContainText(/one signed exception/i);
  await expect(qualifier).toContainText(/a meal on the congregation board/i);
  await expect(qualifier).toContainText(/errands are not available yet/i);
  await expect(
    qualifier.getByRole("link", { name: /how the exception works/i }),
  ).toHaveAttribute("href", "/how-it-works");

  // Equal visual weight is a rendered property, not a copy promise.
  const stepSize = await page
    .getByRole("heading", { name: /you write it in your own words/i })
    .evaluate((el) => getComputedStyle(el).fontSize);
  const failureSize = await page
    .getByRole("heading", { name: /if nobody claims it, a person calls/i })
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(failureSize).toBe(stepSize);

  await expect(page.getByText(STAMP, { exact: true })).toHaveCount(1);
  await expect(page.getByText(STAMP, { exact: true })).toBeVisible();
  await expect(page.getByText(AI_CHIP, { exact: true })).toHaveCount(1);
  await expect(page.getByText(AI_CHIP, { exact: true })).toBeVisible();
});

test("VAL-TRUST-005 and VAL-A11Y-004 — every page carries a skip link, one h1, landmarks, and the stamp", async ({
  browser,
  page: guestPage,
}) => {
  await guestPage.goto("/");
  await guestPage.keyboard.press("Tab");
  expect(await guestPage.evaluate(() => document.activeElement?.textContent)).toContain(
    "Skip to content",
  );
  await guestPage.keyboard.press("Enter");
  expect(new URL(guestPage.url()).hash).toBe("#main");
  expect(
    await guestPage.evaluate(() => document.activeElement?.id ?? ""),
  ).toBe("main");

  await expect(guestPage.getByRole("banner")).toBeVisible();
  await expect(guestPage.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(guestPage.getByRole("main")).toBeVisible();
  await expect(guestPage.getByRole("contentinfo")).toBeVisible();
  await expect(guestPage.getByRole("heading", { level: 1 })).toHaveCount(1);

  const checks: Array<{ path: string; token?: string }> = [
    { path: "/" },
    { path: "/enter" },
    { path: "/demo" },
    { path: "/promises" },
    { path: "/how-it-works" },
    { path: "/never" },
    { path: "/this-page-does-not-exist" },
    { path: "/ask", token: seedAccessTokens.marta },
    { path: "/care", token: seedAccessTokens.marta },
    { path: "/desk", token: seedAccessTokens.grace },
    { path: "/desk/invite", token: seedAccessTokens.grace },
    { path: "/desk/metrics", token: seedAccessTokens.grace },
    { path: "/circle", token: seedAccessTokens.ruth },
    { path: "/my-claims", token: seedAccessTokens.ruth },
  ];

  for (const check of checks) {
    if (check.token) {
      const { context, page } = await signIn(browser, check.token);
      await page.goto(check.path);
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByText(STAMP, { exact: true })).toHaveCount(1);
      await expect(page.getByText(STAMP, { exact: true })).toBeVisible();
      await expect(page.getByText(AI_CHIP, { exact: true })).toBeVisible();
      await context.close();
    } else {
      await guestPage.goto(check.path);
      await expect(guestPage.getByRole("main")).toBeVisible();
      await expect(guestPage.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(guestPage.getByText(STAMP, { exact: true })).toHaveCount(1);
      await expect(guestPage.getByText(STAMP, { exact: true })).toBeVisible();
    }
  }
});

test("VAL-SHELL-002 — each role sees only its own navigation", async ({ browser }) => {
  const cases = [
    {
      token: seedAccessTokens.marta,
      labels: ["Ask", "Care", "Promises"],
      absent: ["Desk", "Sessions", "Decision log", "Board", "Metrics", "Your times"],
    },
    {
      token: seedAccessTokens.grace,
      labels: [
        "Desk",
        "Sessions",
        "Decision log",
        "Board",
        "Promises",
        "Metrics",
      ],
      absent: ["Ask", "Care", "Your times"],
    },
    {
      token: seedAccessTokens.daniel,
      labels: [
        "Desk",
        "Sessions",
        "Decision log",
        "Board",
        "Promises",
        "Metrics",
      ],
      absent: ["Ask", "Care", "Your times"],
    },
    {
      token: seedAccessTokens.ruth,
      labels: ["Board", "Your times"],
      absent: ["Desk", "Sessions", "Decision log", "Ask", "Care", "Metrics"],
    },
  ];

  for (const scenario of cases) {
    const { context, page } = await signIn(browser, scenario.token);
    expect(await navLabels(page)).toEqual(scenario.labels);
    const nav = page.getByRole("navigation", { name: "Your pages" });
    for (const absent of scenario.absent) {
      await expect(
        nav.getByRole("link", { name: absent, exact: true }),
      ).toHaveCount(0);
    }
    await context.close();
  }
});

test("VAL-ACCESS-002 — a refused caregiver gets a 403 page and never the hidden label in the title", async ({
  browser,
}) => {
  const { context, page } = await signIn(browser, seedAccessTokens.marta);

  for (const path of ["/desk", "/desk/policy", "/desk/audit", "/desk/invite"]) {
    const response = await context.request.get(path, { maxRedirects: 0 });
    expect(response.status(), `${path} must refuse a caregiver`).toBe(403);
    const body = await response.text();
    expect(body).not.toContain("Grace Whitfield");
    expect(body).not.toContain("Coordinator desk");
  }

  const deskResponse = await page.goto("/desk");
  expect(deskResponse?.status()).toBe(403);
  await expect(
    page.getByRole("heading", { name: /that area isn't part of your role/i }),
  ).toBeVisible();
  await expect(page.getByText("Marta Alvarez")).toHaveCount(0);
  await expect(page.getByText("Grace Whitfield")).toHaveCount(0);
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(page.getByText(STAMP, { exact: true })).toBeVisible();

  const title = await page.title();
  expect(title.toLowerCase()).not.toContain("desk");
  expect(title.toLowerCase()).not.toContain("coordinator");
  expect(title).toBe("That area isn't part of your role — Respite Circle");

  await page.goto("/desk/policy");
  const policyTitle = await page.title();
  expect(policyTitle.toLowerCase()).not.toContain("policy");
  expect(policyTitle.toLowerCase()).not.toContain("desk");

  await page.goto("/desk/invite");
  const inviteTitle = await page.title();
  expect(inviteTitle.toLowerCase()).not.toContain("invite");
  expect(inviteTitle.toLowerCase()).not.toContain("family");
  expect(inviteTitle.toLowerCase()).not.toContain("desk");

  await context.close();
});

test("an unknown url returns a calm 404 with its own title", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: /we can't find that page/i }),
  ).toBeVisible();
  await expect(page.getByText(STAMP, { exact: true })).toBeVisible();
  expect(await page.title()).toBe("Page not found — Respite Circle");
});

test("an unhandled error returns a calm 500 with its own title", async ({
  page,
}) => {
  const response = await page.goto("/error-probe");
  expect(response?.status()).toBe(500);

  await expect(
    page.getByRole("heading", { name: /this page didn't load/i }),
  ).toBeVisible();
  await expect(page.getByText(STAMP, { exact: true })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /try again/i }),
  ).toBeVisible();
  expect(await page.title()).toBe("Something went wrong — Respite Circle");
});

test("titles are unique per route", async ({ browser, page: guestPage }) => {
  const { context, page } = await signIn(browser, seedAccessTokens.grace);

  const paths = ["/desk", "/desk/audit", "/desk/policy", "/desk/metrics", "/circle", "/promises"];
  const titles: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    titles.push(title);
  }
  expect(new Set(titles).size).toBe(titles.length);

  for (const publicPath of [
    "/",
    "/enter",
    "/demo",
    "/how-it-works",
    "/never",
  ]) {
    await guestPage.goto(publicPath);
    titles.push(await guestPage.title());
  }
  await guestPage.goto("/this-page-does-not-exist");
  titles.push(await guestPage.title());
  expect(new Set(titles).size).toBe(titles.length);

  await context.close();
});

test("client-side navigation keeps the shell title in sync", async ({
  browser,
}) => {
  const { context, page } = await signIn(browser, seedAccessTokens.grace);

  await page.goto("/desk");
  expect(await page.title()).toBe("Coordinator desk — Respite Circle");

  await page
    .getByRole("navigation", { name: "Your pages" })
    .getByRole("link", { name: "Promises", exact: true })
    .click();
  await expect(page).toHaveURL(/\/promises$/);
  await expect(
    page.getByRole("heading", { level: 1, name: /what we promise/i }),
  ).toBeVisible();
  expect(await page.title()).toBe("Our promises — Respite Circle");

  await page
    .getByRole("navigation", { name: "Your pages" })
    .getByRole("link", { name: "Desk", exact: true })
    .click();
  await expect(page).toHaveURL(/\/desk$/);
  expect(await page.title()).toBe("Coordinator desk — Respite Circle");

  await context.close();
});

test("VAL-A11Y-001 — the layout works at 360px and at 200% zoom width", async ({
  browser,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /if nobody claims it, a person calls/i }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  const { context, page: deskPage } = await signIn(
    browser,
    seedAccessTokens.grace,
  );
  await deskPage.setViewportSize({ width: 360, height: 740 });
  await deskPage.goto("/desk");
  expect(
    await deskPage.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  // 200% zoom at a 1280px window is a 640px layout viewport.
  await deskPage.setViewportSize({ width: 640, height: 800 });
  await deskPage.goto("/desk");
  expect(
    await deskPage.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expect(deskPage.getByRole("heading", { level: 1 })).toBeVisible();

  await context.close();
});

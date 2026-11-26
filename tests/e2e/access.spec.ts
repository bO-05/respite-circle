import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { seedAccessTokens, seedIds } from "../../src/db/seed-data";

const ORIGIN = "http://127.0.0.1:3130";

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

function tamperRole(token: string, role: string): string {
  const [payload, signature] = token.split(".");
  const data = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  data.role = role;
  const encoded = Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
  return `${encoded}.${signature}`;
}

test("VAL-ACCESS-001 — demo access lists only fictional role links and is labeled", async ({
  page,
}) => {
  const response = await page.goto("/demo");
  expect(response?.status()).toBe(200);

  await expect(page.getByText("Demo access — fictional people")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: /choose a role for the demo/i }),
  ).toBeVisible();
  // The fictional-data statement now lives in the two-sentence summary above
  // the role doors; the duplicated paragraph it used to sit in was removed by
  // the round-3 copy pass (VAL-R3HON-002 keeps the disclosure, not its old
  // paragraph).
  await expect(
    page.getByText(/Every name, ask, and time behind it is fictional\./),
  ).toBeVisible();

  await expect(page.getByTestId("demo-link-caregiver").first()).toBeVisible();
  await expect(page.getByTestId("demo-link-coordinator").first()).toBeVisible();
  await expect(page.getByTestId("demo-link-volunteer").first()).toBeVisible();

  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute("content", /noindex/);

  await expect(page.getByText("Hidden Person")).toHaveCount(0);
});

test("VAL-ACCESS-001 — each seeded role link signs in one person and lands on that role's home", async ({
  browser,
}) => {
  const cases = [
    { token: seedAccessTokens.grace, person: "Grace Whitfield", home: "/desk" },
    { token: seedAccessTokens.daniel, person: "Daniel Okafor", home: "/desk" },
    { token: seedAccessTokens.marta, person: "Marta Alvarez", home: "/ask" },
    { token: seedAccessTokens.david, person: "David Chen", home: "/ask" },
    { token: seedAccessTokens.priya, person: "Priya Raman", home: "/ask" },
    { token: seedAccessTokens.ruth, person: "Ruth Kim", home: "/circle" },
    { token: seedAccessTokens.sara, person: "Sara Bennett", home: "/circle" },
    { token: seedAccessTokens.tom, person: "Tom Nguyen", home: "/circle" },
    { token: seedAccessTokens.ben, person: "Ben Osei", home: "/circle" },
  ];

  for (const scenario of cases) {
    const { context, page } = await signIn(browser, scenario.token);
    expect(new URL(page.url()).pathname).toBe(scenario.home);
    await expect(page.getByTestId("signed-in-person")).toHaveText(
      scenario.person,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await context.close();
  }
});

test("VAL-ACCESS-002 — a caregiver is refused the desk and its policy page with no coordinator data", async ({
  browser,
}) => {
  const { context, page } = await signIn(browser, seedAccessTokens.marta);

  for (const path of ["/desk", "/desk/policy", "/desk/audit"]) {
    const response = await context.request.get(path, { maxRedirects: 0 });
    // The shell feature replaced the redirect with the real 403 page, so the
    // refusal carries the status that matches its meaning.
    expect(response.status(), `${path} must refuse a caregiver`).toBe(403);
    const body = await response.text();
    expect(body).not.toContain("Grace Whitfield");
    expect(body).not.toContain("Daniel Okafor");
    expect(body).not.toContain("Coordinator desk");
  }

  await page.goto("/desk");
  expect(new URL(page.url()).pathname).toBe("/desk");
  await expect(
    page.getByRole("heading", { name: /that area isn't part of your role/i }),
  ).toBeVisible();
  await expect(page.getByText("Marta Alvarez")).toHaveCount(0);
  await expect(page.getByText("Grace Whitfield")).toHaveCount(0);

  await page.goto("/ask");
  await expect(page.getByTestId("signed-in-person")).toHaveText(
    "Marta Alvarez",
  );

  await context.close();
});

test("VAL-ACCESS-003 — without a session every private route renders no private data", async ({
  request,
  page,
}) => {
  const privatePaths = [
    "/ask",
    "/care",
    "/desk",
    "/desk/audit",
    "/desk/policy",
    "/circle",
    "/my-claims",
  ];

  for (const path of privatePaths) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect([307, 308], `${path} must redirect an anonymous request`).toContain(
      response.status(),
    );
    expect(response.headers()["location"] ?? "").toContain("/enter");
    const body = await response.text();
    expect(body).not.toContain("Marta Alvarez");
    expect(body).not.toContain("Grace Whitfield");
    expect(body).not.toContain("Elena");
  }

  await page.goto("/desk");
  expect(new URL(page.url()).pathname).toBe("/enter");
  await expect(
    page.getByRole("heading", { level: 1, name: /enter respite circle/i }),
  ).toBeVisible();
  await expect(page.getByText("Marta Alvarez")).toHaveCount(0);
  await expect(page.getByText("Grace Whitfield")).toHaveCount(0);
});

test("VAL-ACCESS-003 — a forged or re-signed cookie is rejected by every guard", async ({
  browser,
}) => {
  const { context } = await signIn(browser, seedAccessTokens.marta);

  const cookies = await context.cookies(ORIGIN);
  const sessionCookie = cookies.find((cookie) => cookie.name === "rc_session");
  expect(sessionCookie?.value.split(".")).toHaveLength(2);

  // A valid caregiver session reaches the caregiver home.
  expect((await context.request.get("/ask")).status()).toBe(200);

  // Rewriting the role to coordinator leaves the signature stale.
  await context.addCookies([
    {
      name: "rc_session",
      value: tamperRole(sessionCookie!.value, "coordinator"),
      url: ORIGIN,
    },
  ]);

  for (const path of ["/desk", "/ask"]) {
    const response = await context.request.get(path, { maxRedirects: 0 });
    expect([307, 308], `${path} must reject a re-signed cookie`).toContain(
      response.status(),
    );
    expect(response.headers()["location"] ?? "").toContain("/enter");
  }

  // A completely fabricated token signed with the wrong key fails too.
  const fabricatedPayload = Buffer.from(
    JSON.stringify({
      v: 1,
      personId: seedIds.people.grace,
      role: "coordinator",
      churchId: seedIds.church,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    "utf8",
  ).toString("base64url");
  await context.addCookies([
    {
      name: "rc_session",
      value: `${fabricatedPayload}.${"A".repeat(43)}`,
      url: ORIGIN,
    },
  ]);

  const response = await context.request.get("/desk", { maxRedirects: 0 });
  expect([307, 308]).toContain(response.status());
  expect(response.headers()["location"] ?? "").toContain("/enter");

  await context.close();
});

test("VAL-ACCESS-003 — the session cookie is signed, HttpOnly, SameSite=Lax, and expiring", async ({
  request,
}) => {
  const response = await request.get(`/enter/${seedAccessTokens.marta}`, {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers()["location"] ?? "").toContain("/ask");

  const setCookie = response.headers()["set-cookie"] ?? "";
  expect(setCookie).toContain("rc_session=");
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=Lax/i);
  expect(setCookie).toMatch(/Max-Age=\d+/i);
  expect(setCookie).toMatch(/Expires=/i);
  expect(setCookie).toMatch(/Path=\//i);

  const value = /rc_session=([^;]+)/.exec(setCookie)?.[1];
  expect(value).toBeTruthy();
  const parts = decodeURIComponent(value!).split(".");
  expect(parts).toHaveLength(2);
  expect(parts[0].length).toBeGreaterThan(20);
  expect(parts[1].length).toBeGreaterThan(20);
});

test("VAL-ACCESS-003 — an invalid access link sets no session and returns to the entry page", async ({
  request,
}) => {
  const response = await request.get("/enter/not-a-real-token", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers()["location"] ?? "").toContain(
    "/enter?error=invalid",
  );
  expect(response.headers()["set-cookie"]).toBeUndefined();
});

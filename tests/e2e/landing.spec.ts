import { test, expect } from "@playwright/test";

test("landing page serves the design system and the sample-data stamp", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByText("Fictional church, fictional families. Sample data.", {
      exact: true,
    }),
  ).toBeVisible();

  // The warm paper token and 18px base are asserted through the rendered page,
  // not just by reading the stylesheet.
  const surface = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return { background: style.backgroundColor, fontSize: style.fontSize };
  });
  expect(surface.background).toBe("rgb(250, 246, 240)");
  expect(surface.fontSize).toBe("18px");

  await page.screenshot({
    path: "test-results/evidence/landing.png",
    fullPage: true,
  });

  expect(consoleErrors).toEqual([]);
});

test("health endpoint answers without exposing a secret", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);

  const body = (await response.json()) as Record<string, unknown>;
  expect(body.ok).toBe(true);
  expect(["configured", "unconfigured"]).toContain(body.provider);
  expect(JSON.stringify(body)).not.toMatch(/postgres|mistral|hf_|sk-/i);
});

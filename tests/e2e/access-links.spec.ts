import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { seedAccessTokens, seedIds, seedPeople } from "../../src/db/seed-data";
import { caregiver, church, person } from "../../src/db/schema";
import {
  ACCESS_LINK_DEMO_WARNING,
  ACCESS_LINK_SCOPE_LINE,
  ACCESS_LINK_SEND_LINE,
} from "../../src/server/domain/access-links";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";
import { E2E_BASE_URL } from "./helpers/e2e-env";

/**
 * VAL-AUDITFIX-014 and VAL-R2PROM-007 on the real surface.
 *
 * The list is scoped to the families the desk may invite: the active caregivers
 * of Grace's own church, with the sign-in link each one already holds. The
 * desk's own link (Grace's and Daniel's) and the volunteers' links are not on
 * the page, and neither is another church's. The warning above the list says
 * these are demo links, that a link is personal and keeps working, and that a
 * holder is signed in as that person.
 *
 * VAL-R2PROM-007 also proves reuse: one token signs Marta in twice, in two
 * separate browser contexts, with no cookie shared between them. A caregiver's
 * session is refused before the page renders, and a coordinator from another
 * church reads only their own church's link.
 */

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "access-links",
);

/** The people the desk may invite: the seeded caregivers, and only them. */
const SEEDED_FAMILIES = seedPeople.filter((seeded) =>
  (seeded.roles as readonly string[]).includes("caregiver"),
);

const FAMILY_TOKENS = SEEDED_FAMILIES.map((seeded) => seeded.accessToken);

const OUT_OF_SCOPE_TOKENS = [
  seedAccessTokens.grace,
  seedAccessTokens.daniel,
  seedAccessTokens.ruth,
  seedAccessTokens.sara,
  seedAccessTokens.tom,
  seedAccessTokens.ben,
];

const ALL_SEEDED_TOKENS = Object.values(seedAccessTokens);

const FOREIGN = {
  churchId: "c5555555-5555-4555-8555-555555555551",
  coordinatorId: "a5555555-5555-4555-8555-555555555551",
  caregiverId: "a5555555-5555-4555-8555-555555555552",
  coordinatorToken: "outside-coordinator-9e9e",
  caregiverToken: "outside-caregiver-4d4d",
} as const;

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

function accessLinkInput(page: Page, personId: string) {
  return page.locator(
    `[data-testid="access-link-row"][data-person-id="${personId}"] [data-testid="access-link-value"]`,
  );
}

async function insertForeignChurch(db: E2eDatabase): Promise<void> {
  await db.db
    .insert(church)
    .values({
      id: FOREIGN.churchId,
      name: "Outside Community Church",
      timezone: "America/New_York",
      demoMode: false,
    })
    .onConflictDoNothing();

  await db.db
    .insert(person)
    .values([
      {
        id: FOREIGN.coordinatorId,
        churchId: FOREIGN.churchId,
        firstName: "Rosa",
        lastName: "Outside",
        roles: ["coordinator"],
        accessToken: FOREIGN.coordinatorToken,
      },
      {
        id: FOREIGN.caregiverId,
        churchId: FOREIGN.churchId,
        firstName: "Ana",
        lastName: "Outside",
        roles: ["caregiver"],
        accessToken: FOREIGN.caregiverToken,
      },
    ])
    .onConflictDoNothing();

  // A family record is what puts a person on the link list; without it the
  // foreign caregiver would not be a family the outside desk may invite.
  await db.db
    .insert(caregiver)
    .values({ personId: FOREIGN.caregiverId })
    .onConflictDoNothing();
}

async function deleteForeignChurch(db: E2eDatabase): Promise<void> {
  await db.client`DELETE FROM caregiver WHERE person_id = ${FOREIGN.caregiverId}`;
  await db.client`DELETE FROM person WHERE church_id = ${FOREIGN.churchId}`;
  await db.client`DELETE FROM church WHERE id = ${FOREIGN.churchId}`;
}

test.describe.configure({ timeout: 240_000 });

test.describe("VAL-AUDITFIX-014 + VAL-R2PROM-007 — scoped, warned sign-in links", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
    await insertForeignChurch(db);
  });

  test.afterAll(async () => {
    if (!db) return;
    await deleteForeignChurch(db);
    await db.client.end();
  });

  test("the coordinator sees only the families they may invite, with the demo warning and copy controls", async ({
    browser,
  }) => {
    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto("/desk/invite");

    await expect(
      grace.page.getByRole("heading", {
        name: "Sign-in links for the families you invite",
      }),
    ).toBeVisible();

    await expect(grace.page.getByTestId("access-links-warning")).toHaveText(
      ACCESS_LINK_DEMO_WARNING,
    );
    await expect(grace.page.getByTestId("access-links-send-line")).toHaveText(
      ACCESS_LINK_SEND_LINE,
    );
    await expect(
      grace.page.getByTestId("access-links-scope-line"),
    ).toHaveText(ACCESS_LINK_SCOPE_LINE);

    const rows = grace.page.getByTestId("access-link-row");
    await expect(rows).toHaveCount(SEEDED_FAMILIES.length);

    for (const seeded of SEEDED_FAMILIES) {
      const input = accessLinkInput(grace.page, seeded.id);
      await expect(input).toBeVisible();
      await expect(input).toHaveValue(
        new RegExp(`/enter/${seeded.accessToken}$`),
      );

      const copyButton = grace.page
        .locator(
          `[data-testid="access-link-row"][data-person-id="${seeded.id}"]`,
        )
        .getByTestId("copy-access-link");
      await expect(copyButton).toBeVisible();
      const box = await copyButton.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }

    // The desk's own links and the volunteers' links are not on this page at
    // all — not as a row, not as a token in the served HTML.
    for (const seeded of seedPeople.filter(
      (entry) => !(entry.roles as readonly string[]).includes("caregiver"),
    )) {
      await expect(
        grace.page.locator(
          `[data-testid="access-link-row"][data-person-id="${seeded.id}"]`,
        ),
      ).toHaveCount(0);
    }

    const html = await grace.page.content();
    for (const token of OUT_OF_SCOPE_TOKENS) {
      expect(html).not.toContain(token);
    }
    for (const token of FAMILY_TOKENS) {
      expect(html).toContain(token);
    }

    await shot(grace.page, "desk-invite-scoped-access-links");

    const daniel = await signIn(browser, seedAccessTokens.daniel);
    await daniel.page.goto("/desk/invite");
    await expect(
      daniel.page.getByRole("heading", {
        name: "Sign-in links for the families you invite",
      }),
    ).toBeVisible();
    await expect(daniel.page.getByTestId("access-links-warning")).toHaveText(
      ACCESS_LINK_DEMO_WARNING,
    );
    await expect(daniel.page.getByTestId("access-link-row")).toHaveCount(
      SEEDED_FAMILIES.length,
    );
    await expect(
      accessLinkInput(daniel.page, seedIds.people.marta),
    ).toHaveValue(new RegExp(`/enter/${seedAccessTokens.marta}$`));
    for (const token of OUT_OF_SCOPE_TOKENS) {
      expect(await daniel.page.content()).not.toContain(token);
    }

    await daniel.context.close();
    await grace.context.close();
  });

  test("one token signs Marta in twice, in two separate browser contexts", async ({
    browser,
  }) => {
    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.context.grantPermissions(
      ["clipboard-read", "clipboard-write"],
      { origin: E2E_BASE_URL },
    );

    await grace.page.goto("/desk/invite");

    const martaRow = grace.page.locator(
      `[data-testid="access-link-row"][data-person-id="${seedIds.people.marta}"]`,
    );
    await martaRow.getByTestId("copy-access-link").click();

    await expect(martaRow.getByTestId("access-link-status")).toHaveText(
      /copied/i,
    );

    const copied = await grace.page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    const expected = await accessLinkInput(
      grace.page,
      seedIds.people.marta,
    ).inputValue();

    expect(copied).toBe(expected);
    expect(copied).toMatch(
      new RegExp(`^https?://[^/]+/enter/${seedAccessTokens.marta}$`),
    );

    // First fresh context: no Grace cookie, no desk session, nothing shared.
    const first = await browser.newContext();
    const firstPage = await first.newPage();
    const firstResponse = await firstPage.goto(copied);

    expect(firstResponse?.status()).toBe(200);
    await expect(firstPage).toHaveURL(/\/ask$/);
    await expect(firstPage.getByTestId("signed-in-person")).toHaveText(
      "Marta Alvarez",
    );
    await shot(firstPage, "marta-from-copied-link-first-sign-in");

    // Second fresh context, the same URL, minutes later and with no cookie
    // carried over: the link is reusable, and it still signs Marta in.
    const second = await browser.newContext();
    const secondPage = await second.newPage();
    const secondResponse = await secondPage.goto(copied);

    expect(secondResponse?.status()).toBe(200);
    await expect(secondPage).toHaveURL(/\/ask$/);
    await expect(secondPage.getByTestId("signed-in-person")).toHaveText(
      "Marta Alvarez",
    );
    await shot(secondPage, "marta-from-copied-link-second-sign-in");

    // The first session is still live beside the second: nothing was consumed.
    await expect(firstPage.getByTestId("signed-in-person")).toHaveText(
      "Marta Alvarez",
    );

    await second.close();
    await first.close();
    await grace.context.close();
  });

  test("the links page and the sign-in page never say one-time or single-use", async ({
    browser,
  }) => {
    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto("/desk/invite");

    const inviteText = await grace.page.locator("main").innerText();
    expect(inviteText).not.toMatch(/one[- ]time|single[- ]use/i);
    expect(inviteText).toMatch(/demo sign-in links/i);

    const anonymous = await browser.newContext();
    const enterPage = await anonymous.newPage();
    await enterPage.goto("/enter");
    const enterText = await enterPage.locator("main").innerText();
    expect(enterText).not.toMatch(/one[- ]time|single[- ]use/i);
    expect(enterText).toMatch(/access link/i);

    await anonymous.close();
    await grace.context.close();
  });

  test("a caregiver's session is refused and receives no token", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);

    const response = await marta.page.goto("/desk/invite");
    expect(response?.status()).toBe(403);

    await expect(
      marta.page.getByRole("heading", {
        name: /isn't part of your role/i,
      }),
    ).toBeVisible();
    await expect(marta.page).not.toHaveTitle(/Invite a family/i);

    const html = await marta.page.content();
    expect(html).not.toContain("access-link-row");
    for (const token of ALL_SEEDED_TOKENS) {
      expect(html).not.toContain(token);
    }

    await shot(marta.page, "caregiver-refused");

    await marta.context.close();
  });

  test("another church's coordinator sees only their own church's family link", async ({
    browser,
  }) => {
    const outside = await signIn(browser, FOREIGN.coordinatorToken);
    await outside.page.goto("/desk/invite");

    await expect(
      outside.page.getByRole("heading", {
        name: "Sign-in links for the families you invite",
      }),
    ).toBeVisible();
    await expect(outside.page.getByTestId("access-link-row")).toHaveCount(1);
    await expect(
      accessLinkInput(outside.page, FOREIGN.caregiverId),
    ).toHaveValue(new RegExp(`/enter/${FOREIGN.caregiverToken}$`));

    const html = await outside.page.content();
    for (const token of ALL_SEEDED_TOKENS) {
      expect(html).not.toContain(token);
    }
    // The outside desk does not see its own link either.
    expect(html).not.toContain(FOREIGN.coordinatorToken);
    expect(html).not.toContain(seedIds.people.marta);

    await shot(outside.page, "other-church-links");

    await outside.context.close();
  });
});

import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedAccessTokens } from "../../src/db/seed-data";

/**
 * VAL-R4VIS-004 — the demo shows roles, not an essay.
 *
 * The page leads with the two sentences that are enough to enter, then role
 * cards grouped by coordinator, family member and volunteer. Each card carries
 * initials, the written name, the role, one true show line and one full-width
 * "Enter as {first name}". The model note follows the doors, still expanded,
 * with the audited sentence in place of the retired routing headline.
 *
 * `/demo` lists every church whose `demo_mode` is on. Every e2e fixture church
 * is inserted with `demo_mode` off, so a fixture left behind by an earlier spec
 * in the same run cannot add a fourth role card or a second "Grace"; this file
 * reads the canonical seeded cast without resetting the database itself.
 */

const FOLD = 800;

const RETIRED = [
  "The routing is the live model's",
  "labelled rules engine",
  "failure path",
] as const;

type Person = {
  name: string;
  initials: string;
  role: string;
  showLine: string;
  button: string;
  token: string;
  home: string;
};

const PEOPLE: readonly Person[] = [
  {
    name: "Grace Whitfield",
    initials: "GW",
    role: "Coordinator",
    showLine: "A family that needs a call today is at the top of her desk.",
    button: "Enter as Grace",
    token: seedAccessTokens.grace,
    home: "/desk",
  },
  {
    name: "Daniel Okafor",
    initials: "DO",
    role: "Deputy coordinator",
    showLine: "The same desk, from the deputy's side.",
    button: "Enter as Daniel",
    token: seedAccessTokens.daniel,
    home: "/desk",
  },
  {
    name: "Marta Alvarez",
    initials: "MA",
    role: "Family member",
    showLine: "Her request is already approved, with a time on the board.",
    button: "Enter as Marta",
    token: seedAccessTokens.marta,
    home: "/ask",
  },
  {
    name: "David Chen",
    initials: "DC",
    role: "Family member",
    showLine: "A waiting ask on the desk.",
    button: "Enter as David",
    token: seedAccessTokens.david,
    home: "/ask",
  },
  {
    name: "Priya Raman",
    initials: "PR",
    role: "Family member",
    showLine: "She needs a call today, and not a volunteer time.",
    button: "Enter as Priya",
    token: seedAccessTokens.priya,
    home: "/ask",
  },
  {
    name: "Ruth Kim",
    initials: "RK",
    role: "Volunteer",
    showLine: "Open Tuesday times you can take.",
    button: "Enter as Ruth",
    token: seedAccessTokens.ruth,
    home: "/circle",
  },
  {
    name: "Sara Bennett",
    initials: "SB",
    role: "Volunteer",
    showLine: "Open Tuesday times you can take.",
    button: "Enter as Sara",
    token: seedAccessTokens.sara,
    home: "/circle",
  },
  {
    name: "Tom Nguyen",
    initials: "TN",
    role: "Volunteer",
    showLine: "Open Tuesday times you can take.",
    button: "Enter as Tom",
    token: seedAccessTokens.tom,
    home: "/circle",
  },
  {
    name: "Ben Osei",
    initials: "BO",
    role: "Volunteer",
    showLine: "Open Tuesday times you can take.",
    button: "Enter as Ben",
    token: seedAccessTokens.ben,
    home: "/circle",
  },
];

const GROUP_LABELS = ["Coordinator", "Family member", "Volunteer"] as const;
const GROUP_CARD_COUNTS = [2, 3, 4] as const;

type Box = {
  top: number;
  bottom: number;
  width: number;
  height: number;
};

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, "the measured element has a box").not.toBeNull();
  return {
    top: box!.y,
    bottom: box!.y + box!.height,
    width: box!.width,
    height: box!.height,
  };
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

async function shot(
  page: Page,
  name: string,
  fullPage = false,
): Promise<void> {
  await page.screenshot({
    path: `test-results/evidence/${name}.png`,
    fullPage,
  });
}

test.describe.configure({ timeout: 240_000 });

test("VAL-R4VIS-004 — 1280x800 leads with two sentences, then a group of role cards with a visible way in", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: FOLD });
  await page.goto("/demo");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Choose someone to walk in as.",
  );
  await expect(
    page.getByText("These people are fictional. There is no password.", {
      exact: true,
    }),
  ).toBeVisible();

  // At most two sentences precede the first Enter button: the eyebrow label
  // and the two-sentence lead are the only prose outside the cards, and the
  // longer summary moved below the doors.
  const introProse = await page.evaluate(() => {
    const firstButton = document.querySelector('[data-testid^="demo-link-"]');
    if (!firstButton) return null;
    return Array.from(document.querySelectorAll("main p"))
      .filter((paragraph) => !paragraph.closest('[data-testid="role-card"]'))
      .filter(
        (paragraph) =>
          paragraph.compareDocumentPosition(firstButton) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      )
      .map((paragraph) => (paragraph.textContent ?? "").trim());
  });
  expect(introProse).not.toBeNull();
  expect(introProse).toHaveLength(2);
  expect(introProse![0]).toBe("Demo access — fictional people");
  expect(introProse![1]).toBe(
    "These people are fictional. There is no password.",
  );

  const groups = page.getByTestId("demo-role-group");
  await expect(groups).toHaveCount(3);
  expect(
    (await groups.locator("h2").allTextContents()).map((label) =>
      label.trim(),
    ),
  ).toEqual([...GROUP_LABELS]);
  expect(
    await groups.evaluateAll((nodes) =>
      nodes.map(
        (node) =>
          node.querySelectorAll('[data-testid="role-card"]').length,
      ),
    ),
  ).toEqual([...GROUP_CARD_COUNTS]);

  for (const person of PEOPLE) {
    const card = page.getByTestId("role-card").filter({ hasText: person.name });
    await expect(card, `${person.name} has one card`).toHaveCount(1);
    await expect(card.getByTestId("initials-chip")).toHaveText(
      person.initials,
    );
    await expect(card.getByTestId("role-card-name")).toHaveText(person.name);
    await expect(card.getByTestId("role-card-role")).toHaveText(person.role);
    await expect(card.getByTestId("role-card-show-line")).toHaveCount(1);
    await expect(card.getByTestId("role-card-show-line")).toHaveText(
      person.showLine,
    );
    const link = card.getByRole("link");
    await expect(link, `${person.name} has exactly one way in`).toHaveCount(1);
    await expect(link).toHaveText(person.button);
    await expect(link).toHaveAttribute("href", `/enter/${person.token}`);
  }

  // The first card is a whole card, its button included, inside the fold.
  const firstCard = page.getByTestId("role-card").first();
  const firstButton = page.locator('[data-testid^="demo-link-"]').first();
  const cardBox = await boxOf(firstCard);
  const buttonBox = await boxOf(firstButton);
  expect(cardBox.bottom, "the first card is whole inside 800px").toBeLessThanOrEqual(
    FOLD,
  );
  expect(
    buttonBox.bottom,
    "the first Enter button is inside the fold",
  ).toBeLessThanOrEqual(FOLD);

  // The button fills the card's content width, not one text column.
  const widths = await firstButton.evaluate((element) => {
    const card = element.closest('[data-testid="role-card"]');
    return {
      button: element.getBoundingClientRect().width,
      card: card?.getBoundingClientRect().width ?? 0,
    };
  });
  expect(widths.button).toBeGreaterThan(widths.card - 48);

  // The model note is still on the page, still open, and never a <details>.
  const note = page.getByTestId("demo-model-note");
  await expect(note).toBeVisible();
  await expect(
    note.getByRole("heading", { name: /what this demo really does/i }),
  ).toBeVisible();
  expect(
    await note.evaluate((element) => element.closest("details") !== null),
    "the model note is not inside a details element",
  ).toBe(false);
  await expect(page.locator("main details"), "no disclosure is collapsed").toHaveCount(
    0,
  );
  await expect(note).toContainText(
    "The live model's answers route each ask; the app's fixed rules can override.",
  );
  await expect(note).toContainText("The calendar around it is fixed");
  await expect(note).toContainText("so the demonstration repeats");
  await expect(note).toContainText("The model does not build the board");
  await expect(note).toContainText("falls back to the app's backup rules");
  await expect(note).toContainText("names the reason in plain words");

  const bodyText = await page.locator("body").innerText();
  for (const retired of RETIRED) {
    expect(bodyText, `the demo still says "${retired}"`).not.toContain(
      retired,
    );
  }
  expect(bodyText).toContain("These people are fictional.");
  expect(bodyText).toContain(
    "Every name, ask, and time behind it is fictional.",
  );

  // No volunteer count and no "needed" board language on the page.
  expect(bodyText).not.toMatch(/\b\d+\s+(?:volunteers?|places?|spots?)\b/i);
  expect(bodyText).not.toMatch(/volunteers needed/i);

  await shot(page, "demo-1280x800-first-fold");
  await shot(page, "demo-1280x800-full-page", true);
});

test("VAL-R4VIS-004 — 360x800 keeps a whole role card and its button in the first screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: FOLD });
  await page.goto("/demo");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Choose someone to walk in as.",
  );

  const firstCard = page.getByTestId("role-card").first();
  const firstButton = page.locator('[data-testid^="demo-link-"]').first();
  const cardBox = await boxOf(firstCard);
  const buttonBox = await boxOf(firstButton);
  expect(
    cardBox.bottom,
    "the first card is whole inside the 360x800 first screen",
  ).toBeLessThanOrEqual(FOLD);
  expect(
    buttonBox.bottom,
    "the first Enter button is inside the 360x800 first screen",
  ).toBeLessThanOrEqual(FOLD);

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await shot(page, "demo-360x800-first-fold");
  await shot(page, "demo-360x800-full-page", true);
});

test("VAL-R4VIS-004 — every role button still enters that person's session", async ({
  page,
}) => {
  test.setTimeout(120_000);

  for (const person of PEOPLE) {
    await page.goto("/demo");
    await page
      .getByRole("link", { name: person.button, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${person.home}$`));
    await expect(page.getByTestId("signed-in-person")).toHaveText(
      person.name,
    );
  }
});

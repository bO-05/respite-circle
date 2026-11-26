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
 * VAL-R4VIS-003 and the amended VAL-BOARD-004, measured on the volunteer
 * surfaces.
 *
 * The board groups open times under a weekday-and-date heading when the week
 * holds more than one day, in calendar order, with every time under exactly one
 * day. An open card has one time block, one kind pill, one primary action and
 * one hint; a taken card has one status pill instead of the action, naming the
 * coordinator the church resolved. The verb is "take": "Claim this time",
 * "My claims" and "Nothing claimed yet" are gone from every volunteer surface,
 * and no viewer, decline or volunteer-needed count appears.
 *
 * The fixture is this spec's own ask, so the assertions do not depend on
 * whatever the earlier specs left on the seeded board.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.\n\nShe loves hymns and tea, and she naps after lunch.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "test-results",
  "evidence",
);

const RETIRED_VOLUNTEER_STRINGS = [
  "Claim this time",
  "My claims",
  "Nothing claimed yet",
] as const;

// Counters a volunteer surface must never show. A bare "view" is ordinary
// English ("View this time"), so a view counter has to bring its number.
const COUNT_WORDS =
  /\b\d+\s+(?:viewers?|views?|places?|spaces?|volunteers?)\b|\b(?:remaining|declines?|declined|waiting time|volunteers? needed|places? left|spaces? left)\b/i;

type SlotRow = {
  id: string;
  kind: string;
  status: string;
  /** The e2e driver hands a timestamptz back as a Date or its text form. */
  window_start: Date | string | null;
};

/** One instant from either shape the driver returns. */
function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

async function signIn(
  browser: Browser,
  token: string,
  viewport?: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(
    viewport ? { viewport } : undefined,
  );
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
    timeout: 45_000,
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { askId: string }).askId;
}

async function slotsFor(db: E2eDatabase, askId: string): Promise<SlotRow[]> {
  return db.client<SlotRow[]>`
    SELECT id, kind, status, window_start
      FROM slot
     WHERE ask_id = ${askId}
     ORDER BY kind
  `;
}

/** The church's own civil date for an instant, computed independently. */
function civilDayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function civilDayParts(
  date: Date,
  timeZone: string,
): { weekday: string; month: string; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: value("weekday"),
    month: value("month"),
    day: Number(value("day")),
  };
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

test.describe.configure({ timeout: 300_000 });

test.describe("VAL-R4VIS-003 — the board groups by day and speaks one verb", () => {
  let db: E2eDatabase;
  let askId: string;
  let slots: SlotRow[];
  let timeZone: string;
  const createdAskIds: string[] = [];

  test.beforeAll(async ({ browser }) => {
    db = await openE2eDatabase();
    const [row] = await db.client<Array<{ timezone: string }>>`
      SELECT timezone FROM church WHERE id = ${seedIds.church}
    `;
    timeZone = row?.timezone ?? "America/New_York";

    // A real approved ask: two open times on two different days. It is made
    // once for both tests, so a retry of either test still has its fixture.
    const marta = await signIn(browser, seedAccessTokens.marta);
    askId = await createAsk(marta.context, HERO_ASK);
    createdAskIds.push(askId);
    await marta.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto(`/desk/ask/${askId}`);
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(2);
    await grace.page.getByTestId("approve-ask").click();
    await expect(grace.page.getByTestId("ask-review")).toHaveAttribute(
      "data-status",
      "approved",
      { timeout: 30_000 },
    );
    await grace.context.close();

    slots = await slotsFor(db, askId);
    expect(slots).toHaveLength(2);
    expect(slots.every((slot) => slot.status === "open")).toBe(true);
  });

  test.afterAll(async () => {
    for (const id of createdAskIds) {
      await db.client`
        DELETE FROM slot_candidate
         WHERE slot_id IN (SELECT id FROM slot WHERE ask_id = ${id})
      `;
      await db.client`DELETE FROM slot WHERE ask_id = ${id}`;
    }
    // The ask, its revision and its decisions stay: they are append-only and
    // the suite truncates this database at the start of every run.
    await db.client.end();
  });

  test("groups open times under one day rail each, with one action and one hint per card", async ({
    browser,
  }) => {
    const dayKeys = new Set(
      slots.map((slot) => {
        const start = toDate(slot.window_start);
        return start ? civilDayKey(start, timeZone) : "none";
      }),
    );
    expect(dayKeys.size, "the fixture spans two days").toBe(2);

    const ruth = await signIn(browser, seedAccessTokens.ruth, {
      width: 1280,
      height: 800,
    });
    const response = await ruth.page.goto("/circle");
    expect(response?.status()).toBe(200);

    const openSection = ruth.page.getByTestId("board-open");
    const groups = openSection.getByTestId("date-group");
    await expect(groups.first()).toBeVisible();
    expect(await groups.count()).toBeGreaterThanOrEqual(2);

    // Calendar order, and every heading names the day it holds.
    const renderedDays = await groups.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-date") ?? ""),
    );
    expect(renderedDays).toEqual([...renderedDays].sort());
    for (let index = 0; index < renderedDays.length; index += 1) {
      const group = groups.nth(index);
      const heading = group.getByRole("heading", { level: 3 });
      await expect(heading).toBeVisible();
      // textContent, not innerText: the weekday is upper-cased by CSS only.
      const text = ((await heading.textContent()) ?? "")
        .replace(/\s+/g, " ")
        .trim();
      expect(text).toMatch(
        /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\s+[A-Z][a-z]+$/,
      );
    }

    // Every card under a group belongs to that group's day, and no card is
    // rendered outside a group while the rail is on.
    const openCards = openSection.getByTestId("board-slot");
    const openCardCount = await openCards.count();
    expect(openCardCount, "the fixture's two cards are on the board").toBeGreaterThanOrEqual(2);
    const inGroups = openSection.locator(
      '[data-testid="date-group"] [data-testid="board-slot"]',
    );
    await expect(inGroups).toHaveCount(openCardCount);

    const churchSlots = await db.client<
      Array<{ id: string; window_start: Date | string | null }>
    >`
      SELECT id, window_start
        FROM slot
       WHERE church_id = ${seedIds.church} AND status = 'open'
    `;
    const startById = new Map(
      churchSlots.map((slot) => [slot.id, toDate(slot.window_start)]),
    );

    for (let index = 0; index < renderedDays.length; index += 1) {
      const group = groups.nth(index);
      const groupKey = renderedDays[index];
      const headingText = (
        (await group.getByRole("heading", { level: 3 }).textContent()) ?? ""
      )
        .replace(/\s+/g, " ")
        .trim();
      const cards = group.getByTestId("board-slot");
      const cardCount = await cards.count();
      for (let cardIndex = 0; cardIndex < cardCount; cardIndex += 1) {
        const card = cards.nth(cardIndex);
        const slotId = await card.getAttribute("data-slot-id");
        const start = slotId ? startById.get(slotId) : undefined;
        expect(start, `slot ${slotId} has a published window`).toBeTruthy();
        expect(civilDayKey(start as Date, timeZone)).toBe(groupKey);
        // The visible rail heading names the day the card's own window is on.
        expect(headingText).toContain(
          civilDayParts(start as Date, timeZone).weekday,
        );
      }
    }

    // One time block, one kind pill, one primary action, one hint.
    for (const slot of slots) {
      const card = ruth.page.locator(
        `[data-testid="board-slot"][data-slot-id="${slot.id}"]`,
      );
      await expect(card).toHaveAttribute("data-status", "open");
      const start = toDate(slot.window_start) as Date;
      await expect(card.getByTestId("board-window")).toContainText(
        civilDayParts(start, timeZone).weekday,
      );
      await expect(card.getByTestId("board-kind")).not.toHaveText("");
      await expect(card.getByTestId("board-status")).toHaveCount(0);

      const actions = card.getByRole("button", { name: "I'll take this time" });
      await expect(actions).toHaveCount(1);
      const action = actions.first();
      const tagName = await action.evaluate((element) =>
        element.tagName.toLowerCase(),
      );
      expect(tagName).toBe("button");
      await expect(action).toHaveAttribute("type", "submit");
      const form = card.getByTestId("board-claim");
      await expect(form).toHaveAttribute(
        "action",
        `/api/slots/${slot.id}/claim`,
      );
      await expect(form).toHaveAttribute("method", "post");
      const box = await action.boundingBox();
      if (!box) throw new Error("expected a laid-out action");
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await expect(card.getByTestId("board-claim-hint")).toContainText(
        "Grace will confirm it with you before the time is covered.",
      );
      await expect(action).toHaveAttribute(
        "aria-describedby",
        `board-claim-hint-${slot.id}`,
      );
    }

    // The retired verbs are gone from the volunteer surface, and no count of
    // viewers, declines or needed volunteers appears.
    const boardText = (await ruth.page.locator("body").innerText()).trim();
    for (const retired of RETIRED_VOLUNTEER_STRINGS) {
      expect(boardText).not.toContain(retired);
    }
    expect(boardText).not.toMatch(COUNT_WORDS);
    await shot(ruth.page, "r4-board-1280x800-open-groups");

    // The same structure at 360, with no horizontal scroll.
    await ruth.page.setViewportSize({ width: 360, height: 800 });
    await ruth.page.reload();
    await expect(
      ruth.page.getByTestId("board-open").getByTestId("date-group").first(),
    ).toBeVisible();
    expect(
      await ruth.page
        .getByTestId("board-open")
        .getByTestId("date-group")
        .count(),
    ).toBeGreaterThanOrEqual(2);
    const overflow = await ruth.page.evaluate(
      "document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth",
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(ruth.page, "r4-board-360x800-open-groups");
    await ruth.context.close();
  });

  test("a taken time shows one status pill naming the coordinator, and Your times speaks the same verb", async ({
    browser,
  }) => {
    const companion = slots.find((slot) => slot.kind === "companion");
    if (!companion) throw new Error("expected a companion time");
    const other = slots.find((slot) => slot.id !== companion.id);
    if (!other) throw new Error("expected a second time on another day");

    // A retry of this test must start from open times, so the claims it makes
    // are real first claims. Revoking is the one legal way back to open.
    for (const slot of [companion, other]) {
      await db.client`
        UPDATE slot
           SET status = 'open', claimed_by = NULL, claimed_at = NULL
         WHERE id = ${slot.id}
      `;
    }

    const ruth = await signIn(browser, seedAccessTokens.ruth, {
      width: 1280,
      height: 800,
    });
    await ruth.page.goto("/circle");
    const openCard = ruth.page.locator(
      `[data-testid="board-slot"][data-slot-id="${companion.id}"]`,
    );
    await openCard.getByRole("button", { name: "I'll take this time" }).click();
    await ruth.page.waitForURL(/\/circle\?claim=claimed/, { timeout: 30_000 });

    const takenSection = ruth.page.getByTestId("board-taken");
    const claimedCard = takenSection.locator(
      `[data-testid="board-slot"][data-slot-id="${companion.id}"]`,
    );
    await expect(claimedCard).toHaveAttribute("data-status", "claimed");
    await expect(claimedCard.getByTestId("board-claim")).toHaveCount(0);
    const statusPill = claimedCard.getByTestId("board-status");
    await expect(statusPill).toHaveCount(1);
    await expect(statusPill).toHaveText("Waiting for Grace to confirm");
    await expect(claimedCard.getByRole("button")).toHaveCount(0);
    await expect(claimedCard.getByTestId("board-card-hint")).toContainText(
      "Grace confirms a taken time before it is covered.",
    );
    // The taken card keeps its day in words: the rail is only drawn when the
    // section holds more than one day, so the card itself must still carry it,
    // visibly and not only in the screen-reader label.
    const companionWeekday = civilDayParts(
      toDate(companion.window_start) as Date,
      timeZone,
    ).weekday;
    await expect(claimedCard.getByTestId("board-window")).toContainText(
      companionWeekday,
    );
    await expect(
      claimedCard.locator(
        '[data-testid="board-window"] span[aria-hidden="true"]',
      ),
    ).toContainText(companionWeekday);
    // The open section still groups the days it has left.
    expect(
      await ruth.page
        .getByTestId("board-open")
        .getByTestId("date-group")
        .count(),
    ).toBeGreaterThanOrEqual(2);
    await shot(ruth.page, "r4-board-1280x800-claimed-pill");

    await ruth.page.setViewportSize({ width: 360, height: 800 });
    await ruth.page.reload();
    const claimedSmall = ruth.page
      .getByTestId("board-taken")
      .locator(`[data-testid="board-slot"][data-slot-id="${companion.id}"]`);
    await expect(claimedSmall.getByTestId("board-status")).toHaveText(
      "Waiting for Grace to confirm",
    );
    await shot(ruth.page, "r4-board-360x800-claimed-pill");

    // The same state and the same verb on "Your times".
    await ruth.page.setViewportSize({ width: 1280, height: 800 });
    const mine = await ruth.page.goto("/my-claims");
    expect(mine?.status()).toBe(200);
    const myCard = ruth.page.locator(
      `[data-testid="my-claim"][data-slot-id="${companion.id}"]`,
    );
    await expect(myCard).toHaveAttribute("data-status", "claimed");
    await expect(myCard.getByTestId("my-claim-status")).toHaveText(
      "Waiting for Grace to confirm",
    );
    await expect(myCard.getByTestId("my-claim-status")).toHaveCount(1);
    await expect(myCard.getByTestId("my-claim-hint")).toContainText("Grace");
    // One day on "Your times" means no rail, so the card carries the day.
    await expect(
      myCard.locator('[data-testid="my-claim-window"] span[aria-hidden="true"]'),
    ).toContainText(companionWeekday);
    await expect(myCard.getByRole("link", { name: /view this time/i })).toHaveAttribute(
      "href",
      `/my-claims/${companion.id}`,
    );
    const myClaimText = (await ruth.page.locator("body").innerText()).trim();
    for (const retired of RETIRED_VOLUNTEER_STRINGS) {
      expect(myClaimText).not.toContain(retired);
    }
    expect(myClaimText).not.toMatch(COUNT_WORDS);
    await shot(ruth.page, "r4-my-claims-1280x800-claimed");

    // A second taken time on another day: both surfaces now draw the rail.
    await ruth.page.goto("/circle");
    const otherOpen = ruth.page.locator(
      `[data-testid="board-slot"][data-slot-id="${other.id}"]`,
    );
    await expect(otherOpen).toHaveAttribute("data-status", "open");
    await otherOpen
      .getByRole("button", { name: "I'll take this time" })
      .click();
    await ruth.page.waitForURL(/\/circle\?claim=claimed/, { timeout: 30_000 });

    const takenGroups = ruth.page
      .getByTestId("board-taken")
      .getByTestId("date-group");
    await expect(takenGroups).toHaveCount(2);
    const takenKeys = await takenGroups.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-date") ?? ""),
    );
    expect(takenKeys).toEqual([...takenKeys].sort());
    const expectedTakenKeys = [companion, other]
      .map((slot) =>
        civilDayKey(toDate(slot.window_start) as Date, timeZone),
      )
      .sort();
    expect(takenKeys).toEqual(expectedTakenKeys);
    for (const slot of [companion, other]) {
      const card = ruth.page
        .getByTestId("board-taken")
        .locator(`[data-testid="board-slot"][data-slot-id="${slot.id}"]`);
      await expect(card.getByTestId("board-status")).toHaveText(
        "Waiting for Grace to confirm",
      );
      await expect(
        card.getByTestId("board-window").locator("span[aria-hidden='true']"),
      ).not.toContainText(
        civilDayParts(toDate(slot.window_start) as Date, timeZone).weekday,
      );
      // The day comes from the rail above the card, never from the card.
      const group = ruth.page
        .getByTestId("board-taken")
        .locator(
          `[data-testid="date-group"][data-date="${civilDayKey(
            toDate(slot.window_start) as Date,
            timeZone,
          )}"]`,
        );
      await expect(group.getByTestId("board-slot")).toHaveCount(1);
      expect(
        (await group.getByRole("heading", { level: 3 }).textContent()) ?? "",
      ).toContain(
        civilDayParts(toDate(slot.window_start) as Date, timeZone).weekday,
      );
    }
    await shot(ruth.page, "r4-board-1280x800-claimed-groups");

    // The same rail on "Your times", in the same calendar order.
    await ruth.page.goto("/my-claims");
    const myGroups = ruth.page
      .getByTestId("my-claims-list")
      .getByTestId("date-group");
    await expect(myGroups).toHaveCount(2);
    const myKeys = await myGroups.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-date") ?? ""),
    );
    expect(myKeys).toEqual([...myKeys].sort());
    expect(myKeys).toEqual(expectedTakenKeys);
    await expect(
      ruth.page
        .getByTestId("my-claims-list")
        .getByTestId("my-claim"),
    ).toHaveCount(2);
    await shot(ruth.page, "r4-my-claims-1280x800-groups");
    await ruth.context.close();

    // The empty board for a volunteer names the next human action and carries
    // the calendar-off well.
    const ben = await signIn(browser, seedAccessTokens.ben);
    await ben.page.goto("/my-claims");
    const empty = ben.page.getByTestId("my-claims-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("You haven't taken a time yet");
    await expect(empty.locator("svg")).toHaveCount(1);
    await expect(
      empty.getByRole("link", { name: /see the times you can take/i }),
    ).toHaveAttribute("href", "/circle");
    await shot(ben.page, "r4-my-claims-empty");
    await ben.context.close();
  });
});

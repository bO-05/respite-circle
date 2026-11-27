import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { DEMO_IDS } from "../../src/db/demo-state";
import { seedAccessTokens } from "../../src/db/seed-data";
import { AI_CHIP } from "../../src/server/domain/decision-trail";

/**
 * VAL-R5DES-007 — the signed-in surfaces read as a notice sheet.
 *
 * Four surfaces, four arrangements, one rule: a page is a sheet of ruled rows
 * and written words, not a stack of boxes. This spec measures the arrangement
 * the round-5 brief asks for and that a source read cannot prove:
 *
 *  `/demo` is a typographic list — no card fill, no grid, one full-width door
 *  per person; `/circle` opens each day with a gold hairline under a Fraunces
 *  weekday and a tabular-sans date, and each open time carries exactly one
 *  POST control; the receipt and `/care` draw the lifecycle as a vertical rail
 *  whose stages sit under one another, not across; `/desk` leads with the call
 *  as a brick text link, never a filled button and never a `tel:` link.
 *
 * The last test checks the panels this surface owns: a notice block carries at
 * most one non-zero border side beside its surface or tone fill. Text, test ids
 * and state colours are unchanged, so no honesty assertion moves.
 */

const FOLD = 800;

const GOLD = "rgb(138, 115, 64)";
const FRAUNCES = /fraunces/i;
const SOURCE_SANS = /source[ _-]?sans(?:[ _-]?3)?/i;
const TRANSPARENT = "rgba(0, 0, 0, 0)";

const EVIDENCE_DIR =
  process.env.R5_SIGNED_IN_EVIDENCE_DIR ??
  path.join(process.cwd(), ".research", "validation-runs", "r5-signed-in");

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

async function noHorizontalScroll(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `${where} has no horizontal scroll`).toBeLessThanOrEqual(0);
}

/** The four border widths of one element, in CSS pixels. */
async function borderSidesOf(locator: Locator): Promise<number[]> {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return [
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ].map((value) => Number.parseFloat(value) || 0);
  });
}

test.describe.configure({ timeout: 180_000 });

test("VAL-R5DES-007 — /demo is a typographic list, one full-width door per person", async ({
  browser,
}) => {
  for (const width of [1280, 360]) {
    const context = await browser.newContext({
      viewport: { width, height: FOLD },
    });
    const page = await context.newPage();
    const response = await page.goto("/demo");
    expect(response?.status()).toBe(200);

    const groups = page.getByTestId("demo-role-group");
    await expect(groups).toHaveCount(3);

    // The group's rows are one column, not a grid of cards.
    const layout = await groups.first().evaluate((group) => {
      const list = group.querySelector("ul");
      if (!list) return null;
      const style = getComputedStyle(list);
      return {
        display: style.display,
        columns: style.gridTemplateColumns,
        rows: list.querySelectorAll('[data-testid="role-card"]').length,
      };
    });
    expect(layout, "the demo group has a list").not.toBeNull();
    expect(layout?.display).toBe("flex");
    expect(layout?.columns).toBe("none");
    expect(layout?.rows, "the coordinator group keeps its two people").toBe(2);

    const card = page.getByTestId("role-card").first();
    await expect(card).toBeVisible();
    // No card fill: the row is type on the page, not a box on it.
    expect(
      await card.evaluate((el) => getComputedStyle(el).backgroundColor),
      `role row fill at ${width}`,
    ).toBe(TRANSPARENT);

    await expect(card.getByTestId("initials-chip")).toHaveCount(1);
    await expect(card.getByTestId("role-card-name")).not.toHaveText("");
    await expect(card.getByTestId("role-card-role")).not.toHaveText("");
    await expect(card.getByTestId("role-card-show-line")).toHaveCount(1);

    const door = card.getByRole("link");
    await expect(door).toHaveCount(1);
    await expect(door).toHaveAccessibleName(/^Enter as /);

    // The door is the row's full width and a real target, not a text link.
    const geometry = await door.evaluate((element) => {
      const row = element.closest('[data-testid="role-card"]');
      const link = element.getBoundingClientRect();
      const cardBox = row?.getBoundingClientRect() ?? null;
      return {
        linkWidth: Math.round(link.width),
        cardWidth: cardBox ? Math.round(cardBox.width) : 0,
        linkHeight: Math.round(link.height),
      };
    });
    expect(
      Math.abs(geometry.linkWidth - geometry.cardWidth),
      `door width ${geometry.linkWidth} against row ${geometry.cardWidth} at ${width}`,
    ).toBeLessThanOrEqual(1);
    expect(geometry.linkHeight, "door height").toBeGreaterThanOrEqual(44);

    await noHorizontalScroll(page, `/demo at ${width}`);
    await shot(page, `demo-${width}x800-notice-sheet`);
    await context.close();
  }
});

test("VAL-R5DES-007 — the board opens each day with a gold band and one POST per time", async ({
  browser,
}) => {
  for (const width of [1280, 360]) {
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    await ruth.page.setViewportSize({ width, height: FOLD });
    const response = await ruth.page.goto("/circle");
    expect(response?.status()).toBe(200);

    const group = ruth.page.getByTestId("date-group").first();
    await expect(group).toBeVisible();

    const band = await group.locator("h3 time").evaluate((el) => {
      const style = getComputedStyle(el);
      const spans = Array.from(el.querySelectorAll("span"));
      const read = (span: Element | undefined) => {
        if (!span) return null;
        const own = getComputedStyle(span);
        return {
          text: (span.textContent ?? "").trim(),
          family: own.fontFamily,
          style: own.fontStyle,
          size: own.fontSize,
          numeric: own.fontVariantNumeric,
          colour: own.color,
        };
      };
      return {
        family: style.fontFamily,
        numeric: style.fontVariantNumeric,
        rule: Number.parseFloat(style.borderBottomWidth) || 0,
        ruleColour: style.borderBottomColor,
        weekday: read(spans[0]),
        day: read(spans[1]),
        month: read(spans[2]),
      };
    });

    // The weekday is the kicker: italic Fraunces in the accent.
    expect(band.weekday?.text ?? "").toMatch(
      /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/,
    );
    expect(band.weekday?.family ?? "").toMatch(FRAUNCES);
    expect(band.weekday?.style).toBe("italic");
    expect(band.weekday?.size).toBe("17px");

    // The date is the sans with tabular figures, behind a gold hairline.
    expect(band.family).toMatch(SOURCE_SANS);
    expect(band.family).not.toMatch(FRAUNCES);
    expect(band.numeric).toBe("tabular-nums");
    expect(band.day?.text ?? "").toMatch(/^\d{1,2}$/);
    expect(band.month?.text ?? "").toMatch(/^[A-Z][a-z]+$/);
    expect(band.rule, "the day band's rule").toBeGreaterThan(0);
    expect(band.rule).toBeLessThanOrEqual(1);
    expect(band.ruleColour).toBe(GOLD);

    // One control per open time: the POST form, not a link, not a second button.
    const rows = ruth.page.locator('[data-testid="board-slot"][data-status="open"]');
    const rowCount = await rows.count();
    expect(rowCount, "the demo board has open times").toBeGreaterThan(0);
    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      const claim = row.getByTestId("board-claim");
      await expect(claim).toHaveCount(1);
      expect(await claim.evaluate((el) => el.tagName)).toBe("FORM");
      expect(await claim.getAttribute("method")).toBe("post");
      expect(await claim.getAttribute("action")).toMatch(
        /^\/api\/slots\/[^/]+\/claim$/,
      );
      const submit = claim.locator('button[type="submit"]');
      await expect(submit).toHaveCount(1);
      await expect(submit).toHaveText("I'll take this time");
      expect(
        await row.getByRole("link", { name: "I'll take this time" }).count(),
      ).toBe(0);
      expect(
        await row.getByRole("button", { name: "I'll take this time" }).count(),
        "one control per open time",
      ).toBe(1);
    }

    // The word the round removed: a requirement is a sentence, never a badge.
    const text = await ruth.page.locator("main").innerText();
    expect(text).not.toMatch(/\bGated\b/);

    await noHorizontalScroll(ruth.page, `/circle at ${width}`);
    await shot(ruth.page, `circle-${width}x800-notice-sheet`);
    await ruth.context.close();
  }
});

test("VAL-R5DES-007 — the receipt and /care draw the lifecycle as a vertical rail", async ({
  browser,
}) => {
  const marta = await signIn(browser, seedAccessTokens.marta);

  const rail = async (page: Page, where: string, exactStages = false) => {
    // `/care` draws one rail per ask; the receipt draws one. Read the first.
    const steps = page.getByTestId("lifecycle-steps").first();
    await expect(steps).toBeVisible();
    const structure = await steps.evaluate((el) => {
      const style = getComputedStyle(el);
      const items = Array.from(
        el.querySelectorAll('[data-testid="lifecycle-step"]'),
      ).map((item) => {
        const box = item.getBoundingClientRect();
        return {
          top: Math.round(box.top),
          left: Math.round(box.left),
          step: item.getAttribute("data-step"),
          state: item.getAttribute("data-state"),
          current: item.getAttribute("aria-current"),
          words: (item.textContent ?? "").replace(/\s+/g, " ").trim(),
        };
      });
      return {
        direction: style.flexDirection,
        railSide: Number.parseFloat(style.borderLeftWidth) || 0,
        railColour: style.borderLeftColor,
        items,
      };
    });

    expect(structure.direction, `${where} is a column`).toBe("column");
    expect(structure.railSide, `${where} rail`).toBeGreaterThan(0);
    expect(structure.railColour).toBe(GOLD);
    expect(structure.items.length, `${where} has four stages`).toBe(4);
    if (exactStages) {
      // The hero ask is published, so its stages are the ordinary four.
      expect(structure.items.map((item) => item.step)).toEqual([
        "written",
        "reading",
        "board",
        "covered",
      ]);
    } else {
      expect(
        structure.items.every((item) => (item.step ?? "").length > 0),
        `${where} names every stage`,
      ).toBe(true);
      expect(new Set(structure.items.map((item) => item.step)).size).toBe(4);
    }

    // Under one another, sharing the rail's left edge.
    for (let index = 1; index < structure.items.length; index += 1) {
      expect(
        structure.items[index].top,
        `${where} stage ${index} sits below stage ${index - 1}`,
      ).toBeGreaterThan(structure.items[index - 1].top);
      expect(
        structure.items[index].left,
        `${where} stage ${index} shares the rail`,
      ).toBe(structure.items[0].left);
    }

    const current = structure.items.filter((item) => item.current === "step");
    expect(current.length, `${where} has one current stage`).toBe(1);
    expect(current[0].words).toContain("You are here");
    for (const item of structure.items) {
      expect(item.words, `${where} ${item.step} state word`).toMatch(
        /You are here|Done|Not yet/,
      );
    }
    for (const item of structure.items.filter(
      (candidate) => candidate.current !== "step",
    )) {
      expect(
        item.words.includes("Done") || item.words.includes("Not yet"),
        `${where} finished or future stage ${item.step} says so in words`,
      ).toBe(true);
    }
  };

  for (const width of [1280, 360]) {
    await marta.page.setViewportSize({ width, height: FOLD });
    await marta.page.goto(`/ask/${DEMO_IDS.askHero}`);
    await rail(marta.page, `receipt at ${width}`, true);

    // The chip keeps its own disclosure, word for word.
    await expect(
      marta.page.getByText(AI_CHIP, { exact: true }).first(),
    ).toHaveText(AI_CHIP);
    expect(AI_CHIP).toBe("AI: reads your words, writes nothing");

    const text = await marta.page.locator("main").innerText();
    expect(text).not.toMatch(/\bGated\b/);
    await noHorizontalScroll(marta.page, `receipt at ${width}`);
    await shot(marta.page, `receipt-${width}x800-notice-sheet`);

    await marta.page.goto("/care");
    const careRail = marta.page
      .getByTestId("care-ask-link-row")
      .filter({ has: marta.page.getByTestId("lifecycle-steps") })
      .first();
    await expect(careRail.getByTestId("lifecycle-steps")).toBeVisible();
    await rail(marta.page, `/care at ${width}`);
    await noHorizontalScroll(marta.page, `/care at ${width}`);
    await shot(marta.page, `care-${width}x800-notice-sheet`);
  }

  await marta.context.close();
});

test("VAL-R5DES-007 — /desk leads with the call as a brick text link", async ({
  browser,
}) => {
  for (const width of [1280, 360]) {
    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.setViewportSize({ width, height: FOLD });
    const response = await grace.page.goto("/desk");
    expect(response?.status()).toBe(200);

    // The two group headings the round freezes: the call is always first.
    // The full two-heading proof, with a personal-care ask created for the
    // run, lives in `r4-desk-action-first.spec.ts`.
    const headings = await grace.page
      .locator('main [data-testid^="desk-category-"] h2')
      .allTextContents();
    expect(headings[0]).toBe("Call today");
    const careIndex = headings.indexOf("Needs professional help");
    const waitingIndex = headings.indexOf("Waiting for a person");
    expect(waitingIndex, "the ordinary queue is on the page").toBeGreaterThan(
      0,
    );
    if (careIndex >= 0) {
      expect(careIndex).toBeLessThan(waitingIndex);
    }

    const safetyRow = grace.page
      .locator('[data-testid="desk-category-safety"] [data-testid="desk-row"]')
      .first();
    const title = safetyRow.getByTestId("desk-row-title");
    await expect(title).toContainText(/^Call [A-Z][a-z]+ today/);
    await expect(title).toHaveAccessibleName(/— read this ask$/);
    expect(await title.evaluate((el) => el.tagName)).toBe("A");

    // The call is a brick text link into the ask — never a filled button.
    const call = safetyRow.getByTestId("desk-hold-open");
    await expect(call).toHaveAccessibleName(/open this ask/i);
    const callRead = await call.evaluate((el) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        href: el.getAttribute("href"),
        background: style.backgroundColor,
        colour: style.color,
        height: Math.round(box.height),
        width: Math.round(box.width),
      };
    });
    expect(callRead.tag).toBe("A");
    expect(callRead.href).toBe(`/desk/ask/${DEMO_IDS.askSafetyHold}`);
    expect(callRead.background, "a text link is not filled").toBe(TRANSPARENT);
    expect(callRead.colour, "the call is brick, not the accent green").toBe(
      "rgb(143, 61, 50)",
    );
    expect(callRead.height).toBeGreaterThanOrEqual(44);
    expect(callRead.width).toBeGreaterThanOrEqual(44);

    // No queue row dials a number. The only `tel:` links on the desk are the
    // 911 and 988 crisis lines the safety copy must keep.
    expect(await safetyRow.locator('a[href^="tel:"]').count()).toBe(0);
    expect(
      await grace.page
        .locator('[data-testid="desk-row"] a[href^="tel:"]')
        .count(),
    ).toBe(0);

    await noHorizontalScroll(grace.page, `/desk at ${width}`);
    await shot(grace.page, `desk-${width}x800-notice-sheet`);
    await grace.context.close();
  }
});

test("VAL-R5DES-007 — the panels this surface owns are notice blocks", async ({
  browser,
}) => {
  const grace = await signIn(browser, seedAccessTokens.grace);
  const measured: Array<{ panel: string; sides: number[] }> = [];

  const measure = async (page: Page, panel: string, testId: string) => {
    const locator = page.getByTestId(testId).first();
    if ((await locator.count()) === 0) return;
    measured.push({ panel, sides: await borderSidesOf(locator) });
  };

  // A held ask carries the hold card and the review section.
  await grace.page.goto(`/desk/ask/${DEMO_IDS.askSafetyHold}`);
  await measure(grace.page, "hold-card", "hold-card");
  await measure(grace.page, "ask-review-section", "ask-review");

  // The hero ask carries published slots, so the exclusion panel renders.
  await grace.page.goto(`/desk/ask/${DEMO_IDS.askHero}`);
  await measure(grace.page, "exclusion-panel", "exclusion-panel");
  await measure(grace.page, "ask-review-section", "ask-review");

  // The failed publish carries the coverage card.
  await grace.page.goto("/desk/failures");
  await measure(grace.page, "coverage-card", "coverage-card");

  expect(
    measured.length,
    `panels measured: ${measured.map((entry) => entry.panel).join(", ")}`,
  ).toBeGreaterThanOrEqual(3);

  for (const { panel, sides } of measured) {
    expect(
      sides.filter((side) => side > 0).length,
      `${panel} border sides: ${sides.join(",")}`,
    ).toBeLessThanOrEqual(1);
  }
  console.log(
    `Notice panels: ${measured
      .map((entry) => `${entry.panel} [${entry.sides.join(",")}]`)
      .join("; ")}`,
  );

  // The receipt's own panels obey the same rule, at both widths.
  const marta = await signIn(browser, seedAccessTokens.marta);
  for (const width of [1280, 360]) {
    await marta.page.setViewportSize({ width, height: FOLD });
    await marta.page.goto(`/ask/${DEMO_IDS.askHero}`);
    const receipts = await marta.page.locator("main section").evaluateAll((els) =>
      els.map((el) => {
        const style = getComputedStyle(el);
        const sides = [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ].map((value) => Number.parseFloat(value) || 0);
        return {
          label:
            el.getAttribute("data-testid") ??
            el.getAttribute("aria-labelledby") ??
            el.id,
          sides,
        };
      }),
    );
    expect(receipts.length, "the receipt draws its panels as sections").toBeGreaterThan(2);
    for (const receipt of receipts) {
      expect(
        receipt.sides.filter((side) => side > 0).length,
        `receipt panel ${receipt.label} sides: ${receipt.sides.join(",")}`,
      ).toBeLessThanOrEqual(1);
    }
  }
  await marta.context.close();
  await grace.context.close();
});

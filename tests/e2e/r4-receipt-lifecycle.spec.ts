import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { DEMO_IDS, DEMO_TEXT } from "../../src/db/demo-state";
import { seedAccessTokens } from "../../src/db/seed-data";
import { AI_CHIP } from "../../src/server/domain/decision-trail";
import { publishedNotBookedSentence } from "../../src/server/domain/published-time";
import { AI_CHIP_LABEL } from "../../src/lib/site-navigation";
import { E2E_RESET_PATH, E2E_RESET_TOKEN } from "./helpers/e2e-env";

/**
 * VAL-R4VIS-006 and VAL-R4VIS-001 on the caregiver surfaces.
 *
 * The receipt opens with a four-stage stepper — Written, {name} is reading,
 * On the board / Call today / Needs professional help, Covered — placed above
 * the "nine answers" heading, which survives verbatim. The family's own words
 * stay above the yes/no list. The receipt chip keeps its own disclosure and
 * the footer sentence still renders beside it. `/care` draws the same stages
 * for each ask and still reaches the receipt through a link whose text names
 * the nine answers.
 *
 * The stepper may only fill a stage on evidence: the waiting ask shows
 * "Written" current until a coordinator's first desk read, and the covered
 * state is reached through a real claim and a real confirmation, never by
 * writing a status into the fixture.
 *
 * The icon spread is measured on the five surfaces the round names: home,
 * `/demo`, `/circle`, `/desk` and the receipt. Every icon must be an inline
 * `<svg>` from `lucide-react`, decorative, and beside visible words; there is
 * no photograph of a person and no second icon package.
 */

const FOLD = 800;

const HERO_RECEIPT = `/ask/${DEMO_IDS.askHero}`;

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "r4-receipt-lifecycle",
);

type Box = { top: number; bottom: number; width: number; height: number };

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

async function shot(
  page: Page,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: options.fullPage ?? false,
  });
}

async function shotOf(locator: Locator, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await locator.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
  });
}

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

/** The four stage labels, in order, as the page actually renders them. */
async function stageLabels(root: Page | Locator): Promise<string[]> {
  return root
    .locator('[data-testid="lifecycle-step"] [data-stage-label]')
    .allTextContents()
    .then((labels) => labels.map((label) => label.trim()));
}

async function currentStage(root: Page | Locator): Promise<Locator> {
  const current = root.locator(
    '[data-testid="lifecycle-step"][data-state="current"]',
  );
  await expect(current).toHaveCount(1);
  return current;
}

async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, `${where} has no horizontal scroll`).toBeLessThanOrEqual(0);
}

test.describe.configure({ timeout: 300_000 });

test.describe("VAL-R4VIS-006 — the receipt shows progress without losing its claim", () => {
  test("the published receipt leads with the stepper and keeps every promise around it", async ({
    browser,
    request,
  }) => {
    await reset(request);
    const marta = await signIn(browser, seedAccessTokens.marta);

    // ---- /care: the same stages for the ask, and the link survives. ----
    const care = await marta.page.goto("/care");
    expect(care?.status()).toBe(200);
    const careRow = marta.page.locator(
      `[data-testid="care-ask-link-row"]:has([data-testid="care-ask-link"][data-ask-id="${DEMO_IDS.askHero}"])`,
    );
    await expect(careRow).toBeVisible();
    await expect(careRow.getByTestId("lifecycle-steps")).toBeVisible();

    const careCurrent = await currentStage(careRow);
    await expect(careCurrent).toContainText("On the board");
    await expect(careCurrent).toContainText("You are here");
    await expect(careCurrent).toHaveAttribute("aria-current", "step");
    const currentBg = await careCurrent.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(currentBg, "the current stage is accent-soft").toBe(
      "rgb(226, 238, 230)",
    );

    const careLabels = await stageLabels(careRow);
    expect(careLabels).toEqual([
      "Written",
      "Grace is reading",
      "On the board",
      "Covered",
    ]);

    const link = careRow.getByTestId("care-ask-link");
    await expect(link).toContainText(/nine answers/i);
    await expect(link).toHaveAttribute("href", HERO_RECEIPT);

    // VAL-R3HON-005: every "nine answers" on /care is a link, never a
    // heading or a lead sentence.
    const nineAnswerText = await marta.page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) return null;
      const walker = document.createTreeWalker(
        main,
        NodeFilter.SHOW_TEXT,
      );
      const offenders: string[] = [];
      const links: string[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const text = node.textContent ?? "";
        if (!/nine answers/i.test(text)) continue;
        const parent = node.parentElement;
        if (parent?.closest("a")) {
          links.push(text.trim());
        } else {
          offenders.push(`${parent?.tagName ?? "?"}: ${text.trim()}`);
        }
      }
      return { offenders, links };
    });
    expect(nineAnswerText).not.toBeNull();
    expect(
      nineAnswerText!.offenders,
      "no heading or lead names the nine answers",
    ).toEqual([]);
    expect(nineAnswerText!.links.length).toBeGreaterThan(0);

    const careHeadings = await marta.page
      .locator("main h1, main h2, main h3")
      .allTextContents();
    expect(
      careHeadings.some((heading) => /nine answers/i.test(heading)),
      "no /care heading names the nine answers",
    ).toBe(false);
    await expect(
      marta.page.getByText(
        "The times a neighbour has taken, and the words the church has sent you.",
        { exact: true },
      ),
    ).toBeVisible();

    // The published-not-booked sentence is unchanged and still on /care.
    const notBookedHere = publishedNotBookedSentence("Grace", "here");
    await expect(
      marta.page.getByTestId("care-published-not-booked"),
    ).toHaveText(notBookedHere);

    // ---- The receipt: order, heading, chip, footer, words before answers. ----
    await link.click();
    await expect(marta.page).toHaveURL(
      new RegExp(`${HERO_RECEIPT.replaceAll("/", "\\/")}$`),
    );

    const stepper = marta.page.getByTestId("lifecycle-steps");
    const statusPill = marta.page.getByTestId("ask-status");
    const heading = marta.page.getByRole("heading", {
      name: "The nine answers about your words",
      exact: true,
    });
    const words = marta.page.getByTestId("caregiver-verbatim");
    const answers = marta.page.getByTestId("decision-list");

    await expect(stepper).toBeVisible();
    await expect(statusPill).toHaveText("Approved by Grace");
    await expect(heading).toBeVisible();
    await expect(words).toHaveText(DEMO_TEXT.hero);
    await expect(answers.locator("li")).toHaveCount(9);

    // DOM order: stepper, then the status pill, then the answers heading.
    const order = await marta.page.evaluate(() => {
      const at = (selector: string) => document.querySelector(selector);
      const follows = (first: Element | null, second: Element | null) =>
        first !== null &&
        second !== null &&
        (first.compareDocumentPosition(second) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
          0;
      return {
        stepperBeforePill: follows(
          at('[data-testid="lifecycle-steps"]'),
          at('[data-testid="ask-status"]'),
        ),
        stepperBeforeHeading: follows(
          at('[data-testid="lifecycle-steps"]'),
          at("#decision-trail-heading"),
        ),
        stepperBeforeWords: follows(
          at('[data-testid="lifecycle-steps"]'),
          at('[data-testid="caregiver-verbatim"]'),
        ),
        wordsBeforeAnswers: follows(
          at('[data-testid="caregiver-verbatim"]'),
          at('[data-testid="decision-list"]'),
        ),
      };
    });
    expect(order).toEqual({
      stepperBeforePill: true,
      stepperBeforeHeading: true,
      stepperBeforeWords: true,
      wordsBeforeAnswers: true,
    });

    const stepperBox = await boxOf(stepper);
    const headingBox = await boxOf(heading);
    const wordsBox = await boxOf(words);
    const answersBox = await boxOf(answers);
    expect(stepperBox.top).toBeLessThan(headingBox.top);
    expect(wordsBox.top).toBeLessThan(answersBox.top);

    // The stepper is not restated as a paragraph.
    const restating = await marta.page.evaluate(() => {
      const paragraphs = Array.from(document.querySelectorAll("main p"));
      return paragraphs
        .map((paragraph) => (paragraph.textContent ?? "").trim())
        .filter(
          (text) => text.includes("Written") && text.includes("Covered"),
        );
    });
    expect(restating, "no paragraph restates the four stages").toEqual([]);

    const receiptCurrent = await currentStage(marta.page);
    await expect(receiptCurrent).toContainText("On the board");
    await expect(receiptCurrent).toContainText("You are here");

    // The chip keeps its own disclosure, and the footer sentence still
    // renders on the same page. They are read separately, never merged.
    const chip = marta.page.locator(
      '[data-testid="decision-trail"] span',
      { hasText: AI_CHIP },
    );
    await expect(chip.first()).toHaveText(AI_CHIP);
    expect(AI_CHIP).toBe("AI: reads your words, writes nothing");
    await expect(marta.page.getByText(AI_CHIP_LABEL, { exact: true })).toBeVisible();
    expect(
      await marta.page.getByText(AI_CHIP, { exact: true }).count(),
    ).toBe(1);

    // The published-not-booked sentence is unchanged on the receipt too.
    await expect(marta.page.getByTestId("publication-state")).toContainText(
      publishedNotBookedSentence("Grace", "on your care page"),
    );

    // Both widths, with the first fold and the changed section captured.
    for (const viewport of [
      { label: "1280x800", width: 1280, height: FOLD },
      { label: "360x800", width: 360, height: FOLD },
    ]) {
      await marta.page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await marta.page.goto(HERO_RECEIPT);
      await expect(marta.page.getByTestId("lifecycle-steps")).toBeVisible();
      await expectNoHorizontalScroll(marta.page, `${viewport.label} receipt`);
      await shot(marta.page, `receipt-${viewport.label}-first-fold`);
      await shotOf(
        marta.page.getByTestId("lifecycle-steps"),
        `receipt-${viewport.label}-stepper`,
      );

      await marta.page.goto("/care");
      await expect(
        marta.page
          .locator(
            `[data-testid="care-ask-link-row"]:has([data-testid="care-ask-link"][data-ask-id="${DEMO_IDS.askHero}"])`,
          )
          .getByTestId("lifecycle-steps"),
      ).toBeVisible();
      await expectNoHorizontalScroll(marta.page, `${viewport.label} /care`);
      await shot(marta.page, `care-${viewport.label}-first-fold`);
      await shotOf(
        marta.page.getByTestId("care-ask-links"),
        `care-${viewport.label}-ask-links`,
      );
      const coveredEmpty = marta.page.getByTestId("care-covered-empty");
      if ((await coveredEmpty.count()) > 0) {
        await shotOf(
          coveredEmpty,
          `care-${viewport.label}-covered-empty`,
        );
      }
    }

    await marta.context.close();
  });

  test("the waiting ask fills the reading stage only after a real desk read", async ({
    browser,
    request,
  }) => {
    await reset(request);
    const david = await signIn(browser, seedAccessTokens.david);

    const response = await david.page.goto(`/ask/${DEMO_IDS.askWaiting}`);
    expect(response?.status()).toBe(200);
    await expect(david.page.getByTestId("ask-status")).toHaveText(
      "With Grace — not read yet",
    );

    // Nothing has recorded a read: the stage must not claim one.
    const before = david.page.locator('[data-testid="lifecycle-step"]');
    await expect(before).toHaveCount(4);
    const written = david.page.locator(
      '[data-testid="lifecycle-step"][data-step="written"]',
    );
    const reading = david.page.locator(
      '[data-testid="lifecycle-step"][data-step="reading"]',
    );
    await expect(written).toHaveAttribute("data-state", "current");
    await expect(reading).toHaveAttribute("data-state", "future");
    await expect(reading).toContainText("Not yet");
    await expect(written).toContainText("Written");
    await expect(written).toContainText("You are here");
    await shot(david.page, "receipt-waiting-unread-1280x800");
    await david.page.setViewportSize({ width: 360, height: FOLD });
    await david.page.reload();
    await expectNoHorizontalScroll(david.page, "360 receipt waiting unread");
    await shot(david.page, "receipt-waiting-unread-360x800");
    await david.page.setViewportSize({ width: 1280, height: FOLD });

    // A coordinator opens the ask: that is the ask's own first desk read.
    const grace = await signIn(browser, seedAccessTokens.grace);
    const desk = await grace.page.goto(`/desk/ask/${DEMO_IDS.askWaiting}`);
    expect(desk?.status()).toBe(200);
    await expect(grace.page.getByTestId("ask-review")).toBeVisible();
    await grace.context.close();

    await david.page.reload();
    await expect(david.page.getByTestId("ask-status")).toHaveText(
      "Read by Grace — she may call you",
    );
    await expect(written).toHaveAttribute("data-state", "done");
    await expect(reading).toHaveAttribute("data-state", "current");
    await expect(reading).toContainText("Grace is reading");
    await expect(reading).toContainText("You are here");
    await expect(
      david.page.locator('[data-testid="lifecycle-step"][data-step="covered"]'),
    ).toHaveAttribute("data-state", "future");
    await shot(david.page, "receipt-waiting-read-1280x800");

    await david.page.setViewportSize({ width: 360, height: FOLD });
    await david.page.reload();
    await expectNoHorizontalScroll(david.page, "360 receipt waiting");
    await shot(david.page, "receipt-waiting-read-360x800");

    await david.context.close();
  });

  test("a confirmed time is the only thing that reaches Covered", async ({
    browser,
    request,
  }) => {
    await reset(request);

    // A real claim through the volunteer route, then a real confirmation on
    // the desk. Nothing writes "covered" into the fixture.
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    const claimed = await ruth.context.request.post(
      `/api/slots/${DEMO_IDS.slotCompanion}/claim`,
      { headers: { accept: "application/json" } },
    );
    expect(claimed.status()).toBe(200);
    await ruth.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto(`/desk/slot/${DEMO_IDS.slotCompanion}`);
    await grace.page.getByTestId("approve-claim").click();
    await expect(grace.page.getByTestId("claim-review")).toHaveAttribute(
      "data-status",
      "covered",
      { timeout: 30_000 },
    );
    await grace.context.close();

    const marta = await signIn(browser, seedAccessTokens.marta);
    const response = await marta.page.goto(HERO_RECEIPT);
    expect(response?.status()).toBe(200);

    const covered = marta.page.locator(
      '[data-testid="lifecycle-step"][data-step="covered"]',
    );
    await expect(covered).toHaveAttribute("data-state", "current");
    await expect(covered).toContainText("Covered");
    await expect(covered).toContainText("You are here");
    await expect(
      marta.page.locator('[data-testid="lifecycle-step"][data-state="done"]'),
    ).toHaveCount(3);
    await shot(marta.page, "receipt-covered-1280x800");
    await marta.page.setViewportSize({ width: 360, height: FOLD });
    await marta.page.reload();
    await expectNoHorizontalScroll(marta.page, "360 receipt covered");
    await expect(covered).toHaveAttribute("data-state", "current");
    await shot(marta.page, "receipt-covered-360x800");
    await marta.page.setViewportSize({ width: 1280, height: FOLD });

    // /care draws the same evidence for the same ask.
    await marta.page.goto("/care");
    const careRow = marta.page.locator(
      `[data-testid="care-ask-link-row"]:has([data-testid="care-ask-link"][data-ask-id="${DEMO_IDS.askHero}"])`,
    );
    await expect(
      careRow.locator('[data-testid="lifecycle-step"][data-step="covered"]'),
    ).toHaveAttribute("data-state", "current");
    await expect(marta.page.getByTestId("care-confirmation")).toHaveCount(1);
    await shot(marta.page, "care-covered-1280x800");
    await marta.page.setViewportSize({ width: 360, height: FOLD });
    await marta.page.reload();
    await expectNoHorizontalScroll(marta.page, "360 /care covered");
    await shot(marta.page, "care-covered-360x800");

    await marta.context.close();
  });
});

test.describe("VAL-R4VIS-001 — one decorative icon pack across the five surfaces", () => {
  type IconFacts = {
    count: number;
    allLucide: boolean;
    allDecorative: boolean;
    classes: string[];
  };

  async function iconFacts(page: Page): Promise<IconFacts> {
    return page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) {
        return {
          count: 0,
          allLucide: false,
          allDecorative: false,
          classes: [],
        };
      }
      const icons = Array.from(main.querySelectorAll("svg"));
      return {
        count: icons.length,
        allLucide: icons.every((icon) =>
          (icon.getAttribute("class") ?? "").includes("lucide"),
        ),
        allDecorative: icons.every(
          (icon) =>
            (icon.getAttribute("aria-hidden") === "true" ||
              icon.closest('[aria-hidden="true"]') !== null) &&
            icon.getAttribute("aria-label") === null &&
            icon.getAttribute("role") === null &&
            icon.querySelector("title") === null,
        ),
        classes: icons.map((icon) => icon.getAttribute("class") ?? ""),
      };
    });
  }

  /**
   * The round-5 image contract replaces this file's old blanket "no
   * photograph" clause (VAL-R4VIS-001 is scoped to `5a41898..3d76358`).
   * `home` carries the hero and the three process still lifes, `demo` one
   * still life with a caption, `board` one per open time that has a matching
   * picture, and `none` still means no photograph at all.
   */
  type PhotoMode = "home" | "demo" | "board" | "none";

  async function expectPhotoContract(
    page: Page,
    surface: string,
    mode: PhotoMode,
  ): Promise<void> {
    const images = page.locator("main img");
    if (mode === "none") {
      await expect(
        images,
        `${surface} has no photograph`,
      ).toHaveCount(0);
      return;
    }

    const count = await images.count();
    if (mode === "home") {
      expect(count, `${surface} carries the hero and three rail still lifes`).toBe(4);
    }
    if (mode === "demo") {
      expect(count, `${surface} carries one still life`).toBe(1);
    }
    if (mode === "board") {
      expect(count, `${surface} shows a still life in its time rows`).toBeGreaterThan(0);
      expect(
        await page.getByTestId("board-still-life").count(),
        `${surface} every picture sits in a time row`,
      ).toBe(count);
    }

    for (let index = 0; index < count; index += 1) {
      const image = images.nth(index);
      const alt = (await image.getAttribute("alt")) ?? "";
      expect(alt, `${surface} image ${index + 1} says what it is`).not.toBe("");
      expect(alt, `${surface} image ${index + 1} is not this church`).toMatch(
        /not a photograph of this church/i,
      );
      expect(alt, `${surface} image ${index + 1} is not anyone in the demo`).toMatch(
        /anyone in the demo/i,
      );
      expect(
        (await image.getAttribute("src")) ?? "",
        `${surface} image ${index + 1} is served same-origin`,
      ).toMatch(/^\/(?:_next\/image\?url=%2Fimages%2F|images\/)/);
      // Intrinsic size lets the browser reserve the box, so nothing shifts.
      await expect(image).toHaveAttribute("width", /^\d+$/);
      await expect(image).toHaveAttribute("height", /^\d+$/);
    }

    if (mode === "home") {
      const hero = page.getByTestId("home-hero-figure").locator("img");
      await expect(hero).toHaveAttribute("loading", "eager");
      expect((await hero.getAttribute("alt")) ?? "").toMatch(/pews/i);
      await expect(page.getByTestId("home-hero-caption")).toContainText(
        /not a photograph of this church/i,
      );
    }

    if (mode === "demo") {
      expect((await images.first().getAttribute("alt")) ?? "").toMatch(
        /chair|teapot/i,
      );
      await expect(page.getByTestId("demo-still-life-caption")).toContainText(
        /not a photograph of this church/i,
      );
    }
  }

  async function expectSurfaceIcon(
    page: Page,
    surface: string,
    options: { photos?: PhotoMode } = {},
  ): Promise<void> {
    const facts = await iconFacts(page);
    expect(facts.count, `${surface} renders at least one icon`).toBeGreaterThan(
      0,
    );
    expect(facts.allLucide, `${surface} icons all come from lucide-react`).toBe(
      true,
    );
    expect(facts.allDecorative, `${surface} icons are decorative`).toBe(true);
    await expectPhotoContract(page, surface, options.photos ?? "none");
  }

  async function iconsAtBothWidths(
    page: Page,
    surface: string,
    name: string,
    url: string,
    options: { photos?: PhotoMode } = {},
  ): Promise<void> {
    await page.setViewportSize({ width: 1280, height: FOLD });
    await page.goto(url);
    await expectSurfaceIcon(page, surface, options);
    await shot(page, `icons-${name}-1280x800`);

    await page.setViewportSize({ width: 360, height: FOLD });
    await page.reload();
    await expectSurfaceIcon(page, `${surface} at 360`, options);
    await expectNoHorizontalScroll(page, `${surface} at 360`);
    await shot(page, `icons-${name}-360x800`);
  }

  test("home, demo, board, desk and the receipt each mount a lucide icon", async ({
    browser,
    request,
  }) => {
    await reset(request);

    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await iconsAtBothWidths(publicPage, "home", "home", "/", {
      photos: "home",
    });
    await iconsAtBothWidths(publicPage, "demo", "demo", "/demo", {
      photos: "demo",
    });
    await publicContext.close();

    const ruth = await signIn(browser, seedAccessTokens.ruth);
    await iconsAtBothWidths(ruth.page, "/circle", "circle", "/circle", {
      photos: "board",
    });
    await ruth.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    await iconsAtBothWidths(grace.page, "/desk", "desk", "/desk", {
      photos: "none",
    });
    await grace.context.close();

    const marta = await signIn(browser, seedAccessTokens.marta);
    await iconsAtBothWidths(marta.page, "receipt", "receipt", HERO_RECEIPT, {
      photos: "none",
    });
    await marta.context.close();

    // No second icon package is installed. The list is by name rather than a
    // pattern, because "lucide-react" itself does not contain "icon".
    const pkg = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installed = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    });
    const knownIconPackages = [
      "lucide-react",
      "react-icons",
      "@heroicons/react",
      "@radix-ui/react-icons",
      "@phosphor-icons/react",
      "@tabler/icons-react",
      "react-feather",
      "feather-icons",
      "bootstrap-icons",
      "ionicons",
    ].filter((name) => installed.includes(name));
    expect(knownIconPackages).toEqual(["lucide-react"]);
  });
});

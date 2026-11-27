import { readFileSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
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
import { DEMO_IDS } from "../../src/db/demo-state";
import { seedAccessTokens } from "../../src/db/seed-data";
import { PHOTO_CREDIT_LINE, STILL_LIFE } from "../../src/lib/photos";
import { E2E_RESET_PATH, E2E_RESET_TOKEN } from "./helpers/e2e-env";

/**
 * VAL-R5DES-005 — every photograph is honest.
 *
 * Five still lifes ship from `public/images/`. This spec proves the parts a
 * reader cannot be trusted to check by eye: every rendered `<img>` is
 * same-origin, declares its intrinsic size, loaded for real, carries the
 * approved alt with both limits ("not this church", "not anyone in the demo"),
 * and no request leaves the app's own host for an image. It also proves the
 * credit line reaches every surface, that the home hero is the only eager
 * image, and that the three rail thumbnails share one fixed height.
 *
 * The screenshots land under the mission's round-5 visual evidence folder when
 * `R5_PHOTO_EVIDENCE_DIR` is set; otherwise they go to the git-excluded
 * `.research/validation-runs/r5-photography` tree.
 */

const FOLD = 800;
const HERO_RECEIPT = `/ask/${DEMO_IDS.askHero}`;
const ORIGIN = "http://127.0.0.1:3130";
const SAME_ORIGIN_IMAGE = /^\/(?:_next\/image\?url=%2Fimages%2F|images\/)/;
const NOT_THIS_CHURCH = /not a photograph of this church/i;
const NOT_IN_DEMO = /anyone in the demo/i;

const EVIDENCE_DIR =
  process.env.R5_PHOTO_EVIDENCE_DIR ??
  path.join(process.cwd(), ".research", "validation-runs", "r5-photography");

type ImageFact = {
  src: string;
  alt: string;
  width: string | null;
  height: string | null;
  naturalWidth: number;
  naturalHeight: number;
  loading: string | null;
  box: { width: number; height: number };
};

type NetworkEntry = { url: string; resourceType: string };

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
  await locator.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`) });
}

/** A viewport shot is evidence of the first screen, so it starts at the top. */
async function toTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
}

function watchNetwork(page: Page): NetworkEntry[] {
  const entries: NetworkEntry[] = [];
  page.on("request", (request) => {
    entries.push({ url: request.url(), resourceType: request.resourceType() });
  });
  return entries;
}

function drain(entries: NetworkEntry[]): NetworkEntry[] {
  return entries.splice(0, entries.length);
}

function expectNoThirdPartyImageHost(
  entries: NetworkEntry[],
  where: string,
  options: { atLeast?: number } = {},
): void {
  const imageRequests = entries.filter(
    (entry) => entry.resourceType === "image",
  );
  const foreign = imageRequests.filter(
    (entry) => !entry.url.startsWith(`${ORIGIN}/`),
  );
  expect(foreign, `${where} requests no third-party image host`).toEqual([]);
  expect(
    entries.filter((entry) => /unsplash/i.test(entry.url)),
    `${where} never requests an Unsplash URL`,
  ).toEqual([]);
  for (const request of imageRequests) {
    expect(request.url, `${where} image request is same-origin`).toMatch(
      /^http:\/\/127\.0\.0\.1:3130\/(?:_next\/image\?|images\/)/,
    );
  }
  if (options.atLeast !== undefined) {
    expect(
      imageRequests.length,
      `${where} actually requested its photographs`,
    ).toBeGreaterThanOrEqual(options.atLeast);
  }
}

async function inventory(page: Page, where: string): Promise<ImageFact[]> {
  const images = page.locator("main img");
  const count = await images.count();
  const facts: ImageFact[] = [];
  for (let index = 0; index < count; index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(
        () =>
          image.evaluate(
            (element) => (element as HTMLImageElement).naturalWidth,
          ),
        { message: `${where} image ${index + 1} loaded` },
      )
      .toBeGreaterThan(0);
    facts.push(
      await image.evaluate((element) => {
        const img = element as HTMLImageElement;
        const rect = img.getBoundingClientRect();
        return {
          src: img.getAttribute("src") ?? "",
          alt: img.getAttribute("alt") ?? "",
          width: img.getAttribute("width"),
          height: img.getAttribute("height"),
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          loading: img.getAttribute("loading"),
          box: { width: rect.width, height: rect.height },
        };
      }),
    );
  }
  return facts;
}

function expectHonestImage(fact: ImageFact, where: string): void {
  expect(fact.src, `${where} is same-origin`).toMatch(SAME_ORIGIN_IMAGE);
  expect(fact.alt, `${where} says it is not this church`).toMatch(
    NOT_THIS_CHURCH,
  );
  expect(fact.alt, `${where} says no one in the demo`).toMatch(NOT_IN_DEMO);
  expect(fact.alt, `${where} says no people are in frame`).toMatch(
    /no people/i,
  );
  expect(fact.width, `${where} declares a width`).toMatch(/^\d+$/);
  expect(fact.height, `${where} declares a height`).toMatch(/^\d+$/);
  expect(fact.naturalWidth, `${where} loaded`).toBeGreaterThan(0);
  expect(fact.naturalHeight, `${where} loaded`).toBeGreaterThan(0);
  expect(fact.box.width, `${where} has a rendered box`).toBeGreaterThan(0);
  expect(fact.box.height).toBeGreaterThan(0);
}

function walkSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSources(full));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test.describe.configure({ timeout: 300_000 });

test("VAL-R5DES-005 — home, demo and the board render only local, sized, honest still lifes", async ({
  browser,
  request,
}) => {
  await reset(request);

  const context = await browser.newContext();
  const page = await context.newPage();
  const network = watchNetwork(page);

  // ---- Home: the hero plus one still life in each process step -------------
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: FOLD });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const facts = await inventory(page, `home ${width}`);
    expect(facts, `home ${width} image count`).toHaveLength(4);
    for (const [index, fact] of facts.entries()) {
      expectHonestImage(fact, `home ${width} image ${index + 1}`);
    }

    // Only the home hero is eager; the three rail thumbs wait their turn.
    expect(
      facts.filter((fact) => fact.loading === "eager"),
      "exactly one eager photograph on home",
    ).toHaveLength(1);
    expect(facts[0].loading, "the hero is the eager one").toBe("eager");
    expect(facts[0].alt, "the hero is the hall").toMatch(/pews/i);

    const thumbs = await page
      .getByTestId("step-still-life")
      .evaluateAll((nodes) =>
        nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
      );
    expect(thumbs, "one thumbnail per step").toHaveLength(3);
    expect(new Set(thumbs).size, "the three rail thumbs share a height").toBe(
      1,
    );

    await expect(page.getByTestId("home-hero-caption")).toContainText(
      NOT_THIS_CHURCH,
    );
    await toTop(page);
    await shot(page, `home-${width}x800-first-fold`);
    await shotOf(page.getByTestId("home-hero-figure"), `home-hero-caption-${width}x800`);
    await shotOf(
      page.locator('main section[aria-label*="three steps" i]'),
      `home-process-rail-${width}x800`,
    );

    await page.waitForLoadState("networkidle");
    expectNoThirdPartyImageHost(drain(network), `home ${width}`, {
      // The hero and step 2 share the pews file, so one optimiser response
      // can serve both; three distinct files is the honest floor.
      atLeast: 3,
    });
  }

  // ---- Demo: one still life with a visible caption -------------------------
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: FOLD });
    await page.goto("/demo");
    await page.waitForLoadState("networkidle");

    const facts = await inventory(page, `demo ${width}`);
    expect(facts, `demo ${width} image count`).toHaveLength(1);
    expectHonestImage(facts[0], `demo ${width} still life`);
    expect(facts[0].alt, "the demo still life is the chair").toMatch(
      /chair|teapot/i,
    );
    expect(facts[0].loading, "the demo still life is not eager").not.toBe(
      "eager",
    );
    await expect(page.getByTestId("demo-still-life-caption")).toContainText(
      NOT_THIS_CHURCH,
    );

    // The doors still lead the page: the first one is inside the first fold.
    const firstDoor = await page
      .locator('[data-testid^="demo-link-"]')
      .first()
      .boundingBox();
    expect(firstDoor, "the first door renders").not.toBeNull();
    expect(
      firstDoor!.y + firstDoor!.height,
      `the first demo door stays in the first screen at ${width}`,
    ).toBeLessThanOrEqual(FOLD);

    await toTop(page);
    await shot(page, `demo-${width}x800-first-fold`);
    await shotOf(page.getByTestId("demo-still-life"), `demo-still-life-${width}x800`);

    await page.waitForLoadState("networkidle");
    expectNoThirdPartyImageHost(drain(network), `demo ${width}`, {
      atLeast: 1,
    });
  }

  // ---- Board: one still life by kind in each time row ----------------------
  const ruth = await signIn(browser, seedAccessTokens.ruth);
  const boardNetwork = watchNetwork(ruth.page);
  for (const width of [1280, 360]) {
    await ruth.page.setViewportSize({ width, height: FOLD });
    await ruth.page.goto("/circle");
    await ruth.page.waitForLoadState("networkidle");

    const facts = await inventory(ruth.page, `board ${width}`);
    expect(facts.length, "the demo board carries still lifes").toBeGreaterThanOrEqual(3);
    for (const [index, fact] of facts.entries()) {
      expectHonestImage(fact, `board ${width} image ${index + 1}`);
      expect(fact.loading, "board still lifes are not eager").not.toBe("eager");
    }

    const mapping = await ruth.page
      .getByTestId("board-still-life")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          kind: node.getAttribute("data-photo-kind"),
          src:
            node.querySelector("img")?.getAttribute("src") ??
            "",
        })),
      );
    expect(mapping.length, "one picture per time that has one").toBe(
      facts.length,
    );
    const expected: Record<string, string> = {
      companion: "/tea-mug.jpg",
      home: "/chairs-table.jpg",
      meal: "/soup-bowl.jpg",
    };
    for (const row of mapping) {
      const file = expected[row.kind ?? ""];
      expect(file, `a still life exists for kind ${row.kind}`).toBeDefined();
      expect(decodeURIComponent(row.src), `${row.kind} uses ${file}`).toContain(
        file,
      );
    }

    // Every seeded open kind that has a picture shows exactly one.
    const openRows = ruth.page.locator(
      '[data-testid="board-slot"][data-status="open"]',
    );
    const openCount = await openRows.count();
    expect(openCount, "the board has open times").toBeGreaterThan(0);
    for (let index = 0; index < openCount; index += 1) {
      const row = openRows.nth(index);
      const kind = await row.getAttribute("data-kind");
      if (kind !== null && kind in expected) {
        await expect(
          row.getByTestId("board-still-life"),
          `open ${kind} row carries one still life`,
        ).toHaveCount(1);
      }
    }

    await toTop(ruth.page);
    await shot(ruth.page, `board-${width}x800`);
    await shotOf(ruth.page.getByTestId("board-list"), `board-rows-${width}x800`);

    await ruth.page.waitForLoadState("networkidle");
    expectNoThirdPartyImageHost(drain(boardNetwork), `board ${width}`, {
      atLeast: 3,
    });
  }
  await ruth.context.close();

  // ---- Desk and the receipt carry no photograph ---------------------------
  const grace = await signIn(browser, seedAccessTokens.grace);
  const deskNetwork = watchNetwork(grace.page);
  for (const width of [1280, 360]) {
    await grace.page.setViewportSize({ width, height: FOLD });
    await grace.page.goto("/desk");
    await expect(
      grace.page.locator("main img"),
      "the desk carries no photograph",
    ).toHaveCount(0);
    await toTop(grace.page);
    await shot(grace.page, `desk-${width}x800`);
    expectNoThirdPartyImageHost(drain(deskNetwork), `desk ${width}`);
  }
  await grace.context.close();

  const marta = await signIn(browser, seedAccessTokens.marta);
  const receiptNetwork = watchNetwork(marta.page);
  for (const width of [1280, 360]) {
    await marta.page.setViewportSize({ width, height: FOLD });
    await marta.page.goto(HERO_RECEIPT);
    await expect(
      marta.page.locator("main img"),
      "the receipt carries no photograph",
    ).toHaveCount(0);
    await toTop(marta.page);
    await shot(marta.page, `receipt-${width}x800`);
    expectNoThirdPartyImageHost(drain(receiptNetwork), `receipt ${width}`);
  }
  await marta.context.close();
  await context.close();
});

test("VAL-R5DES-005 — the credit line is visible from every surface and repeated in the README", async ({
  browser,
}) => {
  const surfaces: Array<{ where: string; check: () => Promise<Page> }> = [];

  const context = await browser.newContext();
  const publicPage = await context.newPage();
  for (const url of ["/", "/demo", "/promises"]) {
    surfaces.push({
      where: url,
      check: async () => {
        await publicPage.goto(url);
        return publicPage;
      },
    });
  }

  const ruth = await signIn(browser, seedAccessTokens.ruth);
  surfaces.push({
    where: "/circle",
    check: async () => {
      await ruth.page.goto("/circle");
      return ruth.page;
    },
  });

  const grace = await signIn(browser, seedAccessTokens.grace);
  surfaces.push({
    where: "/desk",
    check: async () => {
      await grace.page.goto("/desk");
      return grace.page;
    },
  });

  const marta = await signIn(browser, seedAccessTokens.marta);
  surfaces.push({
    where: HERO_RECEIPT,
    check: async () => {
      await marta.page.goto(HERO_RECEIPT);
      return marta.page;
    },
  });

  for (const surface of surfaces) {
    const page = await surface.check();
    const credit = page.locator("footer").getByTestId("photo-credit");
    await expect(credit, `${surface.where} shows the credit`).toBeVisible();
    await expect(credit).toHaveText(PHOTO_CREDIT_LINE);
    for (const required of [
      "Karl Fredrickson",
      "Rumman Amin",
      "could not record",
      "Unsplash License",
      "None of these photographs is of this church or of anyone in the demo.",
    ]) {
      await expect(credit, `${surface.where} credit names "${required}"`).toContainText(
        required,
      );
    }
    if (surface.where === "/") {
      await shotOf(page.locator("footer"), "footer-photo-credit-1280x800");
    }
  }

  await ruth.context.close();
  await grace.context.close();
  await marta.context.close();
  await context.close();

  // The README's image note repeats the same words, and names local files.
  const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");
  expect(readme).toContain(PHOTO_CREDIT_LINE);
  expect(readme).toContain("public/images/");
  expect(readme).toContain("next/image");
  expect(readme).not.toMatch(/images\.unsplash\.com/i);

  // No source file names a remote image host, an absolute image URL, or a
  // raw <img> that bypasses next/image.
  const offenders: string[] = [];
  for (const file of walkSources(path.join(process.cwd(), "src"))) {
    const relative = path.relative(process.cwd(), file);
    const source = readFileSync(file, "utf8");
    if (/unsplash\.com/i.test(source)) offenders.push(`${relative}: host`);
    if (/https?:\/\/[^\s"'`)]+\.(?:jpe?g|png|webp|avif|gif)\b/i.test(source)) {
      offenders.push(`${relative}: absolute image URL`);
    }
    if (/<img[\s>]/i.test(source)) offenders.push(`${relative}: raw img`);
  }
  expect(offenders).toEqual([]);
});

test("VAL-R5DES-005 — no map, no face claim and no invented count on the five surfaces", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const urls = ["/", "/demo"];

  // Social proof the app must never invent. A real, seeded capacity ("11 of
  // 12 places left") is not this: it comes from the session row and the one
  // companion time already taken, and it is allowed where the desk reads it.
  const inventedSocialProof =
    /\bpeople are viewing\b|\bviews?\b|\bheadcount\b|\bvolunteers? needed\b|\bfamilies helped\b/i;
  // A scarcity count on a public or volunteer surface would turn a neighbour's
  // yes into a race; none of those pages prints one.
  const scarcity =
    /\b(?:volunteers?|places?|spots?)\s+(?:needed|left|remaining)\b/i;

  for (const url of urls) {
    await page.goto(url);
    const text = await page.locator("main").innerText();
    expect(text, `${url} invents no social proof`).not.toMatch(
      inventedSocialProof,
    );
    expect(text, `${url} shows no scarcity count`).not.toMatch(scarcity);
    await expect(page.locator("main iframe"), `${url} has no map frame`).toHaveCount(
      0,
    );
    await expect(
      page.locator(
        '[data-testid*="map" i], [aria-label*="map" i], img[src*="map" i]',
      ),
      `${url} has no map`,
    ).toHaveCount(0);
  }

  const ruth = await signIn(browser, seedAccessTokens.ruth);
  for (const url of ["/circle", "/my-claims"]) {
    await ruth.page.goto(url);
    const text = await ruth.page.locator("main").innerText();
    expect(text, `${url} invents no social proof`).not.toMatch(
      inventedSocialProof,
    );
    expect(text, `${url} shows no scarcity count`).not.toMatch(scarcity);
    await expect(
      ruth.page.locator("main iframe"),
      `${url} has no map frame`,
    ).toHaveCount(0);
  }
  await ruth.context.close();

  const grace = await signIn(browser, seedAccessTokens.grace);
  await grace.page.goto("/desk");
  expect(
    await grace.page.locator("main").innerText(),
    "/desk invents no social proof",
  ).not.toMatch(inventedSocialProof);
  await grace.context.close();

  const marta = await signIn(browser, seedAccessTokens.marta);
  await marta.page.goto(HERO_RECEIPT);
  expect(
    await marta.page.locator("main").innerText(),
    "the receipt invents no social proof",
  ).not.toMatch(inventedSocialProof);
  await marta.context.close();
  await context.close();
});

/**
 * The five files are copied, not linked. Their names are asserted here so a
 * missing file fails this spec before any page renders a broken image.
 */
test("VAL-R5DES-005 — the five approved files are present and named", async () => {
  expect(Object.values(STILL_LIFE).map((photo) => photo.src).sort()).toEqual([
    "/images/bread.jpg",
    "/images/chairs-table.jpg",
    "/images/church-pews.jpg",
    "/images/soup-bowl.jpg",
    "/images/tea-mug.jpg",
  ]);
});

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type APIResponse,
  type Locator,
} from "@playwright/test";
import { BRAND_DESCRIPTION, RING_PATH } from "../../src/lib/brand";
import { SITE_NAME } from "../../src/lib/site-navigation";
import { deploymentUrl } from "../../src/lib/site-url";

/**
 * VAL-R5DES-003 — the brand assets and the masthead, proved in the build.
 *
 * The unit suite (`tests/unit/brand-assets.test.ts`) pins the source files and
 * the metadata declarations. Only a running build can prove the three asset
 * routes answer with an image type at the right pixel size, that the head
 * references them with absolute URLs, and that the masthead fits the first
 * screen with a decorative 28px mark.
 *
 * Nothing here writes a row.
 */

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "test-results",
  "evidence",
  "r5-brand",
);

const ACCENT = "rgb(47, 93, 69)";
const INK = "rgb(31, 36, 32)";

type PngSize = { width: number; height: number };

async function pngSize(response: APIResponse, label: string): Promise<PngSize> {
  const body = await response.body();
  expect(body.subarray(0, 8).toString("hex"), `${label} is a PNG`).toBe(
    "89504e470d0a1a0a",
  );
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
}

async function record(name: string, data: Record<string, unknown>) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    path.join(EVIDENCE_DIR, `${name}.json`),
    `${JSON.stringify(data, null, 2)}\n`,
    "utf8",
  );
}

type Box = { top: number; bottom: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const rect = await locator.boundingBox();
  expect(rect, "a measured element must render a box").not.toBeNull();
  const box = rect as NonNullable<typeof rect>;
  return {
    top: box.y,
    bottom: box.y + box.height,
    width: box.width,
    height: box.height,
  };
}

test("VAL-R5DES-003 — the three asset routes answer with an image, at size", async ({
  request,
}) => {
  const icon = await request.get("/icon.svg");
  expect(icon.status()).toBe(200);
  expect(icon.headers()["content-type"]).toContain("image/svg+xml");
  const iconBody = await icon.text();
  expect(iconBody).toContain("<svg");
  expect(iconBody).toContain(RING_PATH);
  expect(iconBody).toContain('viewBox="0 0 32 32"');
  expect(iconBody).not.toContain('role="img"');
  expect(iconBody).not.toContain("<title");

  const apple = await request.get("/apple-icon");
  expect(apple.status()).toBe(200);
  expect(apple.headers()["content-type"]).toContain("image/png");
  const appleSize = await pngSize(apple, "the apple-touch icon");
  expect(appleSize).toEqual({ width: 180, height: 180 });

  const openGraph = await request.get("/opengraph-image");
  expect(openGraph.status()).toBe(200);
  expect(openGraph.headers()["content-type"]).toContain("image/png");
  const openGraphSize = await pngSize(openGraph, "the Open Graph image");
  expect(openGraphSize).toEqual({ width: 1200, height: 630 });

  // The share image is saved and looked at, not merely measured: a blank or
  // default tile would still satisfy a dimension check.
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(
    path.join(EVIDENCE_DIR, "opengraph-image.png"),
    await openGraph.body(),
  );
  await writeFile(
    path.join(EVIDENCE_DIR, "apple-icon.png"),
    await apple.body(),
  );

  const sizes = {
    icon: { status: icon.status(), contentType: icon.headers()["content-type"] },
    apple: {
      status: apple.status(),
      contentType: apple.headers()["content-type"],
      ...appleSize,
    },
    openGraph: {
      status: openGraph.status(),
      contentType: openGraph.headers()["content-type"],
      ...openGraphSize,
    },
  };
  await record("asset-routes", sizes);

  expect(sizes.icon.status).toBe(200);
  expect(sizes.apple.status).toBe(200);
  expect(sizes.openGraph.status).toBe(200);
});

test("VAL-R5DES-003 — the head names the generated routes and the share card", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  const iconHref = await page.locator('link[rel="icon"]').first().getAttribute("href");
  expect(iconHref).toContain("/icon.svg");

  const apple = page.locator('link[rel="apple-touch-icon"]').first();
  expect(await apple.getAttribute("href")).toContain("/apple-icon");
  expect(await apple.getAttribute("sizes")).toBe("180x180");

  const og = async (property: string) =>
    page.locator(`meta[property="${property}"]`).first().getAttribute("content");

  expect(await og("og:title")).toContain(SITE_NAME);
  expect(await og("og:description")).toBe(BRAND_DESCRIPTION);
  const ogImage = await og("og:image");
  expect(ogImage, "og:image is declared").toBeTruthy();
  // metadataBase resolved the relative route to the deployment's origin.
  // Compare with the configured URL, not `page.url()`: Playwright talks to
  // 127.0.0.1 and Next normalises the request host to localhost.
  expect(new URL(ogImage as string).origin).toBe(deploymentUrl().origin);
  expect(new URL(ogImage as string).pathname).toBe("/opengraph-image");
  expect(await og("og:image:width")).toBe("1200");
  expect(await og("og:image:height")).toBe("630");

  const twitter = async (name: string) =>
    page.locator(`meta[name="${name}"]`).first().getAttribute("content");
  expect(await twitter("twitter:card")).toBe("summary_large_image");
  expect(await twitter("twitter:title")).toContain(SITE_NAME);
  const twitterImage = await twitter("twitter:image");
  expect(twitterImage, "twitter:image is declared").toBeTruthy();
  expect(new URL(twitterImage as string).pathname).toBe("/opengraph-image");

  const natural = await page.evaluate(async (src) => {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("the share image did not load"));
      image.src = src;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, "/opengraph-image");
  expect(natural).toEqual({ width: 1200, height: 630 });

  await record("head", {
    iconHref,
    appleHref: await apple.getAttribute("href"),
    appleSizes: await apple.getAttribute("sizes"),
    ogTitle: await og("og:title"),
    ogDescription: await og("og:description"),
    ogImage,
    ogImageWidth: await og("og:image:width"),
    ogImageHeight: await og("og:image:height"),
    twitterCard: await twitter("twitter:card"),
    twitterImage,
    openGraphNaturalSize: natural,
  });
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 360, height: 800 },
] as const) {
  test(`VAL-R5DES-003 — the masthead at ${viewport.width} keeps the mark, the name and the first screen`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    const banner = page.getByRole("banner");
    const masthead = await boxOf(banner);
    expect(
      masthead.height,
      "the masthead leaves room for the first screen",
    ).toBeLessThanOrEqual(128);

    // The home link's accessible name is exactly the site name; the mark adds
    // nothing to it.
    const home = banner.getByRole("link", {
      name: SITE_NAME,
      exact: true,
    });
    expect(await home.count(), "one home link named Respite Circle").toBe(1);
    expect(
      (await home.textContent())?.replace(/\s+/g, " ").trim(),
      "the visible wordmark reads as the accessible name",
    ).toBe(SITE_NAME);

    const mark = banner.locator("svg").first();
    const markBox = await boxOf(mark);
    expect(markBox.width, "the mark is 28px wide").toBe(28);
    expect(markBox.height, "the mark is 28px tall").toBe(28);
    expect(await mark.getAttribute("aria-hidden")).toBe("true");
    expect(await mark.getAttribute("role")).toBeNull();
    expect(await mark.locator("title").count()).toBe(0);
    expect(
      await mark.evaluate((element) => Boolean(element.closest("main"))),
      "the mark is not page content",
    ).toBe(false);
    expect(
      await mark.evaluate((element) => getComputedStyle(element).color),
      "the ring is drawn in the accent",
    ).toBe(ACCENT);

    const circle = banner.locator("em").first();
    expect((await circle.textContent())?.trim()).toBe("Circle");
    const circleStyle = await circle.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontStyle: style.fontStyle,
        fontWeight: style.fontWeight,
        fontFamily: style.fontFamily,
        color: style.color,
      };
    });
    expect(circleStyle.fontStyle, "Circle is italic").toBe("italic");
    expect(circleStyle.fontWeight).toBe("500");
    expect(circleStyle.fontFamily).toMatch(/fraunces/i);
    expect(circleStyle.color, "Circle is in the accent").toBe(ACCENT);

    const respite = await banner
      .locator("a > span")
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, fontWeight: style.fontWeight };
      });
    expect(respite.color, "Respite is in ink").toBe(INK);
    expect(respite.fontWeight).toBe("600");

    const links = banner.getByRole("link");
    const linkBoxes = [];
    for (let index = 0; index < (await links.count()); index += 1) {
      const link = links.nth(index);
      if (!(await link.isVisible())) continue;
      const box = await boxOf(link);
      expect(box.height, `masthead link ${index} is a 44px target`).toBeGreaterThanOrEqual(44);
      linkBoxes.push({
        text: (await link.innerText()).replace(/\s+/g, " ").trim(),
        ...box,
      });
    }
    expect(linkBoxes.length, "the masthead still offers a way in").toBeGreaterThan(0);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, "no horizontal scroll").toBeLessThanOrEqual(0);

    await record(`masthead-${viewport.width}`, {
      viewport,
      mastheadHeight: masthead.height,
      mark: { ...markBox, ariaHidden: true, role: null, titleCount: 0 },
      circle: circleStyle,
      respite,
      links: linkBoxes,
      horizontalOverflow: overflow,
    });
  });
}

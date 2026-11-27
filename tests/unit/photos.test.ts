import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { HALL_PHOTO, PHOTO_CREDIT_LINE, STILL_LIFE } from "@/lib/photos";

/**
 * VAL-R5DES-005 — every photograph is honest.
 *
 * The alt string is the only place a screen-reader user learns that a picture
 * is a stock still-life: not this church, not anyone in the demo. The intrinsic
 * size is what keeps the page from shifting, and the committed file's real
 * dimensions have to equal the declared ones or the reservation is a guess. A
 * future edit to any of these must change this test in the same commit.
 */

const PUBLIC_IMAGES = path.join(process.cwd(), "public", "images");
const PHOTOS = Object.values(STILL_LIFE);
const FOUR_HUNDRED_KB = 400 * 1024;

function walkSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSources(full));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("the five still-life photographs", () => {
  it("ships exactly the five approved files under public/images", () => {
    expect(PHOTOS.map((photo) => photo.src).sort()).toEqual([
      "/images/bread.jpg",
      "/images/chairs-table.jpg",
      "/images/church-pews.jpg",
      "/images/soup-bowl.jpg",
      "/images/tea-mug.jpg",
    ]);
    expect(new Set(PHOTOS.map((photo) => photo.src)).size).toBe(5);
  });

  it("declares the real intrinsic size of every committed file", async () => {
    for (const photo of PHOTOS) {
      const file = path.join(PUBLIC_IMAGES, path.basename(photo.src));
      const bytes = readFileSync(file);
      const meta = await sharp(bytes).metadata();
      expect(meta.width, `${photo.src} width`).toBe(photo.width);
      expect(meta.height, `${photo.src} height`).toBe(photo.height);
    }
  });

  it("keeps every committed file under the 400 KB review ceiling", () => {
    for (const photo of PHOTOS) {
      const file = path.join(PUBLIC_IMAGES, path.basename(photo.src));
      const size = readFileSync(file).length;
      expect(size, `${photo.src} bytes`).toBeLessThanOrEqual(FOUR_HUNDRED_KB);
    }
  });

  it("says in every alt what is pictured and both limits", () => {
    for (const photo of PHOTOS) {
      expect(photo.alt, `${photo.src} names no people`).toMatch(
        /no people|with no people/i,
      );
      expect(photo.alt, `${photo.src} says it is not this church`).toMatch(
        /not a photograph of this church/i,
      );
      expect(photo.alt, `${photo.src} says no one in the demo`).toMatch(
        /anyone in the demo/i,
      );
      // It is never described as the church the app belongs to.
      expect(photo.alt, `${photo.src} does not claim this church`).not.toMatch(
        /our church|this church hall/i,
      );
    }
  });

  it("names only the two confirmed photographers and leaves three unrecorded", () => {
    expect(STILL_LIFE.pews.photographer).toBe("Karl Fredrickson");
    expect(STILL_LIFE.tea.photographer).toBe("Rumman Amin");
    expect(
      PHOTOS.filter((photo) => photo.photographer === null),
      "three photographers are unrecorded",
    ).toHaveLength(3);
  });

  it("carries the approved credit line in one constant", () => {
    expect(PHOTO_CREDIT_LINE).toContain("Karl Fredrickson");
    expect(PHOTO_CREDIT_LINE).toContain("Rumman Amin");
    expect(PHOTO_CREDIT_LINE).toMatch(
      /three further photographs are by photographers whose names we could not record/i,
    );
    expect(PHOTO_CREDIT_LINE).toMatch(/unsplash license/i);
    expect(PHOTO_CREDIT_LINE).toMatch(
      /none of these photographs is of this church or of anyone in the demo/i,
    );
    // The rejected third-party attribution for the mug must never return.
    expect(PHOTO_CREDIT_LINE).not.toMatch(/vladislav/i);
  });
});

describe("the hall still-life the home hero renders", () => {
  it("is the approved file with an intrinsic size", () => {
    expect(HALL_PHOTO.src).toBe("/images/church-pews.jpg");
    expect(HALL_PHOTO.width).toBe(1800);
    expect(HALL_PHOTO.height).toBe(1200);
  });

  it("says in its alt what is pictured and both limits", () => {
    expect(HALL_PHOTO.alt).toBe(
      "Empty wooden pews facing stained-glass windows and hanging lanterns in a church hall. No people. Not a photograph of this church or of anyone in the demo.",
    );
    expect(HALL_PHOTO.alt).toMatch(/no people/i);
    expect(HALL_PHOTO.alt).toMatch(/not a photograph of this church/i);
    expect(HALL_PHOTO.alt).toMatch(/anyone in the demo/i);
  });

  it("repeats both limits in the visible caption", () => {
    expect(HALL_PHOTO.caption).toBe(
      "An empty hall. Not a photograph of this church, and not of anyone in the demo.",
    );
  });

  it("names the photographer the credit line prints", () => {
    expect(HALL_PHOTO.photographer).toBe("Karl Fredrickson");
  });
});

describe("the source ships no hotlinked or hand-written image", () => {
  it("has no image-host hostname, absolute image URL, or raw <img> in src/**", () => {
    const files = walkSources(path.join(process.cwd(), "src"));
    expect(files.length, "found source files to scan").toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const file of files) {
      const relative = path.relative(process.cwd(), file);
      const text = readFileSync(file, "utf8");
      if (/unsplash\.com/i.test(text)) {
        offenders.push(`${relative}: image-host hostname`);
      }
      if (/https?:\/\/[^\s"'`)]+\.(?:jpe?g|png|webp|avif|gif)\b/i.test(text)) {
        offenders.push(`${relative}: absolute image URL`);
      }
      if (/<img[\s>]/i.test(text)) {
        offenders.push(`${relative}: raw <img> instead of next/image`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

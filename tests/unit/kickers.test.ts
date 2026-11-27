import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * VAL-R5DES-004's source half: the template tells are gone from `src/**`.
 *
 * A browser can only measure the elements a seeded page renders, so a class
 * combination on a route the suite never opens would survive a Playwright
 * check. This test reads every TypeScript and TSX file instead.
 *
 * The only tracked label allowed to stay is the initials chip: it holds two
 * capitals, it is decoration beside the person's written name, and
 * `tracking-wide` there is a chip's letter-spacing, not an uppercase eyebrow.
 */

const SRC = path.resolve(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(SRC).map((file) => ({
  file: path.relative(process.cwd(), file).replaceAll("\\", "/"),
  text: readFileSync(file, "utf8"),
}));

/** Every double-quoted or backticked string, which is where class lists live. */
function classStrings(text: string): string[] {
  return text.match(/"[^"\n]*"|`[^`]*`/g) ?? [];
}

const KICKER_CLASS = "font-serif italic font-medium text-[17px] text-accent";

describe("Hall Light kickers", () => {
  it("no element combines uppercase with tracking-wide or tracking-wider", () => {
    const offenders: string[] = [];
    for (const source of files) {
      for (const value of classStrings(source.text)) {
        if (/uppercase/.test(value) && /tracking-(?:wide|wider)/.test(value)) {
          offenders.push(`${source.file}: ${value.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("leaves no uppercase utility at all, so no tracked eyebrow can hide", () => {
    const offenders: string[] = [];
    for (const source of files) {
      for (const value of classStrings(source.text)) {
        if (/\buppercase\b/.test(value)) {
          offenders.push(`${source.file}: ${value.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps one tracked label, and it is the initials chip, not a kicker", () => {
    const hits: Array<{ file: string; index: number; value: string }> = [];
    for (const source of files) {
      for (const value of classStrings(source.text)) {
        if (/tracking-(?:wide|wider|tight|tighter|normal)/.test(value)) {
          hits.push({
            file: source.file,
            index: source.text.indexOf(value),
            value,
          });
        }
      }
    }

    expect(hits).toHaveLength(1);
    expect(hits[0]!.file).toBe("src/components/visual-primitives.tsx");

    const primitives = files.find(
      (source) => source.file === "src/components/visual-primitives.tsx",
    )!;
    const chipStart = primitives.text.indexOf("export function InitialsChip");
    expect(chipStart).toBeGreaterThan(-1);
    expect(hits[0]!.index).toBeGreaterThan(chipStart);
    expect(hits[0]!.value).toContain("tracking-wide");
    expect(hits[0]!.value).not.toContain("uppercase");
  });

  it("renders every kicker as Fraunces italic at 17px in the accent", () => {
    const kickers = files.flatMap((source) =>
      classStrings(source.text)
        .filter((value) => value.includes(KICKER_CLASS))
        .map(() => source.file),
    );

    // The ten uppercase tracked labels converted in af6b1d3: public-page,
    // home, demo, not-found, error, global-error, forbidden, desk queue, the
    // day band, and the process strip's own step label.
    expect(kickers.sort()).toEqual([
      "src/app/(public)/page.tsx",
      "src/app/demo/page.tsx",
      "src/app/error.tsx",
      "src/app/forbidden.tsx",
      "src/app/global-error.tsx",
      "src/app/not-found.tsx",
      "src/components/date-group.tsx",
      "src/components/desk-queue-section.tsx",
      "src/components/process-strip.tsx",
      "src/components/public-page.tsx",
    ]);
  });

  it("draws the step rail's numerals in the sans with tabular figures", () => {
    const strip = files.find(
      (source) => source.file === "src/components/process-strip.tsx",
    )!;
    expect(strip).toBeDefined();
    expect(strip.text).toContain("tabular-nums");
    expect(strip.text).toContain("font-sans");
    expect(strip.text).not.toContain("<IconWell");
  });
});

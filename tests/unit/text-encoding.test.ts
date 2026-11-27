import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Text survives a re-skin, byte for byte.
 *
 * The round-5 gate found the care page's middle dot saved as the
 * double-encoded `Â·` between a confirmation's label and the volunteer's
 * name. Every suite stayed green because no assertion quoted that separator,
 * which is exactly why this scan is a test and not a review habit. A file
 * saved as Latin-1 over UTF-8 can corrupt an em dash, a curly quote, an
 * ellipsis or a middle dot on any surface, so the check reads every rendered
 * source file rather than the one that was caught.
 */

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|css|md|svg|json)$/;

/** Sequences that only appear when UTF-8 has been read back as Latin-1. */
const DOUBLE_ENCODED = /[ÂÃ]|â€|ï¿½/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (SOURCE_EXTENSIONS.test(entry.name)) out.push(full);
  }
  return out;
}

function offenders(files: readonly string[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (DOUBLE_ENCODED.test(line)) {
        found.push(`${path.relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  return found;
}

describe("every committed string is real UTF-8", () => {
  it("renders no double-encoded sequence anywhere under src", () => {
    expect(offenders(walk(path.join(ROOT, "src")))).toEqual([]);
  });

  it("carries none in the README or the published calibration data", () => {
    const files = [
      path.join(ROOT, "README.md"),
      ...walk(path.join(ROOT, "data")),
    ];
    expect(offenders(files)).toEqual([]);
  });

  it("keeps the care page's label separator a middle dot", () => {
    const care = readFileSync(
      path.join(ROOT, "src", "app", "care", "page.tsx"),
      "utf8",
    );
    expect(care).toContain("? ` · ${confirmation.volunteerFirstName}`");
    expect(care).not.toContain("Â·");
  });
});

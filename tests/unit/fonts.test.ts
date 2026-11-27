import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The vendored typography contract (VAL-R5DES-002).
 *
 * The app must never fetch a font at build time: `playwright.config.ts` builds
 * inside its webServer, so a remote font would make every e2e spec depend on
 * network egress. These tests pin the four files, their licence, the
 * next/font/local declaration and the two theme stacks. The computed
 * font-family, size and tabular-figure assertions live in
 * `tests/e2e/r5-fonts.spec.ts`, because only a browser can read them.
 */

const root = process.cwd();
const FONT_DIR = path.join(root, "src", "app", "fonts");

/** SHA-256 of each binary as approved; an edit to a TTF fails this test. */
const FONTS: Record<string, string> = {
  "Fraunces.ttf":
    "99b365ece2cccd7d7baf879cc141f1fa9f2d20690fe025bc3003b01dff098f05",
  "Fraunces-Italic.ttf":
    "d638f010ca6d6c3f223524a65ad426242cf8e30b24e491e033138b5d2f74c8a9",
  "SourceSans3.ttf":
    "800f5dca8b08b34304d233fc5f97446d479e8f56c4de58fcefa7eb431b4de36c",
  "SourceSans3-Italic.ttf":
    "1211c2ebab00958efc21707ba8de2edca142ebe3f40be89e8c3a9c26f61c3ddf",
};

function readText(file: string): string {
  return readFileSync(path.join(root, file), "utf8");
}

function walk(dir: string): string[] {
  const absolute = path.join(root, dir);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(dir, entry.name);
    return entry.isDirectory() ? walk(relative) : [relative];
  });
}

describe("vendored font files", () => {
  it.each(Object.entries(FONTS))(
    "ships %s unmodified under the SIL OFL 1.1",
    (name, digest) => {
      const file = readFileSync(path.join(FONT_DIR, name));
      expect(file.byteLength).toBeGreaterThan(100_000);
      expect(createHash("sha256").update(file).digest("hex")).toBe(digest);
    },
  );

  it("ships the licence text beside the binaries, with both copyright lines", () => {
    const licence = readFileSync(path.join(FONT_DIR, "OFL.txt"), "utf8");
    expect(licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(licence).toContain("26 February 2007");
    // The two copyright holders' own lines, from the fonts' name tables.
    expect(licence).toContain(
      "Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces)",
    );
    expect(licence).toMatch(/© 2023 Adobe \(http:\/\/www\.adobe\.com\/\),/);
    expect(licence).toContain("Reserved Font Name 'Source'");
    // OFL section 5: the full licence travels with the files.
    expect(licence).toContain("PERMISSION & CONDITIONS");
    expect(licence).toContain("DISCLAIMER");
    // A provenance note names the upstream project and the version.
    expect(licence).toContain("github.com/undercasetype/Fraunces");
    expect(licence).toContain("1.000 (build b76b70a41)");
    expect(licence).toContain("3.052");
  });
});

describe("next/font/local declaration", () => {
  const layout = readText("src/app/layout.tsx");

  it("loads both families from disk, never from a font host", () => {
    expect(layout).toContain('from "next/font/local"');
    expect(layout).toContain("localFont({");
    expect(layout).not.toContain("next/font/google");
  });

  it("declares the variable weight ranges for all four faces", () => {
    // Fraunces is 100-900; Source Sans 3 is 200-900. Both files default to an
    // instance that is not Regular, so the ranges are what select the axis.
    expect(layout.match(/"100 900"/g)).toHaveLength(2);
    expect(layout.match(/"200 900"/g)).toHaveLength(2);
    expect(layout.match(/style: "normal"/g)).toHaveLength(2);
    expect(layout.match(/style: "italic"/g)).toHaveLength(2);
    expect(layout).toContain('path: "./fonts/Fraunces.ttf"');
    expect(layout).toContain('path: "./fonts/Fraunces-Italic.ttf"');
    expect(layout).toContain('path: "./fonts/SourceSans3.ttf"');
    expect(layout).toContain('path: "./fonts/SourceSans3-Italic.ttf"');
  });

  it("exposes the two variables on <html> and keeps the shell", () => {
    expect(layout).toContain('variable: "--font-fraunces"');
    expect(layout).toContain('variable: "--font-source-sans"');
    expect(layout.match(/display: "swap"/g)).toHaveLength(2);
    expect(layout).toContain("${fraunces.variable}");
    expect(layout).toContain("${sourceSans.variable}");
    expect(layout).toContain('lang="en"');
    expect(layout).toContain('href="#main"');
    expect(layout).toContain("Skip to content");
    expect(layout).toContain("antialiased");
  });
});

describe("no remote font path", () => {
  const sources = walk("src").filter((file) =>
    /\.(ts|tsx|css|md)$/.test(file),
  );

  it("never imports a hosted font in src/**", () => {
    const offenders = sources.filter((file) =>
      readFileSync(path.join(root, file), "utf8").includes("next/font/google"),
    );
    expect(offenders).toEqual([]);
  });

  it("never names a third-party font host in src/**", () => {
    const offenders = sources.filter((file) =>
      /fonts\.(googleapis|gstatic)\.com/.test(
        readFileSync(path.join(root, file), "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("declares no stylesheet font import or @font-face in src/**", () => {
    const offenders = sources.filter((file) => {
      const text = readFileSync(path.join(root, file), "utf8");
      return /@import\s+url\(/.test(text) || /@font-face/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});

describe("theme stacks and readable numerals", () => {
  it("puts each vendored variable first, with a system fallback behind it", () => {
    const css = readText("src/app/globals.css");
    expect(css).toContain(
      "--font-sans: var(--font-source-sans), ui-sans-serif, system-ui",
    );
    expect(css).toContain("--font-serif: var(--font-fraunces), ui-serif, Georgia");
    expect(css).toContain("--text-base: 1.125rem;");
    expect(css).toContain("--text-base--line-height: 1.6;");
    // `leading-relaxed` is bound to the same 1.6 so a body paragraph does not
    // measure 1.625 while the body token says 1.6.
    expect(css).toContain("--leading-relaxed: 1.6;");
  });

  it.each([
    ["src/components/time-card.tsx", "board and claimed times"],
    ["src/components/date-group.tsx", "day-band dates"],
    ["src/components/decision-trail.tsx", "receipt numerals"],
    ["src/components/site-footer.tsx", "the 911 and 988 lines"],
  ])("sets tabular figures on %s (%s)", (file) => {
    expect(readText(file)).toContain("tabular-nums");
  });
});

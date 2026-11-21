import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const appDir = path.join(root, "src", "app");

/**
 * Next resolves a route's `metadata` export before the guard runs, so a
 * refused caregiver would still read the hidden page's name in the tab title.
 * Titles for guarded routes come from the shell after auth. This test fails
 * the gate the moment a guarded file reintroduces a metadata export.
 */
const GUARDED_SEGMENTS = ["ask", "care", "desk", "circle", "my-claims"];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return /\.(tsx|ts|jsx|js)$/.test(entry.name) ? [absolute] : [];
  });
}

describe("guarded routes never export metadata", () => {
  const files = GUARDED_SEGMENTS.flatMap((segment) => {
    const dir = path.join(appDir, segment);
    return walk(dir);
  });

  it("found guarded route files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => path.relative(root, file)))(
    "%s exports no metadata or generateMetadata",
    (relative) => {
      const source = readFileSync(path.join(root, relative), "utf8");
      expect(source).not.toMatch(/export\s+const\s+metadata\b/);
      expect(source).not.toMatch(/export\s+(async\s+)?function\s+generateMetadata\b/);
      expect(source).not.toMatch(/export\s+const\s+generateMetadata\b/);
    },
  );

  it("keeps every guarded page and layout behind a server guard or a title shell", () => {
    const pagesAndLayouts = files.filter((file) =>
      /(page|layout)\.(tsx|ts|jsx|js)$/.test(file),
    );

    for (const file of pagesAndLayouts) {
      const source = readFileSync(file, "utf8");
      expect(
        /requirePage\s*\(/.test(source),
        `${path.relative(root, file)} must call requirePage()`,
      ).toBe(true);
    }
  });
});

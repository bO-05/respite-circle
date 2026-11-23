import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_SESSION_SECRET } from "./helpers/e2e-env";

/**
 * VAL-FOUND-005: no server secret reaches the client bundle.
 *
 * A manual grep is a memory test. This spec walks the production build's own
 * client output (`.next/static`) and fails on a provider key, a database URL,
 * or the exact session secret the test server was configured with. The build
 * is what Playwright's webServer produced for this run, so the check proves
 * the shipped assets, not a remembered command.
 */

const STATIC_DIR = path.join(process.cwd(), ".next", "static");

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }

  return files;
}

function secretValues(): string[] {
  return [
    process.env.MISTRAL_API_KEY,
    process.env.HF_TOKEN,
    process.env.OPENROUTER_API_KEY,
    process.env.SESSION_SECRET,
    process.env.DATABASE_URL,
    process.env.DATABASE_URL_UNPOOLED,
    E2E_SESSION_SECRET,
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.length >= 8,
  );
}

test.describe("the shipped client bundle", () => {
  test("contains no provider key, database URL, or session secret", async () => {
    expect(
      statSync(STATIC_DIR).isDirectory(),
      "the production build must exist before this spec runs",
    ).toBe(true);

    const files = walk(STATIC_DIR).filter((file) =>
      /\.(js|css|json|txt|html)$/.test(file),
    );
    // A production build emits many chunks; an empty list means the build
    // output moved and this check would otherwise pass vacuously.
    expect(files.length).toBeGreaterThan(20);

    const literals = [
      "postgres://",
      "postgresql://",
      ...secretValues(),
    ];
    // Key-shaped prefixes, not bare substrings: `ask-` contains "sk-" and a
    // real provider key is always followed by a long body.
    const keyPatterns = [
      { label: "hf_ provider key", pattern: /\bhf_[A-Za-z0-9]{20,}/ },
      { label: "sk- provider key", pattern: /\bsk-[A-Za-z0-9]{20,}/ },
      {
        label: "sk-or-v1- provider key",
        pattern: /\bsk-or-v1-[A-Za-z0-9]{20,}/,
      },
    ];

    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const literal of literals) {
        if (text.includes(literal)) {
          hits.push(
            `${path.relative(process.cwd(), file)} contains ${literal.slice(0, 16)}`,
          );
        }
      }
      for (const { label, pattern } of keyPatterns) {
        if (pattern.test(text)) {
          hits.push(`${path.relative(process.cwd(), file)} contains ${label}`);
        }
      }
    }

    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });

  test("the served pages carry no connection string or session secret", async ({
    request,
  }) => {
    const needles = ["postgres://", "postgresql://", E2E_SESSION_SECRET];

    for (const route of ["/", "/how-it-works", "/never", "/promises"]) {
      const response = await request.get(route);
      expect(response.status(), route).toBe(200);
      const body = await response.text();
      for (const needle of needles) {
        expect(body, `${route} must not contain ${needle}`).not.toContain(
          needle,
        );
      }
    }
  });
});

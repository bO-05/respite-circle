import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECKED_ROUTES,
  DEFAULT_PRODUCTION_URL,
  HEALTH_PATH,
  SAMPLE_STAMP,
  extractAssetUrls,
  findSecretMarkers,
  resolveExpectedVersion,
} from "../../scripts/smoke-production";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("production smoke command", () => {
  it("is declared as npm run smoke:production", () => {
    expect(pkg.scripts["smoke:production"]).toBe(
      "npx tsx scripts/smoke-production.ts",
    );
  });

  it("points at the deployed HTTPS origin", () => {
    expect(DEFAULT_PRODUCTION_URL).toBe("https://respite-circle.vercel.app");
  });

  it("checks the landing page, the promises page and the health route", () => {
    expect(CHECKED_ROUTES).toContain("/");
    expect(CHECKED_ROUTES).toContain("/promises");
    expect(HEALTH_PATH).toBe("/api/health");
  });

  it("looks for the exact sample-data stamp every page carries", () => {
    expect(SAMPLE_STAMP).toBe(
      "Fictional church, fictional families. Sample data.",
    );
  });
});

describe("resolveExpectedVersion", () => {
  it("prefers an explicit flag over every ref", () => {
    expect(
      resolveExpectedVersion({
        explicit: "abc1234",
        originMain: "def5678",
        head: "9999999",
      }),
    ).toEqual({ version: "abc1234", source: "flag" });
  });

  it("uses local HEAD by default, so a stale build cannot pass", () => {
    expect(
      resolveExpectedVersion({ originMain: "def5678", head: "9999999" }),
    ).toEqual({ version: "9999999", source: "HEAD" });
  });

  it("falls back to origin/main when the checkout has no local ref", () => {
    expect(resolveExpectedVersion({ originMain: "def5678", head: null })).toEqual(
      { version: "def5678", source: "origin/main" },
    );
  });

  it("reports that no expected commit is known", () => {
    expect(resolveExpectedVersion({})).toEqual({
      version: null,
      source: "none",
    });
  });

  it("ignores blank values", () => {
    expect(
      resolveExpectedVersion({ explicit: "  ", originMain: "", head: "1234567" }),
    ).toEqual({ version: "1234567", source: "HEAD" });
  });
});

describe("findSecretMarkers", () => {
  it("catches a Postgres connection string with credentials", () => {
    // Built from parts so the repository itself never contains the literal.
    const scheme = "postgresql";
    const fixture = `${scheme}://neondb_owner:pw@ep-x.neon.tech/neondb`;
    expect(findSecretMarkers(fixture)).toContain(
      "a Postgres connection string with credentials",
    );
  });

  it("catches a model key and a Hugging Face token", () => {
    expect(findSecretMarkers(`key: "sk-${"a".repeat(32)}"`)).toContain(
      "a model key beginning sk-",
    );
    expect(findSecretMarkers(`token: "hf_${"b".repeat(30)}"`)).toContain(
      "a Hugging Face token",
    );
  });

  it("catches a server-only variable assigned a value", () => {
    expect(findSecretMarkers('RC_DEMO_RESET_TOKEN="prod-reset-token-value"')).toContain(
      "a server-only environment variable assigned a value",
    );
    expect(findSecretMarkers("SESSION_SECRET=abcdef0123456789")).toContain(
      "a server-only environment variable assigned a value",
    );
  });

  it("leaves ordinary UI copy and minified code alone", () => {
    const ordinary = [
      "A break for the person who does the caring.",
      "risk-free, task-oriented, mask-like",
      "const t=document.querySelector('h1');function e(){return null}",
      "DATABASE_URL is read on the server only.",
    ].join("\n");
    expect(findSecretMarkers(ordinary)).toEqual([]);
  });
});

describe("extractAssetUrls", () => {
  it("collects script src and preload href chunks once each", () => {
    const html = `
      <script src="/_next/static/chunks/app.js" async=""></script>
      <link rel="preload" href="/_next/static/chunks/app.js" as="script"/>
      <script src="/_next/static/chunks/polyfills.js"></script>
      <link rel="stylesheet" href="/_next/static/css/app.css"/>
      <script src="https://example.com/remote.js"></script>
    `;
    expect(extractAssetUrls(html)).toEqual([
      "/_next/static/chunks/app.js",
      "/_next/static/chunks/polyfills.js",
    ]);
  });

  it("returns nothing when a document serves no client chunk", () => {
    expect(extractAssetUrls("<html><body>no scripts</body></html>")).toEqual([]);
  });
});

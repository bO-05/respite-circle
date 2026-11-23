import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The README is the only place a stranger learns how to run this app, so its
 * claims are checked rather than trusted. These assertions cover the pieces
 * the launch contract names: every documented command must be a real script,
 * the two seeding paths must be stated honestly, deployment must not send a
 * reader through a re-link that rewrites `.env.local`, and the open-source
 * disclosure must separate the hackathon window from the earlier pattern.
 */

const root = process.cwd();
const readme = readFileSync(join(root, "README.md"), "utf8");
const pkg = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

function documentedScripts(): string[] {
  return Array.from(
    readme.matchAll(/npm run ([a-z0-9:_-]+)/gi),
    (match) => match[1],
  );
}

describe("README as app documentation", () => {
  it("only names package scripts that exist", () => {
    const missing = [...new Set(documentedScripts())].filter(
      (name) => !(name in pkg.scripts),
    );
    expect(missing).toEqual([]);
  });

  it("covers install, migrate, seed, reset, run, test, and calibrate", () => {
    expect(readme).toContain("npm install");
    expect(readme).toContain("npm start");
    for (const command of [
      "db:migrate",
      "db:seed",
      "db:reset",
      "dev",
      "build",
      "typecheck",
      "lint",
      "test",
      "test:e2e",
      "calibrate",
      "calibrate:baseline",
    ]) {
      expect(documentedScripts()).toContain(command);
    }
    expect(readme).toContain("3130");
  });

  it("states the app is a prototype with fictional demo data", () => {
    expect(readme.toLowerCase()).toContain("prototype");
    expect(readme.toLowerCase()).toContain("fictional");
  });

  it("explains that the plain seed leaves the board empty and the reset fills it", () => {
    expect(readme).toMatch(/no asks? (?:or|and) (?:no )?slots/i);
    expect(readme.toLowerCase()).toContain("empty");
    expect(readme).toContain("npm run db:reset");
    expect(readme).toContain("POST /api/demo/reset");
    expect(readme).toContain("RC_DEMO_MODE");
    expect(readme).toContain("RC_DEMO_RESET_TOKEN");
    expect(readme).toMatch(/seed digest|seedDigest/i);
    expect(readme).toMatch(/twelve assertions|12\/12|passed: 12/i);
  });

  it("deploys without a re-link and requires the production smoke", () => {
    expect(readme.toLowerCase()).not.toContain("vercel link");
    expect(readme).toContain("npx --yes vercel@latest deploy --prod --yes");
    expect(readme).toContain("npm run smoke:production");
    expect(readme).toContain("[SENSITIVE]");
    expect(readme).toContain("vercel env pull");
  });

  it("carries the open-source disclosure with the hackathon window and licenses", () => {
    expect(readme).toContain("Vouch");
    expect(readme).toContain("October 30");
    expect(readme).toContain("November 27, 2026");
    expect(readme).toContain("Apache-2.0");
    expect(readme).toContain("MIT");
    expect(readme).toContain("Unlicense");
  });
});

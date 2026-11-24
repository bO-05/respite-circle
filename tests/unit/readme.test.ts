import { readFileSync, readdirSync } from "node:fs";
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

describe("VAL-DOC-001 — README as app documentation", () => {
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

  it("VAL-DOC-002 — carries the open-source disclosure with the hackathon window and licenses", () => {
    expect(readme).toContain("Vouch");
    expect(readme).toContain("October 30");
    expect(readme).toContain("November 27, 2026");
    expect(readme).toContain("Apache-2.0");
    expect(readme).toContain("MIT");
    expect(readme).toContain("Unlicense");
  });
});

describe("VAL-AUDITFIX-011 — every approval claim names the meal exception", () => {
  it("names the signed low-risk exception, the stored value, and the audit event", () => {
    expect(readme).toMatch(/signed low-risk policy/i);
    expect(readme).toMatch(/reheatable meal/i);
    expect(readme).toContain("published_via = auto_low_risk");
    expect(readme).toContain("slot_auto_published");
    expect(readme).toMatch(/demo seed\s+leaves\s+the\s+switch\s+off/i);
  });

  it("keeps any approval absolute inside a passage that names the exception", () => {
    const absolutes = readme.matchAll(
      /approves?\s+(?:every\s+(?:one|time|thing)|everything)/gi,
    );
    for (const match of absolutes) {
      const index = match.index ?? 0;
      const passage = readme.slice(Math.max(0, index - 700), index + 700);
      expect(passage, `approval claim at offset ${index}`).toMatch(
        /low-risk|auto_low_risk|reheatable meal/i,
      );
    }
  });
});

/**
 * The desk lead is the coordinator's first sentence about the human gate. It
 * may not promise that a person sees a time before a neighbour does, because
 * a signed low-risk policy with the switch on lets a meal publish at intake
 * (`published_via = auto_low_risk`, logged as `slot_auto_published`). Pin the
 * qualified sentence here so the old absolute cannot return through a copy
 * edit that no other test reads.
 */
const deskDir = join(root, "src", "app", "desk");

function walkDeskSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) return walkDeskSources(absolute);
    return /\.(tsx|ts)$/.test(entry.name) ? [absolute] : [];
  });
}

describe("VAL-AUDITFIX-011 — the desk lead names the meal exception", () => {
  const deskPage = readFileSync(join(deskDir, "page.tsx"), "utf8");
  const lead = /lead="([^"]+)"/.exec(deskPage)?.[1] ?? "";

  it("found the coordinator desk lead to check", () => {
    expect(lead).not.toBe("");
  });

  it("keeps the person-reads promise and names the signed low-risk meal in the same passage", () => {
    expect(lead).toMatch(/^A person reads every ask\b/);
    expect(lead).toMatch(
      /a signed low-risk policy can let a meal publish itself first/i,
    );
    expect(lead).toMatch(/every other kind of time waits for that person/i);
  });

  it("no longer claims a person reads every ask before a neighbour sees a time", () => {
    expect(lead).not.toMatch(/before a neighbour sees a time/i);
  });

  it("does not carry the unqualified absolute anywhere on the desk", () => {
    const files = walkDeskSources(deskDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(
        readFileSync(file, "utf8"),
        `${file} must not restore the unqualified approval absolute`,
      ).not.toMatch(/reads every ask before a neighbour sees a time/i);
    }
  });

  it("keeps safety and personal-care asks pinned in their own groups", () => {
    expect(lead).toMatch(
      /Safety and personal-care asks stay pinned in their own groups\./,
    );
  });
});

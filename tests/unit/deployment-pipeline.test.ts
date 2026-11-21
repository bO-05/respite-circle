import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  engines?: { node?: string };
  scripts: Record<string, string>;
};

function readIfPresent(relativePath: string): string {
  const file = path.join(root, relativePath);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

describe("remote database scripts", () => {
  it.each([
    ["db:migrate:remote", "scripts/db-migrate.ts"],
    ["db:seed:remote", "src/db/seed.ts"],
  ])("declares %s against the direct endpoint", (name, target) => {
    const command = pkg.scripts[name];

    expect(command).toBeTruthy();
    expect(command).toContain(target);
    expect(command).toContain("--remote");
    // The guard must read RC_SEED_ALLOW_REMOTE from the shell, not set it:
    // a script that exports the flag itself would defeat the opt-in.
    expect(command).not.toContain("RC_SEED_ALLOW_REMOTE=");
  });

  it("pins the Node 22 runtime Vercel must use", () => {
    expect(pkg.engines?.node).toBe("22.x");
  });
});

describe("keepalive workflow", () => {
  const workflow = readIfPresent(".github/workflows/keepalive.yml");

  it("exists", () => {
    expect(workflow).not.toBe("");
  });

  it("runs every five minutes", () => {
    expect(workflow).toContain('cron: "*/5 * * * *"');
  });

  it("targets the production health endpoint over HTTPS", () => {
    expect(workflow).toMatch(
      /https:\/\/[a-z0-9.-]+\.vercel\.app\/api\/health/,
    );
  });

  it("gives the request a 15 second budget", () => {
    expect(workflow).toContain("--max-time 15");
  });

  it("can be run by hand as well as on a schedule", () => {
    expect(workflow).toContain("workflow_dispatch:");
  });

  it("carries no credential or connection string", () => {
    expect(workflow).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(workflow).not.toMatch(/postgres(ql)?:\/\//);
  });
});

describe("deployment ignore file", () => {
  const ignore = readIfPresent(".vercelignore");

  it("keeps the local environment file out of the upload", () => {
    expect(ignore).toMatch(/^\.env\.local$/m);
  });

  it("keeps local-only reference and test artefacts out of the upload", () => {
    expect(ignore).toMatch(/^\.research\/$/m);
    expect(ignore).toMatch(/^docs\/$/m);
    expect(ignore).toMatch(/^test-results\/$/m);
    expect(ignore).toMatch(/^playwright-report\/$/m);
  });
});

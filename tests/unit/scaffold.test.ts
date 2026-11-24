import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

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

function isGitIgnored(target: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", target], {
    cwd: root,
  });
  return result.status === 0;
}

describe("package configuration", () => {
  const pkg = JSON.parse(readText("package.json")) as {
    engines?: { node?: string };
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it("pins the Node 22 runtime that Vercel must use", () => {
    expect(pkg.engines?.node).toBe("22.x");
  });

  it.each([
    "dev",
    "build",
    "start",
    "typecheck",
    "lint",
    "test",
    "test:unit",
    "test:integration",
    "test:e2e",
    "db:generate",
    "db:migrate",
    "db:seed",
    "db:reset",
    "calibrate",
    "calibrate:baseline",
  ])("declares the %s script", (name) => {
    expect(pkg.scripts?.[name]).toBeTruthy();
  });

  it("serves dev and start on port 3130 only", () => {
    expect(pkg.scripts?.dev).toContain("-p 3130");
    expect(pkg.scripts?.start).toContain("-p 3130");
  });

  it("typechecks with next typegen and tsc, never next lint", () => {
    expect(pkg.scripts?.typecheck).toContain("next typegen");
    expect(pkg.scripts?.typecheck).toContain("tsc --noEmit");
    // ESLint CLI first, then the banned-claim copy lint; `next lint` is gone.
    expect(pkg.scripts?.lint).toContain("eslint . --max-warnings=0");
    expect(pkg.scripts?.lint).toContain("lint-copy.ts");
    expect(pkg.scripts?.lint).not.toContain("next lint");
  });

  it("fails the build on a banned claim", () => {
    expect(pkg.scripts?.prebuild).toContain("lint-copy.ts");
  });

  it.each([
    "next",
    "react",
    "react-dom",
    "typescript",
    "tailwindcss",
    "vitest",
    "@playwright/test",
    "drizzle-orm",
    "drizzle-kit",
    "postgres",
    "zod",
    "ai",
    "jsdom",
    "@types/node",
  ])("pins %s to an exact architecture version", (name) => {
    const version = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    expect(version, `${name} must be a dependency`).toBeTruthy();
    expect(version, `${name} must not use a range`).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("Next.js configuration", () => {
  const config = readText("next.config.ts");

  it("does not enable Cache Components", () => {
    expect(config).not.toMatch(/cacheComponents\s*:/);
  });

  it("adds no webpack configuration", () => {
    expect(config).not.toMatch(/^\s*webpack\s*:/m);
  });
});

describe("design tokens", () => {
  const css = readText("src/app/globals.css").toLowerCase();
  const theme = /@theme\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";

  const tokens: Record<string, string> = {
    paper: "#faf6f0",
    ink: "#2b2622",
    accent: "#b4552d",
    green: "#2e7d4f",
    amber: "#a86a12",
    muted: "#f2ece4",
    line: "#e7ddd0",
  };

  it("imports Tailwind", () => {
    expect(css).toContain('@import "tailwindcss";');
  });

  it.each(Object.entries(tokens))(
    "declares --color-%s as a Tailwind theme token",
    (name, value) => {
      expect(theme).toContain(`--color-${name}: ${value};`);
    },
  );

  it("sets an 18px base size with 1.6 line height", () => {
    expect(theme).toContain("--text-base: 1.125rem;");
    expect(theme).toContain("--text-base--line-height: 1.6;");
  });

  it("declares a system serif heading stack and a sans body stack", () => {
    expect(theme).toContain("--font-serif:");
    expect(theme).toContain("--font-sans:");
    expect(css).not.toContain("next/font/google");
  });
});

describe("environment contract", () => {
  const example = readText(".env.example");

  it.each([
    "MISTRAL_API_KEY",
    "HF_TOKEN",
    "OPENROUTER_API_KEY",
    "LLM_PROVIDER",
    "LLM_TIMEOUT_MS",
    "RC_MODEL",
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "E2E_DATABASE_URL",
    "E2E_DATABASE_URL_UNPOOLED",
    "RC_DB_BRANCH",
    "SESSION_SECRET",
    "RC_DEMO_MODE",
    "RC_DEMO_RESET_TOKEN",
    "RC_DEMO_LIVE_AI",
    "RC_SEED_ALLOW_REMOTE",
    "NEXT_PUBLIC_APP_URL",
  ])("documents %s", (name) => {
    expect(example).toMatch(new RegExp(`^${name}=`, "m"));
  });

  it("contains no credential-shaped value", () => {
    expect(example).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(example).not.toMatch(/hf_[A-Za-z0-9]{16,}/);
    expect(example).not.toMatch(/postgres(ql)?:\/\/[^\s/]+:[^\s@]+@/);
  });

  it("leaves SESSION_SECRET empty and states the requirement", () => {
    expect(example).toMatch(/^SESSION_SECRET=\s*$/m);
    expect(example).not.toMatch(/change-me/i);
    expect(example).toMatch(/^# .*random.*$/m);
  });

  it.each([
    "MISTRAL_API_KEY",
    "HF_TOKEN",
    "OPENROUTER_API_KEY",
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "E2E_DATABASE_URL",
    "E2E_DATABASE_URL_UNPOOLED",
    "RC_DEMO_RESET_TOKEN",
    "SESSION_SECRET",
  ])("leaves the credential %s without a value", (name) => {
    expect(example).toMatch(new RegExp(`^${name}=\\s*$`, "m"));
  });
});

describe("git hygiene", () => {
  it("keeps real environment values out of git", () => {
    expect(isGitIgnored(".env.local")).toBe(true);
  });

  it("keeps the documented template in git", () => {
    expect(isGitIgnored(".env.example")).toBe(false);
  });

  it.each([
    "node_modules/react/package.json",
    ".next/cache/webpack",
    "test-results/pw-results.json",
    "playwright-report/index.html",
    "docs/respite-circle-source/README.md",
    ".research/validation-runs/run.png",
  ])("ignores %s", (target) => {
    expect(isGitIgnored(target)).toBe(true);
  });
});

describe("app scaffolding", () => {
  it("renders the sample-data stamp from the root shell on every page", () => {
    const copy = readText("src/lib/site-navigation.ts");
    expect(copy).toContain("Fictional church, fictional families. Sample data.");

    const footer = readText("src/components/site-footer.tsx");
    expect(footer).toContain("SAMPLE_DATA_STAMP");

    const layout = readText("src/app/layout.tsx");
    expect(layout).toContain("<SiteFooter />");
  });

  it("ships no credential-shaped strings in app source or configuration", () => {
    const files = [
      ...walk("src"),
      ...walk("tests"),
      "next.config.ts",
      "eslint.config.mjs",
      "playwright.config.ts",
      "vitest.config.ts",
      "vitest.base.ts",
      "package.json",
      "README.md",
    ];

    for (const file of files) {
      const text = readText(file);
      expect(text, file).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
      expect(text, file).not.toMatch(/hf_[A-Za-z0-9]{16,}/);
      expect(text, file).not.toMatch(/postgres(ql)?:\/\/[^\s/]+:[^\s@]+@/);
      expect(text, file).not.toMatch(/BEGIN (RSA |EC )?PRIVATE KEY/);
    }
  });
});

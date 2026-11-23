#!/usr/bin/env node
/**
 * `npm run smoke:production` — the executable production check.
 *
 * It fetches the deployed origin over HTTPS and fails on:
 * - any non-200 from `/`, `/api/health`, `/promises`, `/how-it-works`, or `/never`;
 * - a landing page or trust page missing the sample-data stamp;
 * - `/api/health` reporting `ok: false` or a `db` other than `ok`;
 * - a `version` that differs from the pushed `main` commit, because every push
 *   to `main` auto-deploys and a stale build must not pass as the shipped one;
 * - a served client chunk containing a Postgres connection string, a model
 *   key, or an assigned server-only environment variable.
 *
 * Expected commit precedence: `--expected=<sha>`, then `RC_EXPECTED_VERSION`,
 * then `git rev-parse --short HEAD` (the commit you are standing on, which is
 * also the pushed `main` commit in a clean checkout), then `origin/main` when
 * no local `HEAD` is available. The script never reads `.env.local` and never
 * prints a secret: only pass/fail lines and the measured milliseconds.
 *
 * Override the origin with `RC_PRODUCTION_URL`; raise the per-request budget
 * with `RC_SMOKE_TIMEOUT_MS`.
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_PRODUCTION_URL = "https://respite-circle.vercel.app";
export const SAMPLE_STAMP =
  "Fictional church, fictional families. Sample data.";
export const CHECKED_ROUTES = ["/", "/promises", "/how-it-works", "/never"] as const;
export const HEALTH_PATH = "/api/health";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const timeoutMs = Number(process.env.RC_SMOKE_TIMEOUT_MS ?? 20_000);
const baseUrl = (process.env.RC_PRODUCTION_URL ?? DEFAULT_PRODUCTION_URL).replace(
  /\/+$/,
  "",
);

export type VersionSource = "flag" | "origin/main" | "HEAD" | "none";

/**
 * Pick the commit production is expected to serve. The checkout's `HEAD` is
 * the shipped commit; `origin/main` is only a fallback for a detached export
 * with no local ref, and the caller must say so in its header.
 */
export function resolveExpectedVersion(input: {
  explicit?: string | null;
  originMain?: string | null;
  head?: string | null;
}): { version: string | null; source: VersionSource } {
  const explicit = input.explicit?.trim();
  if (explicit) return { version: explicit, source: "flag" };
  const head = input.head?.trim();
  if (head) return { version: head, source: "HEAD" };
  const originMain = input.originMain?.trim();
  if (originMain) return { version: originMain, source: "origin/main" };
  return { version: null, source: "none" };
}

const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /postgres(?:ql)?:\/\/[^\s"'`<>]*:[^\s"'`<>]*@/i,
    label: "a Postgres connection string with credentials",
  },
  {
    pattern: /\bsk-[A-Za-z0-9_-]{20,}/,
    label: "a model key beginning sk-",
  },
  {
    pattern: /\bhf_[A-Za-z0-9]{20,}/,
    label: "a Hugging Face token",
  },
  {
    pattern:
      /\b(?:DATABASE_URL_UNPOOLED|DATABASE_URL|SESSION_SECRET|RC_DEMO_RESET_TOKEN|MISTRAL_API_KEY|HF_TOKEN)\s*[:=]\s*['"]?[A-Za-z0-9+/_=:.-]{12,}/,
    label: "a server-only environment variable assigned a value",
  },
];

/** Report every secret-looking marker in a served document or chunk. */
export function findSecretMarkers(text: string): string[] {
  return SECRET_PATTERNS.filter((entry) => entry.pattern.test(text)).map(
    (entry) => entry.label,
  );
}

/** Client chunks referenced by a served document, in document order, deduped. */
export function extractAssetUrls(html: string): string[] {
  const urls = new Set<string>();
  const pattern = /(?:src|href)="(\/_next\/static\/[^"?#]+\.js)"/g;
  let match = pattern.exec(html);
  while (match) {
    urls.add(match[1]);
    match = pattern.exec(html);
  }
  return [...urls];
}

type Check = { ok: boolean; name: string; detail: string; ms: number };

async function fetchText(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: string; contentType: string; ms: number }> {
  const started = Date.now();
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "user-agent": "respite-circle-production-smoke/1.0",
      "cache-control": "no-cache",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.text();
  return {
    status: response.status,
    body,
    contentType: response.headers.get("content-type") ?? "",
    ms: Date.now() - started,
  };
}

function gitShort(ref: string): string | null {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", ref], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return sha || null;
  } catch {
    return null;
  }
}

function explicitFlag(): string | null {
  const prefix = "--expected=";
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

async function run(): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(check);

  const head = gitShort("HEAD");
  const originMain = gitShort("origin/main");
  const expected = resolveExpectedVersion({
    explicit: explicitFlag() ?? process.env.RC_EXPECTED_VERSION,
    originMain,
    head,
  });

  console.log(`production smoke  ${baseUrl}`);
  console.log(
    `expected commit   ${expected.version ?? "cannot determine"} (${expected.source})`,
  );
  if (head && originMain && head !== originMain) {
    console.log(
      `local HEAD        ${head} (origin/main is ${originMain}; push to make a fresh clone compare the same commit)`,
    );
  } else if (head) {
    console.log(`local HEAD        ${head}`);
  }
  console.log("");

  const pages = new Map<string, string>();
  for (const route of CHECKED_ROUTES) {
    try {
      const page = await fetchText(`${baseUrl}${route}`);
      pages.set(route, page.body);
      const stamp = page.body.includes(SAMPLE_STAMP);
      add({
        ok: page.status === 200 && stamp,
        name: `GET ${route}`,
        detail:
          page.status !== 200
            ? `expected 200, got ${page.status}`
            : !stamp
              ? "sample-data stamp missing"
              : `${page.contentType.split(";")[0]}`,
        ms: page.ms,
      });
    } catch (error) {
      add({
        ok: false,
        name: `GET ${route}`,
        detail: error instanceof Error ? error.message : "request failed",
        ms: 0,
      });
    }
  }

  try {
    const health = await fetchText(`${baseUrl}${HEALTH_PATH}`);
    let body: Record<string, unknown> = {};
    let parseError = "";
    try {
      body = JSON.parse(health.body) as Record<string, unknown>;
    } catch {
      parseError = "body is not JSON";
    }
    const version = typeof body.version === "string" ? body.version : "";
    const versionOk = expected.version !== null && version === expected.version;
    const providerOk =
      body.provider === "configured" || body.provider === "unconfigured";
    const markers = findSecretMarkers(health.body);
    const problems: string[] = [];
    if (health.status !== 200) problems.push(`expected 200, got ${health.status}`);
    if (parseError) problems.push(parseError);
    if (body.ok !== true) problems.push(`ok is ${JSON.stringify(body.ok)}`);
    if (body.db !== "ok") problems.push(`db is ${JSON.stringify(body.db)}`);
    if (!providerOk) problems.push(`provider is ${JSON.stringify(body.provider)}`);
    if (expected.version === null) {
      problems.push(
        "cannot determine the expected commit; set RC_EXPECTED_VERSION=<short sha>",
      );
    } else if (!versionOk) {
      problems.push(
        `version ${JSON.stringify(version)} does not match ${expected.version} (${expected.source})`,
      );
    }
    if (markers.length > 0) problems.push(`secret marker: ${markers.join(", ")}`);
    add({
      ok: problems.length === 0,
      name: `GET ${HEALTH_PATH}`,
      detail:
        problems.length === 0
          ? `ok, db ok, provider ${String(body.provider)}, version ${version}`
          : problems.join("; "),
      ms: health.ms,
    });
  } catch (error) {
    add({
      ok: false,
      name: `GET ${HEALTH_PATH}`,
      detail: error instanceof Error ? error.message : "request failed",
      ms: 0,
    });
  }

  // The served client must not carry a server secret. Scan every chunk the
  // landing page and `/promises` reference, not just the HTML.
  const documents = [pages.get("/") ?? "", pages.get("/promises") ?? ""];
  const assetUrls = [...new Set(documents.flatMap((html) => extractAssetUrls(html)))];
  if (assetUrls.length === 0) {
    add({
      ok: false,
      name: "client bundle secret scan",
      detail: "no /_next/static chunks found in the served documents",
      ms: 0,
    });
  } else {
    const leaked: string[] = [];
    let failedAssets = 0;
    let scanned = 0;
    const started = Date.now();
    for (const asset of assetUrls) {
      try {
        const chunk = await fetchText(`${baseUrl}${asset}`);
        if (chunk.status !== 200) {
          failedAssets += 1;
          continue;
        }
        scanned += 1;
        for (const marker of findSecretMarkers(chunk.body)) {
          leaked.push(`${asset}: ${marker}`);
        }
      } catch {
        failedAssets += 1;
      }
    }
    const problems: string[] = [];
    if (failedAssets > 0) problems.push(`${failedAssets} chunk(s) not served`);
    if (leaked.length > 0) problems.push(`secret in client: ${leaked.join("; ")}`);
    add({
      ok: problems.length === 0,
      name: "client bundle secret scan",
      detail:
        problems.length === 0
          ? `${scanned} chunk(s), no connection string, key, or server env`
          : problems.join("; "),
      ms: Date.now() - started,
    });
  }

  return checks;
}

function printChecks(checks: Check[]): void {
  let failed = 0;
  for (const check of checks) {
    if (!check.ok) failed += 1;
    const status = check.ok ? "PASS" : "FAIL";
    console.log(
      `${status}  ${check.name.padEnd(26, " ")} ${String(check.ms).padStart(5, " ")} ms  ${check.detail}`,
    );
  }
  console.log("");
  console.log(
    failed === 0
      ? `Smoke passed: ${checks.length} checks against ${baseUrl}.`
      : `Smoke failed: ${failed} of ${checks.length} checks did not pass.`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

async function main(): Promise<void> {
  printChecks(await run());
}

function isDirectRun(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(entry).href === metaUrl;
}

if (isDirectRun(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(
      `Smoke could not run: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}

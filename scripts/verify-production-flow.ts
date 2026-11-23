#!/usr/bin/env node
/**
 * `npm run verify:production-flow` — the production proof of VAL-CROSS-005.
 *
 * This is the only command in the repository that writes to production.
 * `smoke:production` stays read-only by design; this one has to claim a time
 * to prove the claim route works on the deployed build, so it says so in its
 * own output before it writes anything, and it resets the demo in a `finally`
 * block so a failed run cannot leave the judged demo mutated.
 *
 * What it proves on the configured production origin:
 * - a seeded person enters through the real access link and receives a session;
 * - `/circle` serves at least one open, claimable card;
 * - the real `POST /api/slots/<id>/claim` records Ruth's claim;
 * - the board and `/my-claims` both read the claim back;
 * - `POST /api/demo/reset` returns `reset: true`, twelve passed assertions out
 *   of twelve, and a `sha256:` seed digest.
 *
 * The origin is fixed to the configured production origin. A different host,
 * an HTTP URL, or a URL with a path is refused before anything is written. The
 * reset token is read from `RC_DEMO_RESET_TOKEN` (or `.env.local`) and is never
 * printed, stored, or echoed; errors carry the URL and the status only.
 *
 * Escape hatches, for a slow cold start only: `RC_VERIFY_TIMEOUT_MS` and
 * `RC_VERIFY_RESET_TIMEOUT_MS`. Neither can change the target.
 */
import { pathToFileURL } from "node:url";
import { loadEnvLocal } from "../src/db/env";
import { seedAccessTokens } from "../src/db/seed-data";

export const CONFIGURED_PRODUCTION_ORIGIN = "https://respite-circle.vercel.app";
export const HEALTH_PATH = "/api/health";
export const RESET_PATH = "/api/demo/reset";
export const CIRCLE_PATH = "/circle";
export const MY_CLAIMS_PATH = "/my-claims";
export const SESSION_COOKIE = "rc_session";
export const EXPECTED_ASSERTIONS = 12;

const requestTimeoutMs = Number(process.env.RC_VERIFY_TIMEOUT_MS ?? 30_000);
const resetTimeoutMs = Number(
  process.env.RC_VERIFY_RESET_TIMEOUT_MS ?? 120_000,
);

export type Check = { ok: boolean; name: string; detail: string; ms: number };

export type OriginDecision =
  | { ok: true; origin: string }
  | { ok: false; message: string };

/**
 * Only the configured production origin may be mutated. `RC_PRODUCTION_URL`
 * may restate it (with a trailing slash, for example), but it cannot redirect
 * a destructive command at a preview deployment or a local server.
 */
export function resolveProductionOrigin(raw?: string | null): OriginDecision {
  const candidate = (raw ?? CONFIGURED_PRODUCTION_ORIGIN).trim();

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, message: `refuses "${candidate}": not a URL` };
  }

  if (url.protocol !== "https:") {
    return {
      ok: false,
      message: `refuses ${url.origin}: production verification must use HTTPS`,
    };
  }

  if (url.username || url.password) {
    return {
      ok: false,
      message: `refuses ${url.origin}: an origin carries no credentials`,
    };
  }

  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    return {
      ok: false,
      message: `refuses "${candidate}": pass the origin, not a path`,
    };
  }

  const origin = url.origin;
  if (origin !== CONFIGURED_PRODUCTION_ORIGIN) {
    return {
      ok: false,
      message: `refuses ${origin}: this command mutates only ${CONFIGURED_PRODUCTION_ORIGIN}`,
    };
  }

  return { ok: true, origin };
}

type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect?: RequestRedirect;
};

type Fetched = {
  status: number;
  body: string;
  headers: Headers;
  ms: number;
};

async function request(
  url: string,
  options: RequestOptions = {},
  timeout = requestTimeoutMs,
): Promise<Fetched> {
  const started = Date.now();
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "user-agent": "respite-circle-production-flow/1.0",
      "cache-control": "no-cache",
      ...(options.headers ?? {}),
    },
    body: options.body,
    redirect: options.redirect ?? "follow",
    signal: AbortSignal.timeout(timeout),
  });
  return {
    status: response.status,
    body: await response.text(),
    headers: response.headers,
    ms: Date.now() - started,
  };
}

/** The `name=value` pair for the signed session cookie, or null. */
export function readSessionCookie(headers: Headers): string | null {
  const candidates: string[] = [];
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === "function") {
    candidates.push(...withGetter.getSetCookie());
  }
  const single = headers.get("set-cookie");
  if (single) candidates.push(single);

  for (const raw of candidates) {
    const pair = raw.split(";")[0]?.trim() ?? "";
    if (
      pair.startsWith(`${SESSION_COOKIE}=`) &&
      pair.length > SESSION_COOKIE.length + 1
    ) {
      return pair;
    }
  }
  return null;
}

export type HtmlCard = { id: string; status: string; eligible: boolean };

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? match[1] : null;
}

/** Cards rendered with one `data-testid`, read from the served document. */
export function htmlCards(html: string, testId: string): HtmlCard[] {
  const cards: HtmlCard[] = [];
  const pattern = new RegExp(`<li[^>]*data-testid="${testId}"[^>]*>`, "g");

  for (const match of html.matchAll(pattern)) {
    const tag = match[0];
    const id = attribute(tag, "data-slot-id");
    const status = attribute(tag, "data-status");
    if (!id || !status) continue;
    cards.push({
      id,
      status,
      eligible: attribute(tag, "data-eligible") === "true",
    });
  }

  return cards;
}

export type ResetSuccess = {
  reset: true;
  church: string;
  seedDigest: string;
  counts: Record<string, number>;
  assertions: { passed: number; total: number; failed: string[] };
};

/**
 * Every reason the reset response is not a verified success. An empty list is
 * the only passing verdict; a 200 alone is never enough.
 */
export function validateResetResponse(status: number, body: unknown): string[] {
  const problems: string[] = [];

  if (status !== 200) problems.push(`expected 200, got ${status}`);
  if (typeof body !== "object" || body === null) {
    problems.push("body is not JSON");
    return problems;
  }

  const payload = body as Partial<ResetSuccess>;
  if (payload.reset !== true) {
    problems.push(`reset is ${JSON.stringify(payload.reset)}`);
  }
  if (payload.assertions?.passed !== EXPECTED_ASSERTIONS) {
    problems.push(
      `assertions passed is ${JSON.stringify(payload.assertions?.passed)}`,
    );
  }
  if (payload.assertions?.total !== EXPECTED_ASSERTIONS) {
    problems.push(
      `assertions total is ${JSON.stringify(payload.assertions?.total)}`,
    );
  }
  if (
    !Array.isArray(payload.assertions?.failed) ||
    payload.assertions.failed.length > 0
  ) {
    problems.push(
      `failed assertions: ${JSON.stringify(payload.assertions?.failed)}`,
    );
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(payload.seedDigest ?? "")) {
    problems.push("seed digest is missing or not sha256");
  }

  return problems;
}

async function resetDemo(origin: string, token: string): Promise<Check> {
  const started = Date.now();
  try {
    const response = await request(
      `${origin}${RESET_PATH}`,
      {
        method: "POST",
        headers: {
          "x-demo-reset-token": token,
          accept: "application/json",
        },
        body: "",
      },
      resetTimeoutMs,
    );

    let body: unknown = null;
    try {
      body = JSON.parse(response.body) as unknown;
    } catch {
      body = null;
    }

    const problems = validateResetResponse(response.status, body);
    const digest =
      typeof (body as Partial<ResetSuccess> | null)?.seedDigest === "string"
        ? (body as ResetSuccess).seedDigest
        : null;

    return {
      ok: problems.length === 0,
      name: `POST ${RESET_PATH}`,
      detail:
        problems.length === 0
          ? `reset true, ${EXPECTED_ASSERTIONS}/${EXPECTED_ASSERTIONS} assertions, ${digest}`
          : problems.join("; "),
      ms: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      name: `POST ${RESET_PATH}`,
      detail: `reset could not run: ${
        error instanceof Error ? error.message : String(error)
      }`,
      ms: Date.now() - started,
    };
  }
}

async function run(): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(check);

  const decision = resolveProductionOrigin(process.env.RC_PRODUCTION_URL);
  if (!decision.ok) {
    add({ ok: false, name: "configured origin", detail: decision.message, ms: 0 });
    return checks;
  }
  const origin = decision.origin;

  loadEnvLocal();
  const token = (process.env.RC_DEMO_RESET_TOKEN ?? "").trim();
  if (!token) {
    add({
      ok: false,
      name: "reset token",
      detail:
        "RC_DEMO_RESET_TOKEN is not set; nothing was written and nothing was reset",
      ms: 0,
    });
    return checks;
  }

  console.log(`production flow  ${origin}`);
  console.log("");
  console.log("MUTATES PRODUCTION. This command signs in as a seeded volunteer,");
  console.log("claims one open time through the real claim route, then resets the");
  console.log("demo to the seeded state. The reset runs in a finally block even");
  console.log("when a check fails. The token is never printed.");
  console.log("");

  try {
    const health = await request(`${origin}${HEALTH_PATH}`);
    let healthBody: Record<string, unknown> = {};
    try {
      healthBody = JSON.parse(health.body) as Record<string, unknown>;
    } catch {
      healthBody = {};
    }
    add({
      ok:
        health.status === 200 &&
        healthBody.ok === true &&
        healthBody.db === "ok",
      name: `GET ${HEALTH_PATH}`,
      detail:
        health.status === 200
          ? `db ${String(healthBody.db)}, version ${String(healthBody.version)}`
          : `expected 200, got ${health.status}`,
      ms: health.ms,
    });

    // The seeded access link is the real entry: it issues the signed session
    // cookie, so every later request is the same person the app sees.
    const entered = await request(
      `${origin}/enter/${seedAccessTokens.ruth}`,
      { redirect: "manual" },
    );
    const cookie = readSessionCookie(entered.headers);
    add({
      ok:
        (entered.status === 200 || entered.status === 303) && cookie !== null,
      name: "access link",
      detail:
        cookie === null
          ? `no ${SESSION_COOKIE} cookie (status ${entered.status})`
          : `signed in as the seeded volunteer (status ${entered.status})`,
      ms: entered.ms,
    });
    if (!cookie) {
      throw new Error("the access link did not issue a session; no claim was sent");
    }

    const board = await request(`${origin}${CIRCLE_PATH}`, {
      headers: { cookie, accept: "text/html" },
    });
    const openCards = htmlCards(board.body, "board-slot").filter(
      (card) => card.status === "open",
    );
    const claimable = openCards.filter((card) => card.eligible);
    add({
      ok: board.status === 200 && openCards.length >= 1,
      name: `GET ${CIRCLE_PATH}`,
      detail:
        board.status !== 200
          ? `expected 200, got ${board.status}`
          : `${openCards.length} open card(s)`,
      ms: board.ms,
    });
    add({
      ok: claimable.length >= 1,
      name: "claimable card",
      detail:
        claimable.length === 0
          ? "no open card offers a claim to this volunteer"
          : `${claimable.length} card(s) claimable`,
      ms: 0,
    });
    if (claimable.length === 0) {
      throw new Error("there was no claimable card, so no claim was sent");
    }

    const slot = claimable[0];

    // A JSON accept header asks the route for its real status instead of the
    // browser's 303 back to the board. Same route, same atomic UPDATE.
    const claimed = await request(`${origin}/api/slots/${slot.id}/claim`, {
      method: "POST",
      headers: {
        cookie,
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    let claimBody: Record<string, unknown> = {};
    try {
      claimBody = JSON.parse(claimed.body) as Record<string, unknown>;
    } catch {
      claimBody = {};
    }
    add({
      ok:
        claimed.status === 200 &&
        claimBody.ok === true &&
        claimBody.status === "claimed" &&
        claimBody.slotId === slot.id,
      name: "POST /api/slots/:id/claim",
      detail:
        claimed.status === 200
          ? `claimed ${slot.id}`
          : `expected 200, got ${claimed.status} (${String(claimBody.code ?? "no code")})`,
      ms: claimed.ms,
    });
    if (claimed.status !== 200) {
      throw new Error("the claim route refused the real claim");
    }

    const reread = await request(`${origin}${CIRCLE_PATH}`, {
      headers: { cookie, accept: "text/html" },
    });
    const recorded = htmlCards(reread.body, "board-slot").find(
      (card) => card.id === slot.id,
    );
    add({
      ok: recorded?.status === "claimed",
      name: "claim recorded on the board",
      detail:
        recorded === undefined
          ? "the claimed time is no longer on the board"
          : `board status ${recorded.status}`,
      ms: reread.ms,
    });

    const mine = await request(`${origin}${MY_CLAIMS_PATH}`, {
      headers: { cookie, accept: "text/html" },
    });
    const myClaim = htmlCards(mine.body, "my-claim").find(
      (card) => card.id === slot.id,
    );
    add({
      ok: mine.status === 200 && myClaim?.status === "claimed",
      name: `GET ${MY_CLAIMS_PATH}`,
      detail:
        mine.status !== 200
          ? `expected 200, got ${mine.status}`
          : myClaim === undefined
            ? "the claim is not listed"
            : `claim status ${myClaim.status}`,
      ms: mine.ms,
    });
  } catch (error) {
    add({
      ok: false,
      name: "flow",
      detail: error instanceof Error ? error.message : String(error),
      ms: 0,
    });
  } finally {
    // The reset is the cleanup and the last assertion. It runs even when the
    // claim above failed, so a half-finished run cannot leave the demo altered.
    const reset = await resetDemo(origin, token);
    add(reset);
  }

  return checks;
}

function printChecks(checks: Check[], origin: string | null): void {
  let failed = 0;
  for (const check of checks) {
    if (!check.ok) failed += 1;
    const status = check.ok ? "PASS" : "FAIL";
    console.log(
      `${status}  ${check.name.padEnd(30, " ")} ${String(check.ms).padStart(6, " ")} ms  ${check.detail}`,
    );
  }
  console.log("");
  if (failed === 0) {
    console.log(
      `Production flow verified: ${checks.length} checks against ${origin}, and the demo was reset to the seed.`,
    );
    process.exitCode = 0;
    return;
  }

  // Say what happened to the demo, rather than assuming the reset ran: an
  // origin or token refusal stops before any write.
  const resetCheck = checks.find((check) => check.name === `POST ${RESET_PATH}`);
  const resetLine = !resetCheck
    ? "No write was sent, so the demo was not touched."
    : resetCheck.ok
      ? "The demo was reset to the seed in the finally block."
      : "The finally-block reset did not pass; reset the demo again before the judged window.";
  console.log(
    `Production flow failed: ${failed} of ${checks.length} checks did not pass. ${resetLine}`,
  );
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const decision = resolveProductionOrigin(process.env.RC_PRODUCTION_URL);
  const checks = await run();
  printChecks(checks, decision.ok ? decision.origin : null);
}

function isDirectRun(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(entry).href === metaUrl;
}

if (isDirectRun(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(
      `Production flow could not run: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}

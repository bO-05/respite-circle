import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CIRCLE_PATH,
  CONFIGURED_PRODUCTION_ORIGIN,
  EXPECTED_ASSERTIONS,
  HEALTH_PATH,
  MY_CLAIMS_PATH,
  RESET_PATH,
  htmlCards,
  readSessionCookie,
  resolveProductionOrigin,
  validateResetResponse,
} from "../../scripts/verify-production-flow";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

const GOOD_RESET = {
  reset: true,
  church: "Grace Community Church",
  seedDigest: `sha256:${"a".repeat(64)}`,
  counts: { ask: 4, slot: 3, notification: 0 },
  assertions: { passed: 12, total: 12, failed: [] },
};

describe("production flow command", () => {
  it("is declared as npm run verify:production-flow", () => {
    expect(pkg.scripts["verify:production-flow"]).toBe(
      "npx tsx scripts/verify-production-flow.ts",
    );
  });

  it("points at the configured production origin only", () => {
    expect(CONFIGURED_PRODUCTION_ORIGIN).toBe(
      "https://respite-circle.vercel.app",
    );
  });

  it("uses the real access, board, claims and reset surfaces", () => {
    expect(HEALTH_PATH).toBe("/api/health");
    expect(CIRCLE_PATH).toBe("/circle");
    expect(MY_CLAIMS_PATH).toBe("/my-claims");
    expect(RESET_PATH).toBe("/api/demo/reset");
    expect(EXPECTED_ASSERTIONS).toBe(12);
  });

  it("says out loud that it mutates production before writing", () => {
    const source = readFileSync(
      path.join(root, "scripts", "verify-production-flow.ts"),
      "utf8",
    );
    expect(source).toContain("MUTATES PRODUCTION");
    expect(source).toContain("The token is never printed.");
    // The token travels in a header only. A token in a URL would reach access
    // logs and proxy logs, so the interpolation must not exist anywhere.
    expect(source).not.toContain("${token}");
    expect(source).not.toMatch(/x-demo-reset-token["'`]\s*[:=]\s*[`"']/);
  });
});

describe("resolveProductionOrigin", () => {
  it("accepts the configured origin, with or without a trailing slash", () => {
    expect(resolveProductionOrigin(undefined)).toEqual({
      ok: true,
      origin: CONFIGURED_PRODUCTION_ORIGIN,
    });
    expect(resolveProductionOrigin(CONFIGURED_PRODUCTION_ORIGIN)).toEqual({
      ok: true,
      origin: CONFIGURED_PRODUCTION_ORIGIN,
    });
    expect(resolveProductionOrigin(`${CONFIGURED_PRODUCTION_ORIGIN}/`)).toEqual({
      ok: true,
      origin: CONFIGURED_PRODUCTION_ORIGIN,
    });
  });

  it("refuses HTTP, another host, a path and credentials", () => {
    expect(resolveProductionOrigin("http://respite-circle.vercel.app")).toMatchObject(
      { ok: false },
    );
    expect(resolveProductionOrigin("http://127.0.0.1:3130")).toMatchObject({
      ok: false,
    });
    expect(resolveProductionOrigin("https://example.com")).toMatchObject({
      ok: false,
    });
    expect(
      resolveProductionOrigin("https://preview-abc.vercel.app"),
    ).toMatchObject({ ok: false });
    expect(
      resolveProductionOrigin(`${CONFIGURED_PRODUCTION_ORIGIN}/circle`),
    ).toMatchObject({ ok: false });
    expect(
      resolveProductionOrigin("https://user:pw@respite-circle.vercel.app"),
    ).toMatchObject({ ok: false });
    expect(resolveProductionOrigin("not a url")).toMatchObject({ ok: false });
  });
});

describe("readSessionCookie", () => {
  it("keeps the name=value pair and drops the attributes", () => {
    const headers = new Headers();
    headers.append(
      "set-cookie",
      "rc_session=abc.def; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(readSessionCookie(headers)).toBe("rc_session=abc.def");
  });

  it("ignores an unrelated cookie", () => {
    const headers = new Headers();
    headers.append("set-cookie", "other=1; Path=/");
    expect(readSessionCookie(headers)).toBeNull();
  });

  it("returns null when the link set no cookie", () => {
    expect(readSessionCookie(new Headers())).toBeNull();
  });
});

describe("htmlCards", () => {
  it("reads the board cards, their status, and whether a claim is offered", () => {
    const html = `
      <ul data-testid="board-list">
        <li data-testid="board-slot" data-slot-id="slot-a" data-kind="companion" data-status="open" data-gated="false" data-eligible="true">...</li>
        <li data-testid="board-slot" data-slot-id="slot-b" data-kind="home" data-status="open" data-gated="true" data-eligible="false">...</li>
        <li data-testid="board-slot" data-slot-id="slot-c" data-kind="meal" data-status="claimed" data-gated="false">...</li>
      </ul>
    `;
    expect(htmlCards(html, "board-slot")).toEqual([
      { id: "slot-a", status: "open", eligible: true },
      { id: "slot-b", status: "open", eligible: false },
      { id: "slot-c", status: "claimed", eligible: false },
    ]);
  });

  it("reads the volunteer's own claim cards", () => {
    const html = `
      <li data-testid="my-claim" data-slot-id="slot-a" data-kind="companion" data-status="claimed">...</li>
    `;
    expect(htmlCards(html, "my-claim")).toEqual([
      { id: "slot-a", status: "claimed", eligible: false },
    ]);
  });

  it("finds nothing in a calm empty board", () => {
    expect(htmlCards('<section data-testid="board-open"></section>', "board-slot")).toEqual(
      [],
    );
  });
});

describe("validateResetResponse", () => {
  it("passes only a 200 with twelve assertions and a sha256 digest", () => {
    expect(validateResetResponse(200, GOOD_RESET)).toEqual([]);
  });

  it("rejects a non-200 even when the body looks successful", () => {
    expect(validateResetResponse(500, GOOD_RESET).join(" ")).toMatch(
      /expected 200, got 500/,
    );
  });

  it("rejects a success claim with a failed assertion", () => {
    const problems = validateResetResponse(200, {
      ...GOOD_RESET,
      assertions: { passed: 11, total: 12, failed: ["session_count_4"] },
    });
    expect(problems.join(" ")).toMatch(/assertions passed is 11/);
    expect(problems.join(" ")).toMatch(/failed assertions/);
  });

  it("rejects reset:false even with a digest field", () => {
    expect(
      validateResetResponse(200, { ...GOOD_RESET, reset: false }).join(" "),
    ).toMatch(/reset is false/);
  });

  it("rejects a missing or malformed seed digest", () => {
    expect(
      validateResetResponse(200, { ...GOOD_RESET, seedDigest: "" }).join(" "),
    ).toMatch(/seed digest/);
    expect(
      validateResetResponse(200, { ...GOOD_RESET, seedDigest: "abc" }).join(" "),
    ).toMatch(/seed digest/);
  });

  it("rejects an HTML body, which is what a missing route serves", () => {
    expect(validateResetResponse(200, null)).toEqual(["body is not JSON"]);
  });
});

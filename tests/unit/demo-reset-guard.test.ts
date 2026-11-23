import { describe, expect, it } from "vitest";
import { demoResetGuard } from "../../src/server/auth/demo-reset";

const TOKEN = "a-demo-reset-token";
const ON = { RC_DEMO_MODE: "1", RC_DEMO_RESET_TOKEN: TOKEN };

describe("demo reset guard", () => {
  it("is indistinguishable from a missing route when demo mode is off", () => {
    expect(demoResetGuard(TOKEN, { RC_DEMO_RESET_TOKEN: TOKEN })).toEqual({
      ok: false,
      status: 404,
      error: "Not found.",
    });
    expect(
      demoResetGuard(TOKEN, {
        RC_DEMO_MODE: "false",
        RC_DEMO_RESET_TOKEN: TOKEN,
      }),
    ).toEqual({ ok: false, status: 404, error: "Not found." });
  });

  it("is unavailable when no reset token is configured", () => {
    expect(demoResetGuard(TOKEN, { RC_DEMO_MODE: "true" })).toEqual({
      ok: false,
      status: 404,
      error: "Not found.",
    });
  });

  it("requires the token header", () => {
    expect(demoResetGuard(null, ON)).toEqual({
      ok: false,
      status: 401,
      error: "A demo reset token is required.",
    });
  });

  it("refuses a wrong token without echoing either value", () => {
    const result = demoResetGuard("wrong-token", ON);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(result.error).not.toContain(TOKEN);
    expect(result.error).not.toContain("wrong-token");
  });

  it("accepts only the configured token", () => {
    expect(demoResetGuard(TOKEN, ON)).toEqual({ ok: true });
    expect(
      demoResetGuard(TOKEN, { RC_DEMO_MODE: "TRUE", RC_DEMO_RESET_TOKEN: TOKEN }),
    ).toEqual({ ok: true });
  });
});

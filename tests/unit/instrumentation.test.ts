import { describe, expect, it } from "vitest";
import { register } from "../../src/instrumentation";

const SHIPPED_PLACEHOLDER = "change-me-to-a-long-random-value";
const REAL_PRODUCTION_SECRET = "unit-test-production-secret-0123456789abcdef";

function env(
  NODE_ENV: string,
  SESSION_SECRET?: string,
): Record<string, string | undefined> {
  return SESSION_SECRET === undefined
    ? { NODE_ENV }
    : { NODE_ENV, SESSION_SECRET };
}

describe("the instrumentation gate", () => {
  it("refuses the published placeholder when NODE_ENV is production", () => {
    expect(() =>
      register(env("production", SHIPPED_PLACEHOLDER)),
    ).toThrow(/published placeholder/);
  });

  it("names the problem without carrying the value", () => {
    let message = "";
    try {
      register(env("production", SHIPPED_PLACEHOLDER));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("SESSION_SECRET");
    expect(message).toMatch(/placeholder/i);
    expect(message).not.toContain(SHIPPED_PLACEHOLDER);
  });

  it("starts development with the placeholder", () => {
    expect(() =>
      register(env("development", SHIPPED_PLACEHOLDER)),
    ).not.toThrow();
  });

  it("starts production with a real secret", () => {
    expect(() =>
      register(env("production", REAL_PRODUCTION_SECRET)),
    ).not.toThrow();
  });

  it("leaves a missing secret to the request-time loader", () => {
    expect(() => register(env("production"))).not.toThrow();
  });
});

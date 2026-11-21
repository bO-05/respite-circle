import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHealthPayload,
  HEALTH_DB_TIMEOUT_MS,
  isProviderConfigured,
  probeDatabase,
  resolveVersion,
  withTimeout,
} from "../../src/server/health";

describe("health database budget", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows more than six seconds for a cold Neon wake", () => {
    // Measured on this project: the first query after an idle period takes
    // 5.4-5.6 s; warm round trips are 264-358 ms. A cold wake is slow, not
    // broken, so the budget must sit above the six-second floor.
    expect(HEALTH_DB_TIMEOUT_MS).toBeGreaterThan(6_000);
  });

  it("treats a 5.5 s cold wake inside the budget as ok", async () => {
    vi.useFakeTimers();
    const query = new Promise<string>((resolve) => {
      setTimeout(() => resolve("woke"), 5_500);
    });

    const result = probeDatabase(() => query, HEALTH_DB_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(5_600);

    await expect(result).resolves.toBe("ok");
  });

  it("reports down and cancels a query that exceeds the budget", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const pending = {
      then: () => undefined,
      cancel,
    } as unknown as PromiseLike<unknown> & { cancel: () => void };

    const result = probeDatabase(() => pending, 8_000);
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(result).resolves.toBe("down");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("reports down when the database rejects the probe", async () => {
    const query = Promise.reject(new Error("connection closed"));
    await expect(probeDatabase(() => query)).resolves.toBe("down");
  });

  it("resolves a query inside the budget", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1_000)).resolves.toBe("ok");
  });
});

describe("health payload", () => {
  const SECRETS = {
    MISTRAL_API_KEY: "sk-test-should-never-appear",
    DATABASE_URL: "postgres://example.neon.tech/neondb",
    SESSION_SECRET: "session-secret-value",
  };

  it("reports the provider as configured from any supported key", () => {
    expect(isProviderConfigured({ MISTRAL_API_KEY: "x" })).toBe(true);
    expect(isProviderConfigured({ HF_TOKEN: "x" })).toBe(true);
    expect(isProviderConfigured({ OPENROUTER_API_KEY: "x" })).toBe(true);
    expect(isProviderConfigured({})).toBe(false);
  });

  it("builds the documented shape and carries no configured secret", () => {
    const payload = buildHealthPayload({
      db: "ok",
      providerConfigured: isProviderConfigured(SECRETS),
    });

    expect(payload).toEqual({
      ok: true,
      db: "ok",
      provider: "configured",
      version: "local",
    });

    const text = JSON.stringify(payload);
    expect(text).not.toContain("sk-test");
    expect(text).not.toContain("postgres");
    expect(text).not.toContain("session-secret");
  });

  it("marks a down database as not ok without hiding it", () => {
    expect(
      buildHealthPayload({ db: "down", providerConfigured: false }),
    ).toEqual({
      ok: false,
      db: "down",
      provider: "unconfigured",
      version: "local",
    });
  });

  it("uses the git commit, then the deployment id, as the version", () => {
    expect(resolveVersion({ VERCEL_GIT_COMMIT_SHA: "abcdef123456" })).toBe(
      "abcdef1",
    );
    expect(resolveVersion({ VERCEL_DEPLOYMENT_ID: "dpl_123456789" })).toBe(
      "dpl_123",
    );
    expect(resolveVersion({})).toBe("local");
  });
});

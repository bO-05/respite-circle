import { describe, expect, it } from "vitest";
import { loadEnvLocal } from "../../src/db/env";
import { seedQuestionSet } from "../../src/db/seed-data";
import { decide } from "../../src/server/services/decide";
import { createMistralProvider } from "../../src/server/services/providers";

/**
 * One opt-in live smoke against the real provider. Never part of a gate:
 * `RC_LIVE_MODEL=1` must be set explicitly, so `npm test`, Playwright, and the
 * calibration baseline can never spend tokens.
 */

const live = process.env.RC_LIVE_MODEL === "1";

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

describe.skipIf(!live)("live Mistral decision smoke", () => {
  it("returns nine typed decisions for Marta's hero ask", async () => {
    loadEnvLocal();
    const apiKey = process.env.MISTRAL_API_KEY;
    expect(apiKey, "MISTRAL_API_KEY is required for the live smoke").toBeTruthy();

    const result = await decide({
      askText: HERO_ASK,
      questions: seedQuestionSet,
      policyVersion: "live-smoke",
      provider: createMistralProvider({ apiKey: apiKey as string }),
      timeoutMs: 45_000,
    });

    expect(result.provider).toBe("mistral");
    expect(result.engine).toBe("live");
    expect(result.degraded).toBe(false);
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.decisions).toHaveLength(9);
    expect(result.decisions.map((decision) => decision.questionId)).toEqual([
      "Q1",
      "Q2",
      "Q3",
      "Q4",
      "Q5",
      "Q6",
      "Q7",
      "Q8",
      "Q9",
    ]);
    for (const decision of result.decisions) {
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
      expect([
        "boolean",
        "string",
      ]).toContain(typeof decision.answer);
    }
  }, 120_000);
});

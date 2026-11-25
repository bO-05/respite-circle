import { describe, expect, it } from "vitest";
import {
  DEMO_FALLBACK_REASONS,
  demoFallbackSentence,
  isDemoFallbackReason,
} from "@/server/domain/demo-fallback";

/**
 * VAL-R2PROM-008 — a fallback is explained, not printed as a code.
 *
 * The reset returns `provider_unconfigured`, `provider_failed`, or
 * `structure_mismatch` per ask. A receipt a person reads must say what
 * happened in words and must never leave a fallback blank or show a raw
 * identifier.
 */

describe("demo fallback sentences", () => {
  it("gives every known reason a plain sentence with no stored code", () => {
    for (const reason of DEMO_FALLBACK_REASONS) {
      const sentence = demoFallbackSentence(reason);
      expect(sentence, reason).not.toBeNull();
      expect(sentence, reason).toMatch(/labelled rules engine answered/i);
      expect(sentence, reason).not.toContain("_");
      expect(sentence, reason).not.toMatch(
        /provider_unconfigured|provider_failed|structure_mismatch/i,
      );
    }
  });

  it("names the signed policy when the model and the policy disagree", () => {
    expect(demoFallbackSentence("structure_mismatch")).toMatch(
      /model's answers disagreed with the church's policy/i,
    );
  });

  it("says a missing model is missing, not broken", () => {
    expect(demoFallbackSentence("provider_unconfigured")).toMatch(
      /no model was set up/i,
    );
    expect(demoFallbackSentence("provider_failed")).toMatch(
      /model did not answer/i,
    );
  });

  it("is silent when nothing fell back", () => {
    expect(demoFallbackSentence(null)).toBeNull();
    expect(demoFallbackSentence(undefined)).toBeNull();
    expect(demoFallbackSentence("   ")).toBeNull();
  });

  it("never hides an unrecognised reason behind a blank line", () => {
    expect(demoFallbackSentence("some_future_reason")).toBe(
      "The labelled rules engine answered instead of the model. The run recorded the reason as some future reason.",
    );
  });

  it("recognises only the stored reasons", () => {
    for (const reason of DEMO_FALLBACK_REASONS) {
      expect(isDemoFallbackReason(reason)).toBe(true);
    }
    expect(isDemoFallbackReason("fell_back")).toBe(false);
    expect(isDemoFallbackReason(null)).toBe(false);
    expect(isDemoFallbackReason(7)).toBe(false);
  });
});

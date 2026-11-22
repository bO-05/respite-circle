import { describe, expect, it } from "vitest";
import {
  CLAIM_OUTCOME_CODES,
  claimCopy,
  claimHttpStatus,
  isClaimOutcome,
  isRuleCode,
  type ClaimOutcomeCode,
} from "@/server/domain/claim";
import { RULE_CODES, type RuleCode } from "@/server/domain/gating";

/**
 * The claim's human words, as pure copy.
 *
 * Every outcome a volunteer can meet on the claim route — a win, a race loss, a
 * locked gate, a missing time, the wrong role — has exactly one calm sentence.
 * None of them carries SQL, an internal id, a count, a shame word, or a banned
 * claim. The copy is unit-tested here so the route and the board can share it
 * without a browser.
 */

const SQL_WORDS =
  /\b(SELECT|UPDATE|INSERT|DELETE|DROP|SQLSTATE|postgres|pg_|constraint|relation|column|table)\b/i;
const BANNED_CLAIMS =
  /\b(vetted|HIPAA|platform|AI-powered care|certified safe|fully screened|ecosystem|marketplace|orchestration|seamless|revolutionize|empathy at scale)\b/i;
const SHAMING =
  /\b(unclaimed|declines?|declined|views?|viewed|waiting time|places? left|spaces? left|remaining|no one (has )?claimed|nobody claimed)\b/i;
const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function expectHuman(sentence: string): void {
  expect(sentence.length).toBeGreaterThan(20);
  expect(sentence).not.toMatch(SQL_WORDS);
  expect(sentence).not.toMatch(BANNED_CLAIMS);
  expect(sentence).not.toMatch(SHAMING);
  expect(sentence).not.toMatch(UUID);
}

describe("the claim outcome copy", () => {
  it("names every outcome as a closed set", () => {
    expect([...CLAIM_OUTCOME_CODES].sort()).toEqual(
      [
        "already_yours",
        "claimed",
        "locked",
        "not_found",
        "not_open",
        "not_volunteer",
        "taken",
      ].sort(),
    );
  });

  it("accepts only a known outcome and a known rule code", () => {
    for (const code of CLAIM_OUTCOME_CODES) {
      expect(isClaimOutcome(code)).toBe(true);
    }
    expect(isClaimOutcome("sql_error")).toBe(false);
    expect(isClaimOutcome(null)).toBe(false);

    for (const code of RULE_CODES) {
      expect(isRuleCode(code)).toBe(true);
    }
    expect(isRuleCode("no_such_rule")).toBe(false);
    expect(isRuleCode(undefined)).toBe(false);
  });

  it("maps each outcome to the status the route returns", () => {
    expect(claimHttpStatus("claimed")).toBe(200);
    expect(claimHttpStatus("taken")).toBe(409);
    expect(claimHttpStatus("already_yours")).toBe(409);
    expect(claimHttpStatus("not_open")).toBe(409);
    expect(claimHttpStatus("locked")).toBe(403);
    expect(claimHttpStatus("not_volunteer")).toBe(403);
    expect(claimHttpStatus("not_found")).toBe(404);
  });

  it("gives every outcome a human sentence with no SQL, id, count, or shame", () => {
    for (const code of CLAIM_OUTCOME_CODES) {
      expectHuman(claimCopy(code));
      // A named coordinator never turns the sentence into an id or a count.
      expectHuman(claimCopy(code, { coordinatorFirstName: "Grace" }));
    }
  });

  it("names the person who confirms the claim when that person is known", () => {
    expect(claimCopy("claimed", { coordinatorFirstName: "Grace" })).toContain(
      "Grace",
    );
    expect(claimCopy("claimed", { coordinatorFirstName: null })).toContain(
      "Your coordinator",
    );
  });

  it("never starts a sentence with the lower-case fallback name", () => {
    for (const code of CLAIM_OUTCOME_CODES) {
      const sentence = claimCopy(code, { coordinatorFirstName: null });
      expect(sentence).not.toMatch(/\.\s+your coordinator/);
      // Every sentence that follows a full stop begins with a capital.
      for (const part of sentence.split(/(?<=\.)\s+/)) {
        expect(part.charAt(0)).toBe(part.charAt(0).toUpperCase());
      }
    }
  });

  it("uses the board's second-person lock copy for every refusal rule", () => {
    for (const code of RULE_CODES) {
      if (code === "eligible") continue;
      const sentence = claimCopy("locked", {
        ruleCode: code as Exclude<RuleCode, "eligible">,
        coordinatorFirstName: "Grace",
      });
      expectHuman(sentence);
      expect(sentence).toContain("Grace");
    }
  });

  it("falls back to a calm locked sentence when the rule is unknown", () => {
    const sentence = claimCopy("locked", { coordinatorFirstName: "Grace" });
    expectHuman(sentence);
    expect(sentence).not.toMatch(/undefined|null/);
    expect(sentence).toContain("Grace");
  });

  it("never answers a race loss with SQL or a stack-shaped sentence", () => {
    const taken = claimCopy("taken");
    expect(taken).toBe(
      "Someone else just claimed this — thank you for saying yes.",
    );
    expect(taken).not.toMatch(/error|failed|exception|conflict|409/i);
  });

  it("is exhaustive: every outcome code is handled by the copy switch", () => {
    const seen = new Set<string>();
    for (const code of CLAIM_OUTCOME_CODES) {
      seen.add(claimCopy(code satisfies ClaimOutcomeCode));
    }
    // Distinct sentences, not one generic fallback for every code.
    expect(seen.size).toBe(CLAIM_OUTCOME_CODES.length);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASK_SAMPLES,
  SAMPLE_RECEIPT,
  SAMPLE_RECEIPT_LABEL,
  SAMPLE_RECEIPT_NOTE,
} from "@/lib/ask-samples";

/**
 * VAL-R4VIS-002 — the home page's sample receipt is a fictional, three-line
 * yes/no sample under a label that names the role.
 *
 * The name rule is the reason this is a unit test as well as an e2e one: the
 * home page is public and has no church to resolve a coordinator's name from,
 * so a literal like "what Grace reads" would be false on every other church's
 * screen. The label must stay role-only.
 */
describe("the home page's sample receipt", () => {
  it("shows exactly three yes/no answers", () => {
    expect(SAMPLE_RECEIPT.lines).toHaveLength(3);
    for (const line of SAMPLE_RECEIPT.lines) {
      expect(line.label.trim().length).toBeGreaterThan(0);
      expect(["Yes", "No"]).toContain(line.answer);
    }
  });

  it("names the reader as a role, never a person", () => {
    expect(SAMPLE_RECEIPT_LABEL).toBe("A sample of what your coordinator reads");
    const text = [
      SAMPLE_RECEIPT_LABEL,
      SAMPLE_RECEIPT_NOTE,
      SAMPLE_RECEIPT.words,
      ...SAMPLE_RECEIPT.lines.map((line) => line.label),
    ].join("\n");
    expect(text).not.toMatch(/\bGrace\b/);
    expect(text).not.toMatch(/\bNora\b/);
    expect(text).not.toMatch(/what [A-Z][a-z]+ reads/);
  });

  it("marks the sample fictional and keeps the nine-answer record honest", () => {
    expect(SAMPLE_RECEIPT_NOTE).toMatch(/fictional example/i);
    expect(SAMPLE_RECEIPT_NOTE).toMatch(/nine answers/i);
  });

  it("quotes the seeded demo ask word for word", () => {
    // VAL-R5DES-006: the quote on the page is the same string a tester finds
    // in the seeded demo data. The first two sentences of the demo reset's
    // hero ask appear in demo-state.ts and in the calibration data.
    const seededDemo = readFileSync(
      path.join(process.cwd(), "src", "db", "demo-state.ts"),
      "utf8",
    );
    const calibration = readFileSync(
      path.join(process.cwd(), "data", "calibration.json"),
      "utf8",
    );
    expect(seededDemo).toContain(SAMPLE_RECEIPT.words);
    expect(calibration).toContain(SAMPLE_RECEIPT.words);
    expect(SAMPLE_RECEIPT.words).toBe(
      "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.",
    );
  });

  it("leaves the five ask examples the ask screen offers intact", () => {
    expect(ASK_SAMPLES).toHaveLength(5);
    expect(ASK_SAMPLES.filter((sample) => !sample.supported)).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  appendSpokenText,
  characterCountLabel,
  consentSentence,
  MAX_ASK_LENGTH,
  receiptSentence,
  validateAskSubmission,
} from "@/server/domain/ask-intake";
import {
  ASK_SAMPLES,
  ASK_SAMPLE_NOTICE,
  sampleById,
} from "@/lib/ask-samples";

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

function longAsk(length: number): string {
  return "a".repeat(length);
}

describe("ask submission validation", () => {
  it("accepts the caregiver's words and returns them byte-identical", () => {
    const text =
      "  I haven't had a Saturday morning to myself since March.\n\n" +
      "Mum is fine with people she knows \u2014 she just can't be alone.\n" +
      "She loves hymns and tea, and she naps after lunch.  ";

    const result = validateAskSubmission({ text, consent: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Verbatim means nobody trims, normalises, or smart-quotes her words.
    expect(result.text).toBe(text);
    expect(result.text.length).toBe(text.length);
  });

  it("rejects an empty submission with a calm message", () => {
    const result = validateAskSubmission({ text: "", consent: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("empty");
    expect(result.message).toMatch(/few words/i);
  });

  it("rejects whitespace-only text and creates nothing", () => {
    for (const text of ["   ", "\n\n\t\r ", " \u00a0 "]) {
      const result = validateAskSubmission({ text, consent: true });
      expect(result.ok, JSON.stringify(text)).toBe(false);
      if (!result.ok) expect(result.code).toBe("empty");
    }
  });

  it("rejects a non-string submission without throwing", () => {
    for (const text of [undefined, null, 42, { words: HERO_ASK }]) {
      const result = validateAskSubmission({ text, consent: true });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid");
    }
  });

  it("requires the consent line to be acknowledged", () => {
    for (const consent of [false, undefined, "true", 1, null]) {
      const result = validateAskSubmission({ text: HERO_ASK, consent });
      expect(result.ok, String(consent)).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("consent_required");
        expect(result.message).toMatch(/tick the box/i);
      }
    }
  });

  it("accepts a 4,000-character ask and stores every character", () => {
    const text = longAsk(4_000);
    const result = validateAskSubmission({ text, consent: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.length).toBe(4_000);
    expect(result.text).toBe(text);
    expect(MAX_ASK_LENGTH).toBeGreaterThanOrEqual(4_000);
  });

  it("refuses text beyond the storage limit instead of truncating it", () => {
    const text = longAsk(MAX_ASK_LENGTH + 1);
    const result = validateAskSubmission({ text, consent: true });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("too_long");
      expect(result.message).toContain(
        MAX_ASK_LENGTH.toLocaleString("en-US"),
      );
    }
  });
});

describe("ask copy", () => {
  it("names the coordinator and says she reads it first", () => {
    const sentence = receiptSentence("Grace");

    expect(sentence).toMatch(/^Grace reads every ask first\./);
    expect(sentence).toMatch(/Nothing is shown to anyone until she approves it\./);
  });

  it("never pretends a named person exists when the church has none", () => {
    const sentence = receiptSentence(null);

    expect(sentence).toMatch(/your coordinator reads every ask first/i);
    expect(sentence).not.toContain("null");
  });

  it("states the consent line in the first person and names the reader", () => {
    const sentence = consentSentence("Grace");

    expect(sentence).toMatch(/^I understand that Grace reads this first/);
    expect(sentence).toMatch(/nothing is shown to anyone else/i);
    expect(consentSentence(null)).toMatch(/my coordinator reads this first/i);
  });

  it("counts characters without judging them", () => {
    expect(characterCountLabel(0)).toBe("0 characters");
    expect(characterCountLabel(1)).toBe("1 character");
    expect(characterCountLabel(4_000)).toBe("4,000 characters");
    expect(characterCountLabel(MAX_ASK_LENGTH + 5)).toMatch(/over the limit/i);
  });

  it("appends spoken words with a single separating space", () => {
    expect(appendSpokenText("", "Mum is fine")).toBe("Mum is fine");
    expect(appendSpokenText("Mum is fine", "with people she knows")).toBe(
      "Mum is fine with people she knows",
    );
    expect(appendSpokenText("Line one.\n", "Line two.")).toBe(
      "Line one.\nLine two.",
    );
    expect(appendSpokenText("A", "  B  ")).toBe("A B");
  });
});

describe("fictional sample asks", () => {
  it("offers exactly the five promised examples", () => {
    expect(ASK_SAMPLES.map((sample) => sample.id)).toEqual([
      "marta",
      "david",
      "priya",
      "personal-care",
      "safety",
    ]);
  });

  it("labels the examples fictional in visible copy", () => {
    expect(ASK_SAMPLE_NOTICE).toMatch(/fictional/i);
    for (const sample of ASK_SAMPLES) {
      expect(sample.title.length).toBeGreaterThan(0);
      expect(sample.body.length).toBeGreaterThan(40);
    }
  });

  it("uses the approved hero wording for the three named families", () => {
    expect(sampleById("marta")?.body).toContain(
      "I haven't had a Saturday morning to myself since March.",
    );
    expect(sampleById("david")?.body).toContain("June has physio");
    expect(sampleById("priya")?.body).toContain("Dad has dialysis");
  });

  it("includes a personal-care example and a safety example", () => {
    expect(sampleById("personal-care")?.body).toMatch(
      /medication|bathing|toileting|lifting/i,
    );
    expect(sampleById("safety")?.body).toMatch(
      /leaving the house|scared|fall|wandering/i,
    );
  });

  it("returns undefined for an unknown sample id", () => {
    expect(sampleById("nope")).toBeUndefined();
  });
});

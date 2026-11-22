import { describe, expect, it } from "vitest";
import {
  ABSTENTION_SENTENCE,
  CONFIDENCE_LABEL,
  PLAIN_CODE_SENTENCE,
  RULES_BANNER,
  buildTrailRows,
  formatAnswer,
  formatConfidencePercent,
  formatLatency,
  publicationSentence,
  revisionTrailSentence,
  summariseDraftKinds,
  type TrailAnswerInput,
} from "@/server/domain/decision-trail";

/**
 * The render guard for the decision trail.
 *
 * Everything the page can say about an answer passes through these functions.
 * A typed decision has no prose field; an unknown pick token or any other
 * unexpected value becomes the human handoff rather than raw text on screen.
 */

function input(overrides: Partial<TrailAnswerInput> = {}): TrailAnswerInput {
  return {
    questionId: "Q1",
    questionText:
      "Is there a sitting or companionship need — someone staying with them?",
    answerType: "yesno",
    answer: true,
    confidence: 0.93,
    abstained: false,
    samples: 1,
    ...overrides,
  };
}

describe("decision trail formatting", () => {
  it("labels confidence as the model's stated confidence, never a probability", () => {
    expect(CONFIDENCE_LABEL).toBe("the model's stated confidence");
    expect(CONFIDENCE_LABEL.toLowerCase()).not.toContain("probability");
    expect(formatConfidencePercent(0.930000007)).toBe("93%");
  });

  it("clamps a stored confidence into a whole percentage", () => {
    expect(formatConfidencePercent(0)).toBe("0%");
    expect(formatConfidencePercent(1)).toBe("100%");
    expect(formatConfidencePercent(-0.4)).toBe("0%");
    expect(formatConfidencePercent(1.9)).toBe("100%");
    expect(formatConfidencePercent(Number.NaN)).toBe("0%");
  });

  it("renders yes/no and only the closed pick labels", () => {
    expect(formatAnswer("Q1", "yesno", true)).toBe("Yes");
    expect(formatAnswer("Q1", "yesno", false)).toBe("No");
    expect(formatAnswer("Q4", "pick", "saturday")).toBe("Saturday");
    expect(formatAnswer("Q7", "pick", "reheats")).toBe("reheats");
    expect(formatAnswer("Q4", "pick", "not on the list")).toBeNull();
    expect(formatAnswer("Q1", "yesno", "Yes")).toBeNull();
    expect(formatAnswer("Q1", "yesno", null)).toBeNull();
  });

  it("formats latency for a tired reader", () => {
    expect(formatLatency(null)).toBe("not recorded");
    expect(formatLatency(undefined)).toBe("not recorded");
    expect(formatLatency(0)).toBe("0 ms");
    expect(formatLatency(245)).toBe("245 ms");
    expect(formatLatency(1_900)).toBe("1.9 s");
    expect(formatLatency(12_340)).toBe("12.3 s");
  });

  it("shows the human handoff and no guessed answer for an abstention", () => {
    const [row] = buildTrailRows([input({ abstained: true })]);

    expect(row.abstained).toBe(true);
    expect(row.answerLabel).toBeNull();
    expect(row.handoff).toBe(ABSTENTION_SENTENCE);
    expect(ABSTENTION_SENTENCE).toBe(
      "This isn't mine to answer — a person will decide.",
    );
  });

  it("turns any unrecognised answer into the handoff, never raw text", () => {
    const [row] = buildTrailRows([
      input({ answerType: "pick", answer: "I am worried about Marta" }),
    ]);

    expect(row.answerLabel).toBeNull();
    expect(row.abstained).toBe(true);
    expect(row.handoff).toBe(ABSTENTION_SENTENCE);
    expect(JSON.stringify(row)).not.toContain("worried");
    expect(JSON.stringify(row)).not.toContain("Marta");
  });

  it("keeps a typed answer and its confidence on an ordinary row", () => {
    const [row] = buildTrailRows([input({ samples: 3 })]);

    expect(row.answerLabel).toBe("Yes");
    expect(row.abstained).toBe(false);
    expect(row.handoff).toBeNull();
    expect(row.confidencePercent).toBe("93%");
    expect(row.samples).toBe(3);
  });

  it("names the revision the answers belong to", () => {
    expect(revisionTrailSentence(1, 1)).toBe(
      "These answers are about your first words.",
    );
    expect(revisionTrailSentence(2, 2)).toContain("version 2 of your words");
    expect(revisionTrailSentence(2, 2)).toMatch(/latest wording/i);
    expect(revisionTrailSentence(2, 2)).not.toContain("version 1");
  });

  it("summarises draft proposals by kind without printing their labels", () => {
    const summary = summariseDraftKinds(["companion", "home", "home"]);

    expect(summary).toContain("3 possible times");
    expect(summary).toContain("a companion place");
    expect(summary).toContain("a home visit");
    expect(summary).toContain("not published");
    expect(summariseDraftKinds([])).toBeNull();
  });

  it("says plainly that nothing has been published yet", () => {
    expect(publicationSentence(0)).toBe(
      "Nothing has been published yet. No time is shown to anyone until Grace approves it.",
    );
    expect(publicationSentence(2)).toContain("2 times");
  });

  it("states that plain code, not the model, builds proposals", () => {
    expect(PLAIN_CODE_SENTENCE).toContain("Plain code");
    expect(PLAIN_CODE_SENTENCE).toContain("not the model");
    expect(PLAIN_CODE_SENTENCE).toContain("proposed time");
  });

  it("keeps the design-system wording for a rules-based run", () => {
    expect(RULES_BANNER).toBe(
      "Auto-filled by rules, not AI — please verify.",
    );
  });
});

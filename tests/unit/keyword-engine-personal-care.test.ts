import { describe, expect, it } from "vitest";
import { seedQuestionSet } from "@/db/seed-data";
import {
  mentionsPersonalCare,
  runKeywordEngine,
} from "@/server/domain/keyword-engine";

/**
 * VAL-AUDITFIX-009 — the offline personal-care lexicon.
 *
 * A personal-care miss in the deterministic engine is a confident Q9=false at
 * 0.78, which is above the 0.60 abstention threshold, so no care_hold is raised
 * and plain code builds slots. Every weak word therefore needs a positive case
 * that flags and a declining case that stays negative, and the built-in slot
 * notes must keep passing the same predicate.
 */

function q9(askText: string) {
  const answer = runKeywordEngine({
    askText,
    questions: seedQuestionSet,
  }).find((entry) => entry.questionId === "Q9");

  if (!answer) throw new Error("Q9 was not answered");
  return answer;
}

/**
 * A positive must be answered YES at or above the abstention threshold. An
 * abstention routes to care_hold too, but asserting confidence keeps a weak
 * match from passing as a clear answer.
 */
function expectPersonalCareFlagged(askText: string) {
  const answer = q9(askText);
  expect(answer.answer, askText).toBe(true);
  expect(answer.confidence, askText).toBeGreaterThanOrEqual(0.6);
}

/**
 * A near-miss negative must be a clear NO, not an abstention: 0.45 and below is
 * still a care_hold, which would turn "she takes her own tablets" into a
 * refusal to help.
 */
function expectPersonalCareNotFlagged(askText: string) {
  const answer = q9(askText);
  expect(answer.answer, askText).toBe(false);
  expect(answer.confidence, askText).toBeGreaterThanOrEqual(0.6);
}

/**
 * One row per weak word the audit found missing. The positive phrasing names a
 * care need through the word; the declining phrasing keeps the same word and
 * says the person manages it themselves.
 */
const WEAK_WORD_CASES = [
  {
    word: "pills",
    positive: "Mum won't take her pills unless someone puts them in her hand.",
    declining: "She takes her own pills, so don't worry about that.",
  },
  {
    word: "tablets",
    positive: "Make sure she takes her tablets with dinner.",
    declining: "She takes her own tablets with dinner.",
  },
  {
    word: "wash",
    positive: "Could someone help her wash on Tuesdays?",
    declining: "She washes and dresses herself now.",
  },
  {
    word: "get dressed",
    positive: "Could someone help her get dressed before church?",
    declining: "She gets dressed herself, so no help needed there.",
  },
  {
    word: "bathroom",
    positive: "Dad needs help getting to the bathroom at night.",
    declining: "No help needed in the bathroom — she manages by herself.",
  },
  {
    word: "pads",
    positive: "Could a volunteer change her pads in the morning?",
    declining: "She changes her own pads, thank you.",
  },
  {
    word: "briefs",
    positive: "He needs help changing his briefs in the morning.",
    declining: "He changes his own briefs before breakfast.",
  },
  {
    word: "hygiene",
    positive: "He needs help with his hygiene since the stroke.",
    declining: "No help needed with his hygiene.",
  },
] as const;

/**
 * The built-in slot notes (companion, home, drive, meal) are read by a
 * volunteer after they claim. They say "no medication", "no bathing or
 * toileting", and "no personal care" on purpose; the lexicon must keep treating
 * those as a clear NO or every published slot would trip the same screen the
 * Q9 hold uses. VAL-AUDITFIX-003 runs these exact notes through the draft
 * editor's screen too, so they live here once.
 */
const BUILT_IN_NOTES = [
  "You will be with Elena at Respite Morning. Elena is most comfortable with people they already know, so please introduce yourself by name and stay near their table. This is company, not personal care — no medication and no lifting.",
  "You will be with Elena at Respite Morning. Introduce yourself by name, sit near their table, and let them set the pace. This is company, not personal care — no medication and no lifting.",
  "A visit at home with Elena. Companionship only — no medication, no bathing or toileting, and no lifting. Two hours at most. The first visit is two people, or your coordinator introduces you. Check in and out with your coordinator.",
  "A ride for Elena. Wait at the appointment and bring them home. No personal care and no lifting. Check the volunteer-driver insurance note with your coordinator before you drive.",
  "A meal for Elena, left at the door. It needs to reheat well. Label the dish and any allergens, and there is no need to go inside.",
] as const;

describe("the fallback personal-care lexicon catches weak words (VAL-AUDITFIX-009)", () => {
  for (const { word, positive, declining } of WEAK_WORD_CASES) {
    it(`flags personal care when the ask names ${word}`, () => {
      expectPersonalCareFlagged(positive);
    });

    it(`does not flag personal care when the ask declines ${word}`, () => {
      expectPersonalCareNotFlagged(declining);
    });
  }

  it("flags the audit's three positive phrasings", () => {
    expectPersonalCareFlagged("help her wash and get dressed");
    expectPersonalCareFlagged("change her pads in the morning");
    expectPersonalCareFlagged("make sure she takes her tablets with dinner");
    expectPersonalCareFlagged(
      "Could someone help her wash and get dressed on Tuesdays?",
    );
    expectPersonalCareFlagged(
      "Could a volunteer change her pads in the morning?",
    );
    expectPersonalCareFlagged("Make sure she takes her tablets with dinner.");
  });

  it("keeps the audit's declining phrasings negative", () => {
    expectPersonalCareNotFlagged("she washes and dresses herself");
    expectPersonalCareNotFlagged("she takes her own tablets");
    expectPersonalCareNotFlagged("doesn't need help with pills");
    expectPersonalCareNotFlagged("no medication needed");
    expectPersonalCareNotFlagged("She washes and dresses herself.");
    expectPersonalCareNotFlagged("She takes her own tablets.");
    expectPersonalCareNotFlagged("She doesn't need help with pills.");
    expectPersonalCareNotFlagged("No medication needed.");
  });

  it("keeps the four built-in slot notes out of the personal-care predicate", () => {
    for (const note of BUILT_IN_NOTES) {
      expectPersonalCareNotFlagged(note);
    }
  });

  it("still catches medication and bathing when they are named as a need", () => {
    expectPersonalCareFlagged(
      "I need help with bathing and remembering her medication in the morning.",
    );
    expectPersonalCareFlagged(
      "He needs lifting from the bed to his wheelchair every morning.",
    );
  });
});

/**
 * VAL-AUDITFIX-003 — the draft editor's screen.
 *
 * `mentionsPersonalCare` is the predicate the label and orientation note are
 * refused by, so it must catch the same weak words the Q9 rule catches while
 * leaving the built-in default notes alone. It is deliberately the same
 * positive rule after the same declining-clause strips: the screen and the care
 * hold may never disagree about what personal care is.
 */
describe("the draft editor's personal-care predicate (VAL-AUDITFIX-003)", () => {
  it("catches a personal-care instruction in a label", () => {
    expect(mentionsPersonalCare("Change her pads")).toBe(true);
    expect(mentionsPersonalCare("Help her wash and get dressed")).toBe(true);
  });

  it("catches a personal-care instruction in an orientation note", () => {
    expect(
      mentionsPersonalCare("Could a volunteer change her pads in the morning?"),
    ).toBe(true);
    expect(
      mentionsPersonalCare("Make sure she takes her tablets with dinner."),
    ).toBe(true);
    expect(
      mentionsPersonalCare("Help her wash and get dressed on Tuesdays."),
    ).toBe(true);
  });

  it("accepts a legitimate orientation note", () => {
    expect(mentionsPersonalCare("Two people for the first visit.")).toBe(false);
    expect(
      mentionsPersonalCare("Leave the dish at the door and text the coordinator."),
    ).toBe(false);
  });

  it("accepts the built-in default notes", () => {
    for (const note of BUILT_IN_NOTES) {
      expect(mentionsPersonalCare(note), note).toBe(false);
    }
  });

  it("keeps a declining clause out of the screen, exactly as Q9 does", () => {
    expect(mentionsPersonalCare("She takes her own tablets.")).toBe(false);
    expect(mentionsPersonalCare("No medication needed.")).toBe(false);
  });
});

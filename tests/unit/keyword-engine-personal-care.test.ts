import { describe, expect, it } from "vitest";
import type { PolicyQuestion } from "@/db/schema";
import { seedQuestionSet, seedSafeguardingPromises } from "@/db/seed-data";
import { NEVER_COMMITMENTS } from "@/lib/trust-content";
import {
  mentionsPersonalCare,
  runKeywordEngine,
} from "@/server/domain/keyword-engine";
import { buildDraftSlots, type TypedAnswer } from "@/server/domain/slots";
import { decide } from "@/server/services/decide";
import { createDeterministicProvider } from "@/server/services/providers";
import { AUDITED_ASK_PERSONAL_CARE_PHRASES } from "../fixtures/personal-care-strings";

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

/**
 * VAL-R2CARE-001 and VAL-R2CARE-002 — the vocabulary families use.
 *
 * The audit at 2b58b76 tested fourteen plain personal-care phrases through the
 * real pipeline; thirteen answered Q9 NO at 0.78 because the lexicon knew only
 * the singular "diaper"/"nappy" and none of "injection", "loo", "accidents",
 * "inhaler", "eye drops", "teeth", "undress" or "get changed". A confident NO
 * at 0.78 is above the 0.60 abstention threshold, so no care hold fired and
 * plain code proposed a slot a coordinator could approve.
 *
 * Every phrase below therefore runs through the real `decide()` →
 * `resolveDecisionRouting` → `buildDraftSlots` pipeline and must hold with
 * `slotConstructionAllowed: false` and nothing proposed. The declining set is
 * the other half: a genuine refusal must stay a clear NO at the explicit
 * negative confidence, raise no hold, and keep the ordinary route.
 */
const QUESTIONS: PolicyQuestion[] = seedQuestionSet.map((question) => ({
  ...question,
}));

const TIME_ZONE = "America/New_York";
// Tuesday 17 November 2026, 10:00 in New York. The next Respite Morning is a
// week away, so a companion place can still be offered.
const NOW = new Date("2026-11-17T15:00:00.000Z");

const SESSION = {
  id: "session-1",
  startsAt: new Date("2026-11-24T15:00:00.000Z"),
  endsAt: new Date("2026-11-24T19:00:00.000Z"),
  capacity: 12,
  usedCompanionPlaces: 0,
  status: "scheduled" as const,
};

async function runPipeline(askText: string) {
  const result = await decide({
    askText,
    questions: QUESTIONS,
    provider: createDeterministicProvider(),
  });

  const answers: TypedAnswer[] = result.decisions.map((decision) => ({
    questionId: decision.questionId,
    answer: decision.answer,
    abstained: decision.abstained,
  }));

  const plan = buildDraftSlots({
    answers,
    sessions: [SESSION],
    recipientFirstName: "Elena",
    policy: { transportEnabled: true },
    now: NOW,
    timeZone: TIME_ZONE,
  });

  const q9 = result.decisions.find((decision) => decision.questionId === "Q9");
  if (!q9) throw new Error("Q9 was not answered");

  return { result, q9, plan };
}

async function expectCareHold(askText: string) {
  const { result, q9, plan } = await runPipeline(askText);

  expect(q9.answer, askText).toBe(true);
  expect(q9.confidence, askText).toBeGreaterThanOrEqual(0.6);
  expect(result.routing.status, askText).toBe("care_hold");
  expect(result.routing.slotConstructionAllowed, askText).toBe(false);
  expect(plan.blocked?.reason, askText).toBe("personal_care_flag");
  expect(plan.proposals, askText).toEqual([]);
}

/** VAL-R2CARE-001 — the fourteen phrasings from the round-2 audit. */
const AUDITED_CARE_PHRASES = AUDITED_ASK_PERSONAL_CARE_PHRASES;

/** VAL-R2CARE-001 — a care need wrapped in a request for a visit or a sit. */
const AUDITED_CARE_COMPOSITES = [
  "he has accidents and I need help cleaning him up. Could someone visit on Saturday?",
  "help her to the loo - she can't manage alone. Could someone come and sit with her Tuesday morning?",
  "he needs an injection every morning. Could a volunteer sit with him Tuesday morning?",
] as const;

describe("VAL-R2CARE-001 — the words families use for personal care stop the ask", () => {
  for (const phrase of AUDITED_CARE_PHRASES) {
    it(`holds and proposes nothing for "${phrase}"`, async () => {
      await expectCareHold(phrase);
    });
  }

  for (const phrase of AUDITED_CARE_COMPOSITES) {
    it(`holds a composite and proposes nothing: "${phrase}"`, async () => {
      await expectCareHold(phrase);
    });
  }

  it("shares one predicate with the coordinator's draft screen", () => {
    for (const phrase of AUDITED_CARE_PHRASES) {
      expect(mentionsPersonalCare(phrase), phrase).toBe(true);
    }
  });
});

/**
 * Every word this change adds to the positive rule needs a declining form in
 * the same change: the positive list, the negative rule and the declining
 * strips move together. These pairs are the regression net for that rule.
 */
const ADDED_WORD_CASES = [
  {
    word: "nappies",
    positive: "Could someone change his nappies before bed?",
    declining: "He manages his own nappies now, thank you.",
  },
  {
    word: "diapers",
    positive: "She needs help with her diapers in the morning.",
    declining: "She changes her own diapers now.",
  },
  {
    word: "injection",
    positive: "He needs an injection before breakfast.",
    declining: "She takes her own insulin injection with breakfast.",
  },
  {
    word: "loo",
    positive: "Could someone help her to the loo at night?",
    declining: "No help needed with the loo — she manages alone.",
  },
  {
    word: "accidents",
    positive: "He has accidents most mornings now.",
    declining: "She has no accidents now, the change of diet helped.",
  },
  {
    word: "inhaler",
    positive: "Someone needs to watch him use his inhaler.",
    declining: "No help needed with his inhaler — he manages it himself.",
  },
  {
    word: "eye drops",
    positive: "He can't do his eye drops on his own.",
    declining: "No eye drops needed — the consultant stopped them.",
  },
  {
    word: "teeth",
    positive: "Could someone brush his teeth after breakfast?",
    declining: "He brushes his own teeth every morning.",
  },
  {
    word: "undress",
    positive: "Help him undress at bedtime, please.",
    declining: "He undresses himself when he's ready.",
  },
  {
    word: "get changed",
    positive: "She needs a hand to get changed for bed.",
    declining: "He gets changed himself, thank you.",
  },
] as const;

describe("VAL-R2CARE-001 — each added word keeps its declining form negative", () => {
  for (const { word, positive, declining } of ADDED_WORD_CASES) {
    it(`flags personal care when the ask names ${word}`, () => {
      expectPersonalCareFlagged(positive);
    });

    it(`does not flag personal care when the ask declines ${word}`, () => {
      expectPersonalCareNotFlagged(declining);
    });
  }
});

/** VAL-R2CARE-002 — a care need read as a need, never as a refusal. */
const CARE_NEED_NOT_REFUSAL = [
  "doesn't remember her meds",
  "not able to manage his medication",
] as const;

/** VAL-R2CARE-002 — the four genuine declines that must stay confident NOs. */
const GENUINE_DECLINES = [
  "she takes her own tablets",
  "no medication needed",
  "she washes and dresses herself",
  "he doesn't need help with pills",
] as const;

describe("VAL-R2CARE-002 — a care need is never read as a refusal", () => {
  for (const phrase of CARE_NEED_NOT_REFUSAL) {
    it(`treats "${phrase}" as a care need, not the default negative`, async () => {
      const { result, q9, plan } = await runPipeline(phrase);

      // YES or an explicit abstention; never a confident NO from no rule
      // firing at all (the 0.78 default the audit measured).
      const careNeed = q9.answer === true || q9.abstained;
      expect(
        careNeed,
        `${phrase}: Q9 ${String(q9.answer)} at ${q9.confidence}`,
      ).toBe(true);
      expect(result.routing.status, phrase).toBe("care_hold");
      expect(result.routing.slotConstructionAllowed, phrase).toBe(false);
      expect(plan.proposals, phrase).toEqual([]);
    });
  }

  for (const phrase of GENUINE_DECLINES) {
    it(`keeps "${phrase}" a confident NO with no hold`, async () => {
      const { result, q9, plan } = await runPipeline(phrase);

      expect(q9.answer, phrase).toBe(false);
      expect(q9.confidence, phrase).toBe(0.86);
      expect(result.routing.status, phrase).toBe("waiting_coordinator");
      expect(result.routing.slotConstructionAllowed, phrase).toBe(true);
      expect(plan.blocked, phrase).toBeNull();
    });
  }
});

/**
 * VAL-R2CARE-004 — the two public promises are true for every audited phrase.
 *
 * `/never` says the ask stops and no times are proposed when a family's words
 * raise personal care. `/promises` carries the church's signed "No personal
 * care, ever." Both pages are rendered from the strings asserted here, and the
 * loop below runs all fourteen audited phrasings through the same pipeline the
 * ask route uses: a care hold, slot construction refused, and an empty plan.
 */
describe("VAL-R2CARE-004 — the public promises match the fourteen audited phrases", () => {
  it("quotes the /never commitment without weakening it", () => {
    const commitment = NEVER_COMMITMENTS.find(
      (entry) => entry.id === "no-personal-care",
    );
    expect(commitment).toBeTruthy();
    const body = commitment?.body ?? "";

    // The two sentences the round-2 audit cites, kept verbatim.
    expect(body).toContain(
      "If your words raise them, the ask stops, no times are proposed",
    );
    expect(body).toContain(
      "Even an override for a safety flag cannot turn personal care into a time.",
    );

    // Every category the fourteen phrases fall into is named, so a reader can
    // check the sentence against "change his nappies" (going to the toilet),
    // "brush his teeth" (brushing teeth), "help him undress" (dressing), and
    // "he needs an injection" (medication) without inferring anything.
    for (const category of [
      "Medication",
      "bathing",
      "dressing",
      "brushing teeth",
      "going to the toilet",
      "lifting",
      "transfers",
    ]) {
      expect(body, category).toContain(category);
    }

    expect(commitment?.where ?? "").toContain("no times at all");
  });

  it("quotes the /promises sentence the church signs", () => {
    const promise = seedSafeguardingPromises.find((line) =>
      /^No personal care, ever\./.test(line),
    );
    expect(promise).toBeTruthy();
    expect(promise).toContain("No medication, no bathing, no toileting");
    expect(promise).toContain("Area Agency on Aging");
    expect(promise).toContain("ARCH Respite Locator");
  });

  for (const phrase of AUDITED_ASK_PERSONAL_CARE_PHRASES) {
    it(`proposes no time and creates no slot for "${phrase}"`, async () => {
      await expectCareHold(phrase);
    });
  }
});

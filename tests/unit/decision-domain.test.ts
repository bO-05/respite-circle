import { describe, expect, it } from "vitest";
import { seedQuestionSet } from "@/db/seed-data";
import { detectLanguage } from "@/server/domain/language";
import { resolveDecisionRouting } from "@/server/domain/decision-routing";
import { runKeywordEngine } from "@/server/domain/keyword-engine";
import type { DecisionOutcome, TypedAnswer } from "@/server/services/decision-contract";

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

function decisions(
  overrides: Partial<Record<string, { answer: boolean | string; confidence: number; abstained?: boolean }>> = {},
): DecisionOutcome[] {
  return seedQuestionSet.map((question) => {
    const override = overrides[question.id];
    const defaultAnswer = question.answerType === "pick" ? "none_stated" : false;
    return {
      questionId: question.id as DecisionOutcome["questionId"],
      key: question.key,
      questionText: question.text,
      answerType: question.answerType,
      answer: (override?.answer ?? defaultAnswer) as TypedAnswer,
      confidence: override?.confidence ?? 0.9,
      abstained: override?.abstained ?? false,
      samples: question.samples === 3 ? 3 : 1,
    };
  });
}

describe("language detection", () => {
  it("keeps an English ask in English", () => {
    const result = detectLanguage(HERO_ASK);
    expect(result.code).toBe("en");
    expect(result.nonEnglish).toBe(false);
  });

  it("detects a Spanish ask as non-English", () => {
    const result = detectLanguage(
      "Mi mamá necesita ayuda el sábado. No puede estar sola y yo trabajo todo el día.",
    );
    expect(result.code).toBe("es");
    expect(result.nonEnglish).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("detects French and Portuguese asks", () => {
    expect(
      detectLanguage(
        "Ma mère a besoin d'aide le samedi. Elle ne peut pas rester seule et je travaille toute la journée.",
      ).nonEnglish,
    ).toBe(true);
    expect(
      detectLanguage(
        "Minha mãe precisa de ajuda no sábado. Ela não pode ficar sozinha e eu trabalho o dia todo.",
      ).nonEnglish,
    ).toBe(true);
  });

  it("treats an explicit non-English language as non-English", () => {
    const result = detectLanguage(HERO_ASK, "es");
    expect(result.code).toBe("es");
    expect(result.nonEnglish).toBe(true);
  });

  it("does not flag a short English ask with a Spanish-looking name", () => {
    expect(detectLanguage("Marta needs a hand on Saturday.").nonEnglish).toBe(
      false,
    );
  });

  it("returns English for empty input", () => {
    const result = detectLanguage("   ");
    expect(result.code).toBe("en");
    expect(result.nonEnglish).toBe(false);
  });
});

describe("decision routing", () => {
  it("sends a clear English ask to the coordinator with slot construction allowed", () => {
    const routing = resolveDecisionRouting({
      decisions: decisions(),
      language: detectLanguage(HERO_ASK),
    });

    expect(routing.status).toBe("waiting_coordinator");
    expect(routing.slotConstructionAllowed).toBe(true);
    expect(routing.bilingualNeeded).toBe(false);
    expect(routing.reasons).toEqual([]);
  });

  it("holds on a Q5 YES", () => {
    const routing = resolveDecisionRouting({
      decisions: decisions({ Q5: { answer: true, confidence: 0.9 } }),
      language: detectLanguage(HERO_ASK),
    });

    expect(routing.status).toBe("safety_hold");
    expect(routing.slotConstructionAllowed).toBe(false);
    expect(routing.reasons.map((reason) => reason.code)).toContain("safety_flag");
  });

  it("holds on an abstained Q5, never treating uncertainty as safe", () => {
    const routing = resolveDecisionRouting({
      decisions: decisions({
        Q5: { answer: false, confidence: 0.4, abstained: true },
      }),
      language: detectLanguage(HERO_ASK),
    });

    expect(routing.status).toBe("safety_hold");
    expect(routing.slotConstructionAllowed).toBe(false);
  });

  it("holds on a Q9 YES or abstention with care_hold", () => {
    const yes = resolveDecisionRouting({
      decisions: decisions({ Q9: { answer: true, confidence: 0.9 } }),
      language: detectLanguage(HERO_ASK),
    });
    expect(yes.status).toBe("care_hold");
    expect(yes.slotConstructionAllowed).toBe(false);

    const unsure = resolveDecisionRouting({
      decisions: decisions({
        Q9: { answer: false, confidence: 0.5, abstained: true },
      }),
      language: detectLanguage(HERO_ASK),
    });
    expect(unsure.status).toBe("care_hold");
  });

  it("routes a non-English ask to the coordinator with the bilingual flag and no slots", () => {
    const routing = resolveDecisionRouting({
      decisions: decisions(),
      language: detectLanguage(
        "Mi mamá necesita ayuda el sábado. No puede estar sola.",
      ),
    });

    expect(routing.status).toBe("waiting_coordinator");
    expect(routing.bilingualNeeded).toBe(true);
    expect(routing.slotConstructionAllowed).toBe(false);
    expect(routing.reasons.map((reason) => reason.code)).toContain(
      "bilingual_needed",
    );
  });

  it("keeps a safety flag visible when a non-English ask also carries uncertainty", () => {
    const routing = resolveDecisionRouting({
      decisions: decisions({ Q5: { answer: true, confidence: 0.9 } }),
      language: detectLanguage("Mi mamá necesita ayuda el sábado."),
    });

    expect(routing.bilingualNeeded).toBe(true);
    expect(routing.safetyReview).toBe(true);
    expect(routing.slotConstructionAllowed).toBe(false);
  });

  it("lists abstentions on Q1–Q3 and Q6 without blocking the ask", () => {
    const routing = resolveDecisionRouting({
      decisions: decisions({
        Q1: { answer: false, confidence: 0.4, abstained: true },
        Q3: { answer: false, confidence: 0.2, abstained: true },
        Q7: { answer: "unknown", confidence: 0.3, abstained: true },
      }),
      language: detectLanguage(HERO_ASK),
    });

    expect(routing.abstentions).toEqual(["Q1", "Q3", "Q7"]);
    expect(routing.reasons.map((reason) => reason.code)).toContain("abstained");
    expect(routing.slotConstructionAllowed).toBe(true);
  });
});

describe("the deterministic keyword engine", () => {
  it("answers Marta's hero ask", () => {
    const answers = runKeywordEngine({
      askText: HERO_ASK,
      questions: seedQuestionSet,
    });
    const get = (id: string) =>
      answers.find((answer) => answer.questionId === id);

    expect(get("Q1")?.answer).toBe(true);
    expect(get("Q2")?.answer).toBe(false);
    expect(get("Q3")?.answer).toBe(false);
    expect(get("Q4")?.answer).toBe("saturday");
    expect(get("Q5")?.answer).toBe(false);
    expect(get("Q6")?.answer).toBe(true);
    expect(get("Q7")?.answer).toBe("unknown");
    expect(get("Q9")?.answer).toBe(false);
    expect(answers.every((answer) => answer.confidence >= 0.6)).toBe(true);
  });

  it("answers David's transport ask without inventing a meal or companion slot", () => {
    const answers = runKeywordEngine({
      askText:
        "June has physio on Tuesdays at two and I don't drive anymore. Someone patient to take her and wait would mean the world. She needs a hand getting out of the car, that's all.",
      questions: seedQuestionSet,
    });
    const get = (id: string) => answers.find((answer) => answer.questionId === id);

    expect(get("Q2")?.answer).toBe(true);
    expect(get("Q3")?.answer).toBe(false);
    expect(get("Q4")?.answer).toBe("weekday_afternoon");
    expect(get("Q8")?.answer).toBe(true);
    expect(get("Q9")?.answer).toBe(false);
  });

  it("answers Priya's meal ask with the reheat preference and no ride", () => {
    const answers = runKeywordEngine({
      askText:
        "Dad has dialysis three evenings a week and I work until six. One meal we can reheat on a Thursday would take so much pressure off. Nothing spicy, please, and no pork.",
      questions: seedQuestionSet,
    });
    const get = (id: string) => answers.find((answer) => answer.questionId === id);

    expect(get("Q3")?.answer).toBe(true);
    expect(get("Q7")?.answer).toBe("reheats");
    expect(get("Q4")?.answer).toBe("weekday_evening");
    expect(get("Q2")?.answer).toBe(false);
  });

  it("flags safety language", () => {
    const answers = runKeywordEngine({
      askText:
        "She fell last week and I am scared she will wander out of the house.",
      questions: seedQuestionSet,
    });
    expect(answers.find((answer) => answer.questionId === "Q5")?.answer).toBe(
      true,
    );
  });

  it("flags personal care language", () => {
    const answers = runKeywordEngine({
      askText:
        "I need help with bathing and remembering her medication in the morning.",
      questions: seedQuestionSet,
    });
    expect(answers.find((answer) => answer.questionId === "Q9")?.answer).toBe(
      true,
    );
  });

  it("respects negations instead of keyword-matching them", () => {
    const answers = runKeywordEngine({
      askText:
        "No falls so far and she does not need help with medication. Meals are covered, and we already have a ride.",
      questions: seedQuestionSet,
    });
    const get = (id: string) => answers.find((answer) => answer.questionId === id);

    expect(get("Q5")?.answer).toBe(false);
    expect(get("Q9")?.answer).toBe(false);
    expect(get("Q3")?.answer).toBe(false);
    expect(get("Q2")?.answer).toBe(false);
  });

  it("returns a typed answer for every requested question, even unknown text", () => {
    const answers = runKeywordEngine({
      askText: "Hello there.",
      questions: seedQuestionSet,
    });

    expect(answers).toHaveLength(9);
    for (const answer of answers) {
      expect(["yesno", "pick"]).toContain(answer.answerType);
      if (answer.answerType === "yesno") {
        expect(typeof answer.answer).toBe("boolean");
      } else {
        expect(typeof answer.answer).toBe("string");
      }
    }
  });

  it("answers only the requested subset for a sample call", () => {
    const answers = runKeywordEngine({
      askText: HERO_ASK,
      questions: seedQuestionSet.filter((question) =>
        ["Q5", "Q9"].includes(question.id),
      ),
    });
    expect(answers.map((answer) => answer.questionId)).toEqual(["Q5", "Q9"]);
  });
});

describe("keyword-engine rules fixed by the calibration labels", () => {
  const answer = (askText: string, questionId: string) =>
    runKeywordEngine({ askText, questions: seedQuestionSet }).find(
      (entry) => entry.questionId === questionId,
    )?.answer;

  it("recognises staying with, visiting, and a chat as companionship", () => {
    expect(
      answer(
        "Could a kind person stay with Nana while I take my kids to their Saturday games?",
        "Q1",
      ),
    ).toBe(true);
    expect(
      answer(
        "He needs help getting up the steps, so any visit needs someone strong enough to steady him.",
        "Q1",
      ),
    ).toBe(true);
    expect(
      answer(
        "I need to know someone will notice if I stop coping. A chat would help.",
        "Q1",
      ),
    ).toBe(true);
  });

  it("recognises the exchange a caregiver names for themselves", () => {
    expect(
      answer(
        "I just need two hours on Sunday afternoon to sleep. My sister usually helps but she is away.",
        "Q1",
      ),
    ).toBe(true);
    expect(
      answer(
        "Just an hour so I can shower and rest.",
        "Q1",
      ),
    ).toBe(true);
    expect(
      answer(
        "Nothing regular, just this Saturday. My grandson's recital, and I haven't been able to go to one yet.",
        "Q1",
      ),
    ).toBe(true);
  });

  it("treats 'fine for company' as a refusal, not a companionship request", () => {
    expect(
      answer(
        "We are fine for company, truly. It's dinner. By the time I've done his evening routine I'm too tired to cook.",
        "Q1",
      ),
    ).toBe(false);
  });

  it("does not turn grocery shopping into a meal need", () => {
    expect(
      answer(
        "It's only grocery shopping, one hour, while someone stays with Dad.",
        "Q3",
      ),
    ).toBe(false);
  });

  it("treats transport the family already covers as an explicit no", () => {
    expect(
      answer(
        "Transport to dialysis is covered by family, but on dialysis days nobody eats properly.",
        "Q2",
      ),
    ).toBe(false);
  });

  it("flags wandering that leaves the house", () => {
    expect(
      answer(
        "Dad keeps leaving the house at night and we found him two streets away.",
        "Q5",
      ),
    ).toBe(true);
  });

  it("flags hidden medication, refused food, an open door, burns, and self-harm language", () => {
    const safetyAsks = [
      "She's started hiding her medication and refusing to eat.",
      "I found the front door wide open this morning and her coat gone.",
      "The burns on his arm are from the kettle again.",
      "He's been saying he doesn't want to be here anymore.",
    ];
    for (const askText of safetyAsks) {
      expect(answer(askText, "Q5"), askText).toBe(true);
    }
  });

  it("does not treat a stroke in the past as an immediate emergency", () => {
    expect(
      answer(
        "He needs help getting up the front steps since the stroke, so any visit needs someone strong enough to steady him.",
        "Q5",
      ),
    ).toBe(false);
  });

  it("treats the caregiver's own shower as not personal care", () => {
    expect(
      answer(
        "New faces frighten her since the dementia got worse. Just an hour so I can shower and rest.",
        "Q9",
      ),
    ).toBe(false);
  });

  it("treats self-care statements and declined care lists as not personal care", () => {
    expect(
      answer(
        "She manages her own shower and takes her own tablets. Could someone sit with her Tuesday?",
        "Q9",
      ),
    ).toBe(false);
    expect(
      answer(
        "No personal care needed — she walks, dresses and eats on her own. We just need a lift to church.",
        "Q9",
      ),
    ).toBe(false);
    expect(
      answer(
        "He doesn't need help with bathing or medication — honestly he's more capable than me.",
        "Q9",
      ),
    ).toBe(false);
  });
});

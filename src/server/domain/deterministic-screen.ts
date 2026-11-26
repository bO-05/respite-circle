import type {
  DecisionOutcome,
  HoldSource,
} from "@/server/services/decision-contract";
import {
  HOLD_SCREEN_MIN_CONFIDENCE,
  screenHoldSignals,
  type HoldScreenSignal,
} from "./keyword-engine";

/**
 * The deterministic safety and personal-care screen, applied beside the model.
 *
 * Production prefers the live provider, and a live model can miss the plainest
 * disclosure ("Sometimes I want to die") or a care word a family uses
 * ("nappies"). The app's own rules already catch those words in the labelled
 * rules engine, so they run over the ask's own words on every ask, whichever
 * provider answered.
 *
 * The screen can only add a hold, never remove one:
 *   - a model YES or abstention stays a hold and is labelled `model`;
 *   - a settled model NO plus a rule YES (or a rule that could not settle)
 *     becomes a hold labelled `rule`;
 *   - a settled model NO plus a settled rule NO changes nothing.
 *
 * Only Q5 (immediate safety) and Q9 (personal care) are screened. The other
 * seven answers stay exactly as the model gave them, and a rule hold is
 * recorded with its source so the receipt never credits the model for it.
 */

export const HOLD_SCREEN_VERSION = "safety-care-screen-v1";

export const SCREENED_QUESTION_IDS = ["Q5", "Q9"] as const;
export type ScreenedQuestionId = (typeof SCREENED_QUESTION_IDS)[number];

/** Which source settled each screened question that holds. */
export type HoldSources = Partial<Record<ScreenedQuestionId, HoldSource>>;

export type DeterministicScreenResult = {
  decisions: DecisionOutcome[];
  holdSources: HoldSources;
};

function isScreenedQuestionId(
  questionId: string,
): questionId is ScreenedQuestionId {
  return (SCREENED_QUESTION_IDS as readonly string[]).includes(questionId);
}

/** The routing rule: a yes or an abstention holds the ask. */
function decisionHolds(decision: DecisionOutcome): boolean {
  return decision.answer === true || decision.abstained;
}

/** The screen's rule: a yes, or a reading it could not settle, holds. */
function signalHolds(signal: HoldScreenSignal): boolean {
  return signal.answer || signal.confidence < HOLD_SCREEN_MIN_CONFIDENCE;
}

export function applyDeterministicHoldScreen(input: {
  askText: string;
  decisions: readonly DecisionOutcome[];
}): DeterministicScreenResult {
  const signals = screenHoldSignals(input.askText);
  const holdSources: HoldSources = {};

  const decisions = input.decisions.map((decision) => {
    if (!isScreenedQuestionId(decision.questionId)) return decision;

    const signal =
      decision.questionId === "Q5" ? signals.safety : signals.personalCare;

    if (decisionHolds(decision)) {
      // The model (or its abstention) already holds this ask. Keep its answer
      // and its confidence, and say the model produced the hold.
      holdSources[decision.questionId] = "model";
      return { ...decision, signalSource: "model" as const };
    }

    if (!signalHolds(signal)) {
      return { ...decision, signalSource: null };
    }

    holdSources[decision.questionId] = "rule";
    return {
      ...decision,
      // A rule YES is a settled answer. An unresolved rule read abstains, so
      // the hold rests on uncertainty rather than on a guessed yes.
      answer: signal.answer,
      confidence: signal.confidence,
      abstained: !signal.answer,
      signalSource: "rule" as const,
    };
  });

  return { decisions, holdSources };
}

/** The plain sentence the trail shows for a rule-settled safety or care row. */
export function ruleHoldSentence(questionId: string): string {
  if (questionId === "Q5") {
    return "The app's fixed safety rules found this in your words, not the model. A person will call today.";
  }
  if (questionId === "Q9") {
    return "The app's fixed personal-care rules found this in your words, not the model. A person will call about professional help.";
  }
  return "The app's fixed rules found this in your words, not the model.";
}

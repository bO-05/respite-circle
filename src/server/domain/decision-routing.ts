import type { DecisionOutcome, QuestionId } from "@/server/services/decision-contract";
import type { LanguageDetection } from "./language";

/**
 * Routing rules that sit between the typed answers and slot construction.
 *
 * They are pure and deliberately conservative:
 * - a Q5 YES or abstention is a safety hold;
 * - a Q9 YES or abstention is a personal-care hold;
 * - a confidently non-English ask goes to the coordinator with the bilingual
 *   flag, even if some answers look usable;
 * - a held ask never constructs a slot.
 *
 * Safety and personal care are checked before any slot branch exists, and no
 * branch here can turn them into one.
 */

export type RoutingStatus =
  | "waiting_coordinator"
  | "safety_hold"
  | "care_hold";

export type RoutingReasonCode =
  | "bilingual_needed"
  | "safety_flag"
  | "personal_care_flag"
  | "abstained"
  | "empty_ask";

export type RoutingReason = {
  code: RoutingReasonCode;
  questionId?: QuestionId;
  detail: string;
};

export type DecisionRouting = {
  status: RoutingStatus;
  slotConstructionAllowed: boolean;
  bilingualNeeded: boolean;
  safetyReview: boolean;
  personalCareReview: boolean;
  abstentions: QuestionId[];
  reasons: RoutingReason[];
};

export function resolveDecisionRouting(input: {
  decisions: readonly DecisionOutcome[];
  language: LanguageDetection;
  emptyInput?: boolean;
}): DecisionRouting {
  const byId = new Map(
    input.decisions.map((decision) => [decision.questionId, decision]),
  );

  const q5 = byId.get("Q5");
  const q9 = byId.get("Q9");

  // An ask with no words has no safety or care signal to read. It still goes
  // to a person and still constructs nothing, but it must not masquerade as a
  // crisis hold just because every synthetic answer abstained.
  const safetyReview =
    !input.emptyInput && Boolean(q5 && (q5.answer === true || q5.abstained));
  const personalCareReview =
    !input.emptyInput && Boolean(q9 && (q9.answer === true || q9.abstained));
  const bilingualNeeded = input.language.nonEnglish;

  const abstentions = input.decisions
    .filter((decision) => decision.abstained)
    .map((decision) => decision.questionId);

  const reasons: RoutingReason[] = [];

  if (input.emptyInput) {
    reasons.push({
      code: "empty_ask",
      detail: "The ask had no words to classify; a person will read it.",
    });
  }
  if (bilingualNeeded) {
    reasons.push({
      code: "bilingual_needed",
      detail:
        "This ask is not in English. A bilingual person is needed; no English guessed answers were turned into slots.",
    });
  }
  if (safetyReview) {
    reasons.push({
      code: "safety_flag",
      questionId: "Q5",
      detail:
        "A safety question was answered yes or left uncertain. A person calls today; no slots are proposed.",
    });
  }
  if (personalCareReview) {
    reasons.push({
      code: "personal_care_flag",
      questionId: "Q9",
      detail:
        "The ask mentions personal care. A person connects the family with professional help; no slots are proposed.",
    });
  }
  for (const questionId of abstentions) {
    if (questionId === "Q5" || questionId === "Q9") continue;
    reasons.push({
      code: "abstained",
      questionId,
      detail: `${questionId} was uncertain. A person will decide this one.`,
    });
  }

  let status: RoutingStatus = "waiting_coordinator";
  if (!bilingualNeeded && safetyReview) status = "safety_hold";
  else if (!bilingualNeeded && personalCareReview) status = "care_hold";

  const slotConstructionAllowed =
    !bilingualNeeded &&
    !safetyReview &&
    !personalCareReview &&
    !input.emptyInput;

  return {
    status,
    slotConstructionAllowed,
    bilingualNeeded,
    safetyReview,
    personalCareReview,
    abstentions,
    reasons,
  };
}

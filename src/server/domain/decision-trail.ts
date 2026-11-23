import {
  PICK_LABELS,
  pickOptionsForQuestion,
  type PickAnswer,
} from "@/server/services/decision-contract";
import { languageDisplayName } from "./language";

/**
 * The render guard for the decision trail.
 *
 * A `decision` row holds closed values only: a boolean or a pick token, a
 * bounded confidence, and the policy's own question text. There is no prose
 * column. This module is the single path from those stored values to the
 * strings a page may render, so an unexpected value can never become a
 * sentence about a person — it becomes the human handoff instead.
 */

export const CONFIDENCE_LABEL = "the model's stated confidence";

export const ABSTENTION_SENTENCE =
  "This isn't mine to answer — a person will decide.";

/**
 * What a row says when the ask was written in another language. The model was
 * never asked to guess in English, so the honest sentence names the handoff
 * instead of implying uncertainty about the answers.
 */
export function bilingualHandoffSentence(
  language: string | null | undefined,
): string {
  const name = languageDisplayName(language);
  if (name) {
    return `This was written in ${name}. A bilingual person will read it with you.`;
  }
  return "This was written in another language. A bilingual person will read it with you.";
}

/** The one calm notice at the top of a bilingual trail. */
export function bilingualTrailNotice(
  language: string | null | undefined,
): string {
  const name = languageDisplayName(language);
  if (name) {
    return `This ask was written in ${name}. Nothing was translated or guessed. A bilingual person will read it with you, and no time is proposed until then.`;
  }
  return "This ask was written in another language. Nothing was translated or guessed. A bilingual person will read it with you, and no time is proposed until then.";
}

export const RULES_BANNER =
  "Auto-filled by rules, not AI — please verify.";

export const PLAIN_CODE_SENTENCE =
  "Plain code — not the model — builds every proposed time from these nine answers. The model never writes a proposal, a message, or a sentence.";

export const NOTHING_PUBLISHED_SENTENCE =
  "Nothing has been published yet. No time is shown to anyone until Grace approves it.";

export const AI_CHIP = "AI: sees fields, writes nothing";

export type TrailAnswerInput = {
  questionId: string;
  questionText: string;
  answerType: "yesno" | "pick";
  answer: unknown;
  confidence: number;
  abstained: boolean;
  samples: number | null;
};

export type TrailRowView = {
  questionId: string;
  questionText: string;
  /** Null for an abstention or an answer outside the closed set. */
  answerLabel: string | null;
  abstained: boolean;
  /** The one sentence an abstained row may show in place of an answer. */
  handoff: string | null;
  confidencePercent: string;
  samples: number | null;
};

/** Whole-percent display. Stored `real` reads back as 0.930000007. */
export function formatConfidencePercent(confidence: number): string {
  if (!Number.isFinite(confidence)) return "0%";
  const clamped = Math.min(1, Math.max(0, confidence));
  return `${Math.round(clamped * 100)}%`;
}

/**
 * The only answers a row may display. A yes/no question takes a real boolean;
 * a pick question takes a token from its own closed list. Anything else is
 * null, which the trail renders as the human handoff.
 */
export function formatAnswer(
  questionId: string,
  answerType: string,
  answer: unknown,
): string | null {
  if (answerType === "yesno") {
    if (answer === true) return "Yes";
    if (answer === false) return "No";
    return null;
  }

  if (answerType !== "pick" || typeof answer !== "string") return null;

  const allowed = pickOptionsForQuestion(questionId);
  if (!allowed || !allowed.includes(answer as PickAnswer)) return null;

  return PICK_LABELS[answer as PickAnswer] ?? null;
}

/**
 * Build every row the trail may render. An abstention removes the typed safe
 * answer from view; an unrecognised value is treated as an abstention rather
 * than echoing a model string into the DOM.
 */
export function buildTrailRows(
  inputs: readonly TrailAnswerInput[],
  options: { handoff?: string | null } = {},
): TrailRowView[] {
  const handoff = options.handoff ?? ABSTENTION_SENTENCE;
  return inputs.map((input) => {
    const answerLabel = input.abstained
      ? null
      : formatAnswer(input.questionId, input.answerType, input.answer);
    const abstained = input.abstained || answerLabel === null;

    return {
      questionId: input.questionId,
      questionText: input.questionText,
      answerLabel: abstained ? null : answerLabel,
      abstained,
      handoff: abstained ? handoff : null,
      confidencePercent: formatConfidencePercent(input.confidence),
      samples: input.samples,
    };
  });
}

/** `245 ms`, `1.9 s`, or an honest absence. */
export function formatLatency(latencyMs: number | null | undefined): string {
  if (
    latencyMs === null ||
    latencyMs === undefined ||
    !Number.isFinite(latencyMs) ||
    latencyMs < 0
  ) {
    return "not recorded";
  }
  if (latencyMs < 1_000) return `${Math.round(latencyMs)} ms`;
  return `${(latencyMs / 1_000).toFixed(1)} s`;
}

/** Names the exact wording the trail answered, including after a revision. */
export function revisionTrailSentence(
  revisionNumber: number,
  revisionCount: number,
): string {
  if (revisionCount <= 1 || revisionNumber <= 1) {
    return "These answers are about your first words.";
  }
  return `These answers are about version ${revisionNumber} of your words — the latest wording you sent.`;
}

const DRAFT_KIND_NOUN: Record<string, string> = {
  companion: "a companion place",
  home: "a home visit",
  drive: "a drive",
  meal: "a meal",
  errand: "an errand",
};

/**
 * Summarise what plain code has proposed, by kind only. The coordinator's
 * editable label is deliberately not printed here, and nothing in this
 * summary is published to the congregation.
 */
export function summariseDraftKinds(
  kinds: readonly string[],
): string | null {
  if (kinds.length === 0) return null;

  const nouns = Array.from(
    new Set(kinds.map((kind) => DRAFT_KIND_NOUN[kind] ?? "a proposed time")),
  );

  const list =
    nouns.length === 1
      ? nouns[0]
      : `${nouns.slice(0, -1).join(", ")} and ${nouns.at(-1)}`;

  const times = kinds.length === 1 ? "time" : "times";
  return `Plain code has proposed ${kinds.length} possible ${times} for Grace to review: ${list}. They are not published.`;
}

/** The caregiver-facing publication state. Zero is the honest default. */
export function publicationSentence(publishedCount: number): string {
  if (publishedCount <= 0) return NOTHING_PUBLISHED_SENTENCE;
  const times = publishedCount === 1 ? "time" : "times";
  return `Grace has published ${publishedCount} ${times}. You can see what is covered on your care page.`;
}

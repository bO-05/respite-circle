/**
 * Ask intake rules. Pure functions with no database, no cookies, and no
 * React: the same checks run in the form (for an immediate message), in the
 * route handler (the only enforcement), and in the repository (so no future
 * caller can write a blank ask).
 *
 * The caregiver's words are never trimmed, normalised, or smart-quoted. The
 * only thing `trim()` is used for is deciding whether there is anything at all
 * to store.
 */

/** Generous enough for a long story, bounded so a paste cannot exhaust a row. */
export const MAX_ASK_LENGTH = 8000;

export type AskIntakeErrorCode =
  | "invalid"
  | "empty"
  | "too_long"
  | "consent_required";

export type AskIntakeProblem = {
  ok: false;
  code: AskIntakeErrorCode;
  message: string;
};

export type AskIntakeAccepted = {
  ok: true;
  /** Exactly the string supplied, character-for-character. */
  text: string;
};

export type AskIntakeValidation = AskIntakeAccepted | AskIntakeProblem;

export const ASK_INTAKE_MESSAGES = {
  invalid: "Something went wrong with those words. Please write them in the box.",
  empty: "Please write a few words about your week before sending this.",
  too_long:
    "That is longer than we can store. Please shorten it a little.",
  consent_required:
    "Please tick the box to say you understand who reads this first.",
} as const;

export function validateAskSubmission(input: {
  text: unknown;
  consent: unknown;
  maxLength?: number;
}): AskIntakeValidation {
  const maxLength = input.maxLength ?? MAX_ASK_LENGTH;

  if (typeof input.text !== "string") {
    return {
      ok: false,
      code: "invalid",
      message: ASK_INTAKE_MESSAGES.invalid,
    };
  }

  if (input.text.trim().length === 0) {
    return {
      ok: false,
      code: "empty",
      message: ASK_INTAKE_MESSAGES.empty,
    };
  }

  if (input.text.length > maxLength) {
    return {
      ok: false,
      code: "too_long",
      message: `${ASK_INTAKE_MESSAGES.too_long.replace(/\.$/, "")} (${maxLength.toLocaleString("en-US")} characters at most).`,
    };
  }

  if (input.consent !== true) {
    return {
      ok: false,
      code: "consent_required",
      message: ASK_INTAKE_MESSAGES.consent_required,
    };
  }

  return { ok: true, text: input.text };
}

/**
 * The plain receipt sentence. It names the human who reads the words first and
 * promises the one thing the code actually enforces: nothing is published
 * before that person approves it.
 *
 * `autoPublishLowRisk` is the switch on the policy version in force for this
 * ask. Only when it is on does the sentence qualify itself: a meal time from
 * this ask may reach the congregation board before a person approves that
 * time. The family's words are still never shown. With the switch off the
 * sentence is exactly the one the app has always shown.
 */
export function receiptSentence(
  coordinatorFirstName: string | null,
  autoPublishLowRisk = false,
): string {
  const name = coordinatorFirstName?.trim();

  if (autoPublishLowRisk) {
    const reader = name ?? "Your coordinator";
    const they = name ? "she" : "they";
    const approves = name ? "approves" : "approve";
    return `${reader} reads every ask. Your words are never shown to anyone else. One exception: under the church's signed low-risk policy, a meal time from this ask may go on the congregation board before ${they} ${approves} that time.`;
  }

  if (name) {
    return `${name} reads every ask first. Nothing is shown to anyone until she approves it.`;
  }

  return "Your coordinator reads every ask first. Nothing is shown to anyone until they approve it.";
}

/**
 * The consent line the caregiver must acknowledge. It names the same human as
 * the receipt, and it describes exactly what the app does with the words.
 *
 * The switch qualification follows the same rule as `receiptSentence`: it is
 * present only while the signed policy in force carries `auto_publish_low_risk`.
 */
export function consentSentence(
  coordinatorFirstName: string | null,
  autoPublishLowRisk = false,
): string {
  const name = coordinatorFirstName?.trim();

  if (autoPublishLowRisk) {
    const reader = name ?? "my coordinator";
    const they = name ? "she" : "they";
    const approves = name ? "approves" : "approve";
    return `I understand that ${reader} reads this. My words are never shown to anyone else. One exception: under the church's signed low-risk policy, a meal time from this ask may go on the congregation board before ${they} ${approves} that time.`;
  }

  if (name) {
    return `I understand that ${name} reads this first, and that nothing is shown to anyone else unless she approves it.`;
  }

  return "I understand that my coordinator reads this first, and that nothing is shown to anyone else unless they approve it.";
}

/**
 * The receipt line for a sent-back ask. With the low-risk switch off it is the
 * sentence the app has always shown. With it on, "nothing was published" is no
 * longer true: a meal time from this ask may have been on the congregation
 * board and is taken down by the send-back, so the sentence says exactly that
 * without claiming the words were ever shared.
 */
export function sentBackReceiptSentence(
  senderFirstName: string | null,
  autoPublishLowRisk = false,
): string {
  const sender = senderFirstName?.trim() || "Your coordinator";

  if (autoPublishLowRisk) {
    return `${sender} read your words and sent this back with a note. Your words stay private. No time from this ask is on the congregation board now — any meal time that had been put there is taken down with the ask.`;
  }

  return `${sender} read your words and sent this back with a note. Nothing was shared with a neighbour, and nothing was published.`;
}

/** A quiet character count, with the limit stated only once it is exceeded. */
export function characterCountLabel(
  length: number,
  maxLength: number = MAX_ASK_LENGTH,
): string {
  const formatted = length.toLocaleString("en-US");
  const noun = length === 1 ? "character" : "characters";

  if (length > maxLength) {
    return `${formatted} ${noun} — over the limit`;
  }

  return `${formatted} ${noun}`;
}

/**
 * Append a spoken chunk to the caregiver's typed words. A single space joins
 * the pieces; a line break or an existing space is left exactly as it is. The
 * textarea value is always the single source of truth for the stored words.
 */
export function appendSpokenText(current: string, spoken: string): string {
  const chunk = spoken.trim();
  if (chunk.length === 0) return current;
  if (current.length === 0) return chunk;
  if (/\s$/.test(current)) return `${current}${chunk}`;
  return `${current} ${chunk}`;
}

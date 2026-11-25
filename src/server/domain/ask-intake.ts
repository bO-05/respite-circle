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
  const reader = name ?? "Your coordinator";
  const they = name ? "she" : "they";
  const approves = name ? "approves" : "approve";

  if (autoPublishLowRisk) {
    return `${reader} reads every ask. Your words are never shown to a neighbour. One exception: under the church's signed low-risk policy, a meal time from this ask may go on the congregation board before ${they} ${approves} that time.`;
  }

  // The ordinary promise still names the one signed exception, in the same
  // breath as the approval it qualifies: a meal may publish itself while the
  // church's low-risk policy is on, so "nothing is shown until she approves"
  // can never be written as an absolute.
  return `${reader} reads every ask first. Nothing is shown to a neighbour until ${they} ${approves} it, except a meal under the church's signed low-risk policy.`;
}

/**
 * The consent line the caregiver must acknowledge. It says what the church may
 * keep and who may read it — including the deputy who covers when the
 * coordinator is away — and it makes no privacy promise of its own. The one
 * reassurance sits directly below it (`receiptSentence`), so the compose screen
 * does not say the same thing twice in two sizes.
 */
export function consentSentence(coordinatorFirstName: string | null): string {
  const name = coordinatorFirstName?.trim();
  const reader = name
    ? `${name}, or the deputy who covers when she is away,`
    : "my coordinator, or the deputy who covers for them,";

  return `I agree that the church may keep these words and that ${reader} may read them.`;
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

/**
 * The two decision sentences under "What happens next" on the receipt.
 *
 * The family has no in-app control to accept or decline a published time:
 * every `"use server"` module is desk-scoped, and the only caregiver action on
 * a slot keeps a thank-you after the time is done. So these sentences name the
 * real decision point instead of inventing one — the call, where the family
 * says what would help, and the coordinator, whom they tell when a time does
 * not suit them. The page says plainly that there is no button here.
 *
 * `tests/unit/caregiver-agency.test.ts` keeps the action list and this copy
 * checked together; if a caregiver action is ever added, both change.
 */
export function receiptDecisionSentences(coordinatorFirstName: string | null): {
  /** The call, named as the family's real channel for saying what helps. */
  call: string;
  /** What to do when an offered time does not suit the family. */
  offer: string;
} {
  const name = coordinatorFirstName?.trim();

  if (!name) {
    return {
      call: "Your coordinator may call to talk the week through. You can say what would help, and what would not.",
      offer:
        "If a time does not suit you, tell your coordinator on the phone — there is no button here to say whether it helps.",
    };
  }

  return {
    call: `${name} may call to talk the week through. You can say what would help, and what would not.`,
    offer: `If a time does not suit you, tell ${name} on the phone — there is no button here to say whether it helps.`,
  };
}

/**
 * The caregiver's status pill, as one pure rule the page cannot drift from.
 *
 * The waiting state may only claim the words are unread while nothing has
 * recorded a first desk read. `deskReadAt` is the ask's own timestamp, set the
 * first time a coordinator rendered it on the desk, so once it is present the
 * pill states what happens next — the call, the same step the receipt's "What
 * happens next" list opens with — instead of repeating a claim the code can no
 * longer keep. A pill that can never clear is a lie with a friendly face.
 */
export type ReceiptStatus =
  | "draft"
  | "waiting_coordinator"
  | "safety_hold"
  | "care_hold"
  | "approved"
  | "sent_back"
  | "closed"
  | "withdrawn";

export type ReceiptStatusCopy = {
  label: string;
  tone: "amber" | "green" | "ink";
};

/** The waiting pill: with her, unread — or read, and the call is next. */
export function waitingPillLabel(
  coordinatorFirstName: string | null,
  deskReadAt: Date | null,
): string {
  const name = coordinatorFirstName?.trim() || "Your coordinator";

  if (deskReadAt) {
    const pronoun = coordinatorFirstName?.trim() ? "she" : "they";
    return `Read by ${name} — ${pronoun} may call you`;
  }

  return `With ${name} — not read yet`;
}

export function receiptStatusCopy(input: {
  status: ReceiptStatus;
  coordinatorFirstName: string | null;
  sentBackByFirstName: string | null;
  /** The ask's first desk read, or null while no coordinator has looked. */
  deskReadAt: Date | null;
}): ReceiptStatusCopy {
  const name = input.coordinatorFirstName?.trim() || "Your coordinator";

  switch (input.status) {
    case "waiting_coordinator":
      return {
        label: waitingPillLabel(input.coordinatorFirstName, input.deskReadAt),
        tone: "amber",
      };
    case "safety_hold":
      return { label: `${name} will call you today`, tone: "amber" };
    case "care_hold":
      return { label: `${name} will call you about this`, tone: "amber" };
    case "approved":
      return { label: `Approved by ${name}`, tone: "green" };
    case "sent_back":
      return {
        label: `Read — ${
          input.sentBackByFirstName?.trim() || name
        } will be in touch`,
        tone: "amber",
      };
    case "closed":
      return { label: "Closed", tone: "ink" };
    case "withdrawn":
      return { label: "Withdrawn", tone: "ink" };
    default:
      return { label: `With ${name}`, tone: "ink" };
  }
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

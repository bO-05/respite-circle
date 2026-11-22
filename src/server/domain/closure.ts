/**
 * Closure: the end of one covered time, and the caregiver's optional reply.
 *
 * A volunteer closes a covered time after its window has passed. The family
 * may then leave a thank-you, or ask again — or do nothing at all. Skipping is
 * never framed as a loss, nothing is chased, and no automated message is
 * created by any function here.
 *
 * The one derived state is the ask itself: it closes when none of its published
 * times is still live and at least one has finished. Draft slots that were
 * never offered are not part of that count; a time nobody could see was never
 * an obligation.
 */

// ---------------------------------------------------------------------------
// The optional thank-you
// ---------------------------------------------------------------------------

export const THANK_YOU_MAX_LENGTH = 1_000;

export type ThankYouValidation =
  | { ok: true; note: string | null }
  | { ok: false; message: string };

/**
 * A thank-you is optional. Absent, blank, or whitespace-only input is a
 * deliberate skip, not an error and not an empty row. A submitted thank-you is
 * kept exactly as typed (not trimmed, not collapsed, not smart-quoted), with
 * only the textarea's CRLF transport normalised — the same convention as a
 * send-back note.
 */
export function validateThankYou(value: unknown): ThankYouValidation {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: true, note: null };
  }

  const note = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (note.length > THANK_YOU_MAX_LENGTH) {
    return {
      ok: false,
      message: `Keep the thank-you under ${THANK_YOU_MAX_LENGTH} characters so it stays easy to read.`,
    };
  }

  return { ok: true, note };
}

/** A thank-you belongs only to a time that actually happened. */
export function canLeaveThankYou(status: string): boolean {
  return status === "done";
}

/**
 * Asking again is a fresh start, offered on the same finished time. It opens
 * the blank intake page; it never copies the earlier words.
 */
export function canAskAgain(status: string): boolean {
  return status === "done";
}

// ---------------------------------------------------------------------------
// When the ask closes
// ---------------------------------------------------------------------------

export type AskClosureCounts = {
  /** Slots still claimable, claimed, or covered. */
  live: number;
  /** Slots finished: done, cancelled, or expired unclaimed. */
  closed: number;
};

/**
 * The ask's own life ends when every published time has finished. A draft that
 * was never offered is invisible to the congregation and does not keep the ask
 * open forever; an ask that never had a slot does not close on nothing.
 */
export function canCloseAsk(counts: AskClosureCounts): boolean {
  return counts.live === 0 && counts.closed > 0;
}

// ---------------------------------------------------------------------------
// Closure copy
// ---------------------------------------------------------------------------

export function closureTitle(status: string): string {
  return status === "covered" ? "Closing this time" : "This time is closed";
}

export function closureLead(
  status: string,
  coordinatorFirstName: string | null,
): string {
  const name = coordinatorFirstName ?? "your coordinator";

  switch (status) {
    case "done":
      return "Thank you for saying yes. The family can leave a thank-you or ask again — both are theirs to choose, and nothing else is needed from you.";
    case "covered":
      return "When the time has passed, one tap marks it done. Nothing is sent to the family when you do.";
    case "claimed":
      return `${name} still confirms this time. You can close it after that.`;
    case "cancelled":
      return "The church cancelled this time. Nothing is needed from you.";
    case "open":
    case "draft":
      return "This time is not on your claims. Nothing was changed.";
    default:
      return "This time is closed. Nothing is needed from you.";
  }
}

/** One calm sentence under the done state; no count and no next campaign. */
export function closureDoneLine(): string {
  return "This time is closed. Thank you for the hours you gave.";
}

export function thankYouHeading(): string {
  return "A thank-you from the family";
}

/** The caregiver's own view of the words they chose to leave. */
export function careThankYouHeading(): string {
  return "Your thank-you";
}

export function thankYouSavedLine(volunteerFirstName: string | null): string {
  return volunteerFirstName
    ? `Your thank-you is kept for ${volunteerFirstName}.`
    : "Your thank-you is kept for the person who came.";
}

// ---------------------------------------------------------------------------
// The caregiver's optional reply
// ---------------------------------------------------------------------------

export const CARE_THANKS_FLASH_CODES = [
  "added",
  "skipped",
  "already",
  "not_done",
  "not_found",
  "too_long",
] as const;

export type CareThanksFlashCode = (typeof CARE_THANKS_FLASH_CODES)[number];

export function isCareThanksFlashCode(
  value: unknown,
): value is CareThanksFlashCode {
  return (
    typeof value === "string" &&
    (CARE_THANKS_FLASH_CODES as readonly string[]).includes(value)
  );
}

export function careThanksFlashTone(
  code: CareThanksFlashCode,
): "success" | "error" {
  return code === "added" || code === "skipped" ? "success" : "error";
}

export function careThanksFlashMessage(
  code: CareThanksFlashCode,
  volunteerFirstName: string | null,
): string {
  switch (code) {
    case "added":
      return thankYouSavedLine(volunteerFirstName);
    case "skipped":
      return "Nothing was added. That is completely fine.";
    case "already":
      return "A thank-you is already kept with this time.";
    case "not_done":
      return "A thank-you can be left after a time is marked done.";
    case "not_found":
      return "That time is not one of your family's covered times.";
    case "too_long":
      return `Keep the thank-you under ${THANK_YOU_MAX_LENGTH} characters so it stays easy to read.`;
  }
}

/**
 * The caregiver's own next step. It opens the intake page, which starts empty:
 * the earlier words are never copied, quoted, or pre-filled.
 */
export function askAgainHint(): string {
  return "If another week is hard, you can ask again. It starts with an empty page — your earlier words stay exactly as they are.";
}

/** The label on the link that opens the blank intake page. */
export function askAgainLinkLabel(): string {
  return "Ask again for another week";
}

/**
 * Approve / send-back rules — pure, client-safe, and shared by the server
 * action, the repository, and the page copy.
 *
 * These are the two decisions a coordinator makes about one ask:
 *
 * - approve: publish every draft that is not held as an open time, record the
 *   approver and the instant, and move the ask to `approved`;
 * - send back: require a human note, publish nothing, and move the ask to
 *   `sent_back` so the caregiver reads the note exactly as it was written.
 *
 * Neither transition is a ranking or a score. A held draft is never published
 * by approval; it keeps its reason until a person resolves the hold.
 */

/** A coordinator can only act on an ask that is still waiting for review. */
export type AskReviewGuard =
  | { ok: true }
  | { ok: false; reason: "not_waiting"; message: string };

export const ASK_NOT_WAITING_MESSAGE =
  "This ask is not waiting for a coordinator any more. Nothing was published.";

function guardWaiting(status: string): AskReviewGuard {
  if (status === "waiting_coordinator") return { ok: true };
  return {
    ok: false,
    reason: "not_waiting",
    message: ASK_NOT_WAITING_MESSAGE,
  };
}

/** Only `waiting_coordinator` may be published. A safety or care hold never is. */
export function canApproveAsk(status: string): AskReviewGuard {
  return guardWaiting(status);
}

/** Only `waiting_coordinator` may be sent back. */
export function canSendBackAsk(status: string): AskReviewGuard {
  return guardWaiting(status);
}

// ---------------------------------------------------------------------------
// The human note on a send-back
// ---------------------------------------------------------------------------

export const SEND_BACK_NOTE_MAX_LENGTH = 2_000;

export type SendBackNoteValidation =
  | { ok: true; note: string }
  | { ok: false; message: string };

/**
 * A send-back is a human act, so the note is required. It is stored exactly as
 * typed: not trimmed, not collapsed, not smart-quoted. The caregiver reads the
 * same text the coordinator wrote.
 *
 * A textarea is encoded by the HTML form as CRLF even though the writer saw a
 * single line break. That transport convention is normalised to `\n` here; no
 * other character is touched, and leading/trailing spaces survive.
 */
export function validateSendBackNote(value: unknown): SendBackNoteValidation {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      ok: false,
      message:
        "Write a short note for the family before sending this back. It is the only thing they will see.",
    };
  }

  const note = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (note.length > SEND_BACK_NOTE_MAX_LENGTH) {
    return {
      ok: false,
      message: `Keep the note under ${SEND_BACK_NOTE_MAX_LENGTH} characters so it stays easy to read.`,
    };
  }

  return { ok: true, note };
}

// ---------------------------------------------------------------------------
// The visible approval line
// ---------------------------------------------------------------------------

type ApprovalParts = {
  weekday: string;
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
};

function approvalPartsInZone(date: Date, timeZone: string): ApprovalParts | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);

    const read = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((part) => part.type === type)?.value ?? "";

    const readPart = {
      weekday: read("weekday"),
      day: read("day"),
      month: read("month"),
      year: read("year"),
      hour: read("hour"),
      minute: read("minute"),
    };

    if (
      !readPart.weekday ||
      !readPart.day ||
      !readPart.month ||
      !readPart.year ||
      !readPart.hour ||
      !readPart.minute
    ) {
      return null;
    }
    return readPart;
  } catch {
    return null;
  }
}

/**
 * `Approved — Grace, Saturday 21 November 2026, 10:31`
 *
 * The same line appears on the congregation board and on the desk: a neighbour
 * can see that a named person approved this time, never only that "the system"
 * did. Times are always the church's local time.
 */
export function formatApprovalLine(input: {
  approverFirstName: string | null;
  approvedAt: Date | null;
  timeZone: string;
}): string | null {
  if (!input.approvedAt || Number.isNaN(input.approvedAt.getTime())) {
    return null;
  }

  const parts = approvalPartsInZone(input.approvedAt, input.timeZone);
  if (!parts) return null;

  const name =
    input.approverFirstName && input.approverFirstName.trim().length > 0
      ? input.approverFirstName
      : "a person";

  return `Approved — ${name}, ${parts.weekday} ${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

// ---------------------------------------------------------------------------
// Action copy and the form state shared by the server action and its client
// ---------------------------------------------------------------------------

export const SEND_BACK_SUCCESS_MESSAGE =
  "Sent back with your note. Nothing was published. The family will see your words exactly as you wrote them.";

export const APPROVE_SUCCESS_MESSAGE =
  "Approved. The times that were ready are open on the congregation board.";

export const REVIEW_GENERIC_FAILURE =
  "That change did not save. Nothing was published. Please try once more.";

export const REVIEW_SESSION_ENDED =
  "Your sign-in has ended. Open your access link again, then try once more.";

export function publishedTimes(count: number): string {
  return count === 1 ? "1 time" : `${count} times`;
}

/** The sentence a coordinator reads after pressing Approve. */
export function publicationSummary(
  publishedCount: number,
  heldCount: number,
): string {
  const base =
    publishedCount === 0
      ? "Approved. Nothing was ready to publish — no draft time was waiting."
      : `Published ${publishedTimes(publishedCount)}.`;

  if (heldCount === 0) return base;
  if (heldCount === 1) {
    return `${base} One held time stayed unpublished with its reason.`;
  }
  return `${base} ${heldCount} held times stayed unpublished with their reasons.`;
}

/** `Approve the ask`, `Approve and publish 1 time`, … */
export function approveButtonLabel(publishableCount: number): string {
  if (publishableCount <= 0) return "Approve the ask";
  return `Approve and publish ${publishedTimes(publishableCount)}`;
}

export type ReviewActionField = "note" | "form";

export type ReviewActionState = {
  status: "idle" | "success" | "error";
  message: string;
  field?: ReviewActionField;
};

export const IDLE_REVIEW_ACTION: ReviewActionState = {
  status: "idle",
  message: "",
};

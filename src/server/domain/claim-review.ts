/**
 * The coordinator's claim review: confirm or take back a neighbour's yes.
 *
 * Only a real claim can be reviewed. A draft has not been published, an open
 * time has no claimer, and a confirmed time has already produced the family's
 * one message — none of those can be "approved" again. Taking a claim back is
 * allowed only before confirmation, which is what makes "revoking sends the
 * family nothing" structurally true rather than a promise in the UI.
 *
 * Every sentence here is calm and human. No refusal carries SQL, an id, a
 * count, or a score.
 */

export const CLAIM_REVIEW_REFUSAL_CODES = [
  "not_found",
  "not_claimed",
  "invalid_reason",
  "unexpected",
] as const;

export type ClaimReviewRefusalCode =
  (typeof CLAIM_REVIEW_REFUSAL_CODES)[number];

export type ClaimReviewGuard =
  | { ok: true }
  | { ok: false; code: "not_claimed"; message: string };

/** One calm sentence for the state a coordinator actually met. */
export function claimReviewRefusalCopy(status: string | null): string {
  switch (status) {
    case "draft":
      return "This time is still a draft. Publish it from the ask review before a neighbour can claim it.";
    case "open":
      return "No neighbour has said yes to this time yet, so there is no claim to confirm or take back.";
    case "covered":
      return "This time is already confirmed with the family. Nothing was sent twice.";
    case "done":
      return "This time is done. A finished time is not confirmed or taken back.";
    case "cancelled":
    case "expired_unclaimed":
      return "This time is closed, so there is no claim to confirm or take back.";
    default:
      return "That time isn't on the desk anymore. Nothing was changed.";
  }
}

function guardClaim(input: {
  status: string;
  claimedBy: string | null;
}): ClaimReviewGuard {
  if (input.status === "claimed" && input.claimedBy) return { ok: true };
  return {
    ok: false,
    code: "not_claimed",
    message: claimReviewRefusalCopy(input.status),
  };
}

/** Confirmation is only ever the step after a neighbour has said yes. */
export function canApproveClaim(input: {
  status: string;
  claimedBy: string | null;
}): ClaimReviewGuard {
  return guardClaim(input);
}

/** Taking a claim back is only allowed before the family has a message. */
export function canRevokeClaim(input: {
  status: string;
  claimedBy: string | null;
}): ClaimReviewGuard {
  return guardClaim(input);
}

export const REVOKE_REASON_MAX_LENGTH = 500;

export type RevokeReasonValidation =
  | { ok: true; reason: string }
  | { ok: false; message: string };

/**
 * A revoke is a human act, so the reason is required. It is stored exactly as
 * typed, with only the textarea's CRLF transport normalised to `\n` — the same
 * convention as a send-back note. Leading and trailing spaces survive because
 * this is the church's record, not a tidy display string.
 */
export function validateRevokeReason(value: unknown): RevokeReasonValidation {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      ok: false,
      message:
        "Write the reason you are taking this claim back. It is kept in the church's record; the family is not told.",
    };
  }

  const reason = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (reason.length > REVOKE_REASON_MAX_LENGTH) {
    return {
      ok: false,
      message: `Keep the reason under ${REVOKE_REASON_MAX_LENGTH} characters so it stays easy to read.`,
    };
  }

  return { ok: true, reason };
}

// ---------------------------------------------------------------------------
// The visible confirmation line
// ---------------------------------------------------------------------------

export const CLAIM_APPROVED_MESSAGE =
  "Confirmed. The family has one message from the church's own template, and the volunteer can read the orientation note now.";

export const CLAIM_REVOKED_MESSAGE =
  "The claim is taken back. The time is open on the board again, and the family was not sent anything.";

type ConfirmationParts = {
  weekday: string;
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
};

function confirmationPartsInZone(
  date: Date,
  timeZone: string,
): ConfirmationParts | null {
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
 * `Confirmed — Grace, Tuesday 24 November 2026, 10:00`
 *
 * Deliberately distinct from the publication line (`Approved — …`) on the
 * board. The slot carries two different human decisions, by two different
 * columns, and this sentence names only the second one.
 */
export function formatClaimConfirmationLine(input: {
  confirmerFirstName: string | null;
  confirmedAt: Date | null;
  timeZone: string;
}): string | null {
  if (!input.confirmedAt || Number.isNaN(input.confirmedAt.getTime())) {
    return null;
  }

  const parts = confirmationPartsInZone(input.confirmedAt, input.timeZone);
  if (!parts) return null;

  const name = input.confirmerFirstName?.trim() || "a person";

  return `Confirmed — ${name}, ${parts.weekday} ${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

// ---------------------------------------------------------------------------
// Action states shared by the server actions and their client forms
// ---------------------------------------------------------------------------

export type ClaimReviewActionField = "form" | "reason";

export type ClaimReviewActionState = {
  status: "idle" | "success" | "error";
  message: string;
  field?: ClaimReviewActionField;
};

export const IDLE_CLAIM_REVIEW_ACTION: ClaimReviewActionState = {
  status: "idle",
  message: "",
};

export const CLAIM_REVIEW_GENERIC_FAILURE =
  "That change did not save. Nothing was sent to the family. Please try once more.";

export const CLAIM_REVIEW_SESSION_ENDED =
  "Your sign-in has ended. Open your access link again, then try once more.";

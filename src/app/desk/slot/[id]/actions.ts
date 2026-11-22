"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guards";
import { DESK_ROLES } from "@/server/auth/policy";
import {
  CLAIM_REVIEW_GENERIC_FAILURE,
  CLAIM_REVIEW_SESSION_ENDED,
  type ClaimReviewActionField,
  type ClaimReviewActionState,
} from "@/server/domain/claim-review";
import {
  type ReminderActionState,
} from "@/server/domain/notifications";
import {
  COVERAGE_GENERIC_FAILURE,
  COVERAGE_SESSION_ENDED,
  type CoverageActionField,
  type CoverageActionState,
} from "@/server/domain/coverage";
import {
  approveClaim,
  revokeClaim,
} from "@/server/repositories/claim-review";
import {
  expireSlotUnclaimed,
  recordCoverageCall,
  reofferSlot,
} from "@/server/repositories/coverage";
import { writeReminder } from "@/server/repositories/reminders";

/**
 * The two claim review actions.
 *
 * Each one re-derives the desk session; the page's guard is never the
 * enforcement. The repository re-checks the desk role, the church scope, and
 * the slot status inside a row lock, so a stale tab or a second coordinator
 * gets a calm refusal rather than a second confirmation. Failures are returned
 * as values, never thrown into the browser.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorState(
  message: string,
  field: ClaimReviewActionField = "form",
): ClaimReviewActionState {
  return { status: "error", message, field };
}

function successState(message: string): ClaimReviewActionState {
  return { status: "success", message };
}

async function deskSession() {
  try {
    return await requireAction(DESK_ROLES);
  } catch {
    return null;
  }
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * A confirmation changes the desk, the board, the volunteer's own list, and
 * the caregiver's page. Revalidate them together so no screen can show the old
 * state after a transition.
 */
function refreshAfterTransition(slotId: string): void {
  revalidatePath(`/desk/slot/${slotId}`);
  revalidatePath("/desk");
  revalidatePath("/circle");
  revalidatePath("/my-claims");
  revalidatePath("/care");
}

export async function approveClaimAction(
  _previous: ClaimReviewActionState,
  formData: FormData,
): Promise<ClaimReviewActionState> {
  const authorized = await deskSession();
  if (!authorized) return errorState(CLAIM_REVIEW_SESSION_ENDED);

  const slotId = text(formData, "slotId").trim();
  if (!UUID_PATTERN.test(slotId)) {
    return errorState("That time is not available.");
  }

  try {
    const result = await approveClaim(authorized.session, slotId);
    if (!result.ok) return errorState(result.message);
    refreshAfterTransition(result.slotId);
    return successState(result.message);
  } catch {
    return errorState(CLAIM_REVIEW_GENERIC_FAILURE);
  }
}

export async function revokeClaimAction(
  _previous: ClaimReviewActionState,
  formData: FormData,
): Promise<ClaimReviewActionState> {
  const authorized = await deskSession();
  if (!authorized) return errorState(CLAIM_REVIEW_SESSION_ENDED);

  const slotId = text(formData, "slotId").trim();
  if (!UUID_PATTERN.test(slotId)) {
    return errorState("That time is not available.");
  }

  // The reason is passed through untouched. The domain validator refuses a
  // whitespace-only reason; it never trims or rewrites a real one.
  const reason = text(formData, "reason");

  try {
    const result = await revokeClaim(authorized.session, { slotId, reason });
    if (!result.ok) {
      return errorState(
        result.message,
        result.code === "invalid_reason" ? "reason" : "form",
      );
    }
    refreshAfterTransition(result.slotId);
    return successState(result.message);
  } catch {
    return errorState(CLAIM_REVIEW_GENERIC_FAILURE);
  }
}

/**
 * The coverage watch's three actions: record a call, offer the time again, and
 * close it without a claim.
 *
 * Each re-derives the desk session, then the repository re-locks the slot and
 * re-checks the state and the live outbox count. None of them writes a
 * notification row. An expiry with any message on the family's page comes back
 * as an error state, not a quiet success.
 */

function coverageError(
  message: string,
  field: CoverageActionField = "form",
): CoverageActionState {
  return { status: "error", message, field };
}

function refreshAfterCoverage(slotId: string): void {
  revalidatePath(`/desk/slot/${slotId}`);
  revalidatePath("/desk/failures");
  revalidatePath("/desk");
  revalidatePath("/care");
  revalidatePath("/circle");
  revalidatePath("/my-claims");
}

export async function recordCoverageCallAction(
  _previous: CoverageActionState,
  formData: FormData,
): Promise<CoverageActionState> {
  const authorized = await deskSession();
  if (!authorized) return coverageError(COVERAGE_SESSION_ENDED);

  const slotId = text(formData, "slotId").trim();
  if (!UUID_PATTERN.test(slotId)) {
    return coverageError("That time is not available.");
  }

  try {
    const result = await recordCoverageCall(authorized.session, slotId, {
      outcome: text(formData, "outcome"),
      note: text(formData, "note"),
    });

    if (!result.ok) {
      return coverageError(result.message, result.field ?? "form");
    }

    refreshAfterCoverage(slotId);
    return { status: "success", message: result.message };
  } catch {
    return coverageError(COVERAGE_GENERIC_FAILURE);
  }
}

export async function reofferSlotAction(
  _previous: CoverageActionState,
  formData: FormData,
): Promise<CoverageActionState> {
  const authorized = await deskSession();
  if (!authorized) return coverageError(COVERAGE_SESSION_ENDED);

  const slotId = text(formData, "slotId").trim();
  if (!UUID_PATTERN.test(slotId)) {
    return coverageError("That time is not available.");
  }

  try {
    const result = await reofferSlot(authorized.session, slotId);
    if (!result.ok) return coverageError(result.message);

    refreshAfterCoverage(slotId);
    return { status: "success", message: result.message };
  } catch {
    return coverageError(COVERAGE_GENERIC_FAILURE);
  }
}

export async function expireSlotUnclaimedAction(
  _previous: CoverageActionState,
  formData: FormData,
): Promise<CoverageActionState> {
  const authorized = await deskSession();
  if (!authorized) return coverageError(COVERAGE_SESSION_ENDED);

  const slotId = text(formData, "slotId").trim();
  if (!UUID_PATTERN.test(slotId)) {
    return coverageError("That time is not available.");
  }

  try {
    const result = await expireSlotUnclaimed(authorized.session, slotId);
    if (!result.ok) return coverageError(result.message);

    refreshAfterCoverage(slotId);
    return { status: "success", message: result.message };
  } catch {
    return coverageError(COVERAGE_GENERIC_FAILURE);
  }
}

/**
 * Write the one reminder for a covered time.
 *
 * The page only shows the control when the reminder window is open, but the
 * control is never the enforcement: the repository re-derives the desk role,
 * locks the slot, and re-checks the covered state, the window, the confirmation
 * and the existing row. A stale tab gets a calm value back, not a second
 * message. The exact sentence is rendered server-side; nothing typed in the
 * browser can reach the outbox.
 */
export async function writeReminderAction(
  _previous: ReminderActionState,
  formData: FormData,
): Promise<ReminderActionState> {
  const authorized = await deskSession();
  if (!authorized) {
    return { status: "error", message: CLAIM_REVIEW_SESSION_ENDED };
  }

  const slotId = text(formData, "slotId").trim();
  if (!UUID_PATTERN.test(slotId)) {
    return { status: "error", message: "That time is not available." };
  }

  try {
    const result = await writeReminder(authorized.session, slotId);
    if (!result.ok) {
      return { status: "error", message: result.message };
    }

    revalidatePath(`/desk/slot/${result.slotId}`);
    revalidatePath("/desk");
    revalidatePath("/care");

    return { status: "success", message: result.message };
  } catch {
    return { status: "error", message: CLAIM_REVIEW_GENERIC_FAILURE };
  }
}

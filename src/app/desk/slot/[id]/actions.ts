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
  approveClaim,
  revokeClaim,
} from "@/server/repositories/claim-review";

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

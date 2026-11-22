"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guards";
import { DESK_ROLES } from "@/server/auth/policy";
import {
  REVIEW_GENERIC_FAILURE,
  REVIEW_SESSION_ENDED,
  type ReviewActionField,
  type ReviewActionState,
} from "@/server/domain/ask-review";
import {
  approveAskForCoordinator,
  resolveHeldDraftForCoordinator,
  sendBackAskForCoordinator,
} from "@/server/services/ask-review";

/**
 * The approve / send-back / held-publish actions.
 *
 * Each one re-derives the desk session; the page's guard is never the
 * enforcement. The repository re-checks the desk role, the church scope, and
 * the ask status inside a row lock, so a stale tab or a second coordinator gets
 * a calm refusal rather than publishing twice. Failures are returned as
 * values, never thrown into the browser.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorState(
  message: string,
  field: ReviewActionField = "form",
): ReviewActionState {
  return { status: "error", message, field };
}

function successState(message: string): ReviewActionState {
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
 * The ask review page, the queue, the board, the caregiver's receipt, and the
 * caregiver home all read state this action changes. Revalidate them together
 * so no screen can show the old answer after a transition.
 */
function refreshAfterTransition(askId: string): void {
  revalidatePath(`/desk/ask/${askId}`);
  revalidatePath("/desk");
  revalidatePath("/circle");
  revalidatePath("/care");
  revalidatePath(`/ask/${askId}`);
}

export async function approveAskAction(
  _previous: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const authorized = await deskSession();
  if (!authorized) return errorState(REVIEW_SESSION_ENDED);

  const askId = text(formData, "askId").trim();
  if (!UUID_PATTERN.test(askId)) {
    return errorState("That ask is not available.");
  }

  try {
    const result = await approveAskForCoordinator(authorized.session, askId);
    if (!result.ok) return errorState(result.message);
    refreshAfterTransition(result.askId);
    return successState(result.message);
  } catch {
    return errorState(REVIEW_GENERIC_FAILURE);
  }
}

export async function sendBackAskAction(
  _previous: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const authorized = await deskSession();
  if (!authorized) return errorState(REVIEW_SESSION_ENDED);

  const askId = text(formData, "askId").trim();
  if (!UUID_PATTERN.test(askId)) {
    return errorState("That ask is not available.");
  }

  // The note is passed through untouched. The domain validator refuses a
  // whitespace-only note; it never trims or rewrites a real one.
  const note = text(formData, "note");

  try {
    const result = await sendBackAskForCoordinator(authorized.session, {
      askId,
      note,
    });
    if (!result.ok) {
      return errorState(result.message, result.reason === "invalid_note" ? "note" : "form");
    }
    refreshAfterTransition(result.askId);
    return successState(result.message);
  } catch {
    return errorState(REVIEW_GENERIC_FAILURE);
  }
}

/** Resolve a held draft's hold and publish it after the ask is approved. */
export async function publishHeldDraftAction(
  _previous: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const authorized = await deskSession();
  if (!authorized) return errorState(REVIEW_SESSION_ENDED);

  const slotId = text(formData, "slotId").trim();
  if (!UUID_PATTERN.test(slotId)) {
    return errorState("That time is not available.");
  }

  try {
    const result = await resolveHeldDraftForCoordinator(
      authorized.session,
      slotId,
    );
    if (!result.ok) return errorState(result.message);
    refreshAfterTransition(result.askId);
    return successState(result.message);
  } catch {
    return errorState(REVIEW_GENERIC_FAILURE);
  }
}

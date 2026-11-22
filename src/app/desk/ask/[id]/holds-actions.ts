"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guards";
import { DESK_ROLES } from "@/server/auth/policy";
import {
  HOLD_GENERIC_FAILURE,
  HOLD_SESSION_ENDED,
  OVERRIDE_CONFIRMATION_FIELD,
  type HoldActionField,
  type HoldActionState,
} from "@/server/domain/holds";
import {
  closeHeldAsk,
  overrideSafetyHold,
} from "@/server/repositories/holds";

/**
 * The two human-only actions: close a held ask with the coordinator's words,
 * and convert a safety hold after an explicit confirmation and a reason.
 *
 * Each action re-derives the desk session. The repository re-checks the role,
 * the church scope, the ask status, and — for a conversion — the latest Q9
 * answer inside a row lock. A stale tab gets a calm refusal; a personal-care
 * hold can never be converted, whatever the request says.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorState(
  message: string,
  field: HoldActionField = "form",
): HoldActionState {
  return { status: "error", message, field };
}

function successState(message: string): HoldActionState {
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
 * A close or a conversion changes the desk, the queue, the family's page, and
 * the board-shaped reads. Revalidate them together so no screen keeps an old
 * state after the transition.
 */
function refreshAfterTransition(askId: string): void {
  revalidatePath(`/desk/ask/${askId}`);
  revalidatePath("/desk");
  revalidatePath(`/ask/${askId}`);
  revalidatePath("/care");
  revalidatePath("/circle");
  revalidatePath("/my-claims");
}

export async function closeHeldAskAction(
  _previous: HoldActionState,
  formData: FormData,
): Promise<HoldActionState> {
  const authorized = await deskSession();
  if (!authorized) return errorState(HOLD_SESSION_ENDED);

  const askId = text(formData, "askId").trim();
  if (!UUID_PATTERN.test(askId)) {
    return errorState("That ask is not available.");
  }

  // The note is passed through untouched: the validator refuses a blank note
  // and never trims or rewrites the coordinator's words.
  const note = text(formData, "note");

  try {
    const result = await closeHeldAsk(authorized.session, { askId, note });
    if (!result.ok) {
      return errorState(result.message, result.field ?? "form");
    }
    refreshAfterTransition(askId);
    return successState(result.message);
  } catch {
    return errorState(HOLD_GENERIC_FAILURE);
  }
}

export async function overrideSafetyHoldAction(
  _previous: HoldActionState,
  formData: FormData,
): Promise<HoldActionState> {
  const authorized = await deskSession();
  if (!authorized) return errorState(HOLD_SESSION_ENDED);

  const askId = text(formData, "askId").trim();
  if (!UUID_PATTERN.test(askId)) {
    return errorState("That ask is not available.");
  }

  try {
    const result = await overrideSafetyHold(authorized.session, {
      askId,
      confirmation: text(formData, OVERRIDE_CONFIRMATION_FIELD),
      reason: text(formData, "reason"),
    });
    if (!result.ok) {
      return errorState(result.message, result.field ?? "form");
    }
    refreshAfterTransition(askId);
    return successState(result.message);
  } catch {
    return errorState(HOLD_GENERIC_FAILURE);
  }
}

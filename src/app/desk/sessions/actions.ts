"use server";

import { revalidatePath } from "next/cache";
import { resolveNow } from "@/lib/clock";
import { requireAction } from "@/server/auth/guards";
import { DESK_ROLES } from "@/server/auth/policy";
import {
  SESSION_ACTION_FAILED,
  SESSION_ENDED,
  fillCalendarMessage,
  type SessionActionState,
} from "@/server/domain/session-actions";
import {
  cancelSessionForCoordinator,
  markCallTaskDone,
  materialiseSessionsForChurch,
  restoreSessionForCoordinator,
} from "@/server/repositories/sessions";

/**
 * The coordinator's calendar actions.
 *
 * Each action re-derives the desk session; the page's guard is never the
 * enforcement. The repository checks the church scope and the session state, so
 * a stale tab or a second coordinator gets a calm refusal. No action writes a
 * caregiver message.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NOT_A_SESSION = "That Respite Morning is not available.";

function errorState(message: string): SessionActionState {
  return { status: "error", message };
}

function successState(message: string): SessionActionState {
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

function refreshCalendar(): void {
  revalidatePath("/desk");
  revalidatePath("/desk/sessions");
  revalidatePath("/circle");
}

export async function fillCalendarAction(): Promise<SessionActionState> {
  const authorized = await deskSession();
  if (!authorized) return errorState(SESSION_ENDED);

  try {
    const outcome = await materialiseSessionsForChurch({
      churchId: authorized.session.churchId,
      actor: authorized.session,
      now: resolveNow(),
    });

    refreshCalendar();

    if (outcome.checked === 0) {
      return errorState(
        "No weekly Respite Morning template is active, so there is nothing to fill. A person turns the weekly morning back on first.",
      );
    }

    return successState(fillCalendarMessage(outcome.inserted, outcome.checked));
  } catch {
    return errorState(SESSION_ACTION_FAILED);
  }
}

export async function cancelSessionAction(
  _previous: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  const authorized = await deskSession();
  if (!authorized) return errorState(SESSION_ENDED);

  const sessionId = text(formData, "sessionId").trim();
  if (!UUID_PATTERN.test(sessionId)) return errorState(NOT_A_SESSION);

  try {
    const result = await cancelSessionForCoordinator(
      authorized.session,
      sessionId,
      undefined,
      resolveNow(),
    );
    if (!result.ok) return errorState(result.message);

    refreshCalendar();
    return successState(result.message);
  } catch {
    return errorState(SESSION_ACTION_FAILED);
  }
}

export async function restoreSessionAction(
  _previous: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  const authorized = await deskSession();
  if (!authorized) return errorState(SESSION_ENDED);

  const sessionId = text(formData, "sessionId").trim();
  if (!UUID_PATTERN.test(sessionId)) return errorState(NOT_A_SESSION);

  try {
    const result = await restoreSessionForCoordinator(
      authorized.session,
      sessionId,
      undefined,
      resolveNow(),
    );
    if (!result.ok) return errorState(result.message);

    refreshCalendar();
    return successState(result.message);
  } catch {
    return errorState(SESSION_ACTION_FAILED);
  }
}

export async function markCalledAction(
  _previous: SessionActionState,
  formData: FormData,
): Promise<SessionActionState> {
  const authorized = await deskSession();
  if (!authorized) return errorState(SESSION_ENDED);

  const slotId = text(formData, "slotId").trim();
  if (!UUID_PATTERN.test(slotId)) {
    return errorState("That call task is not available.");
  }

  try {
    const result = await markCallTaskDone(
      authorized.session,
      slotId,
      undefined,
      resolveNow(),
    );
    if (!result.ok) return errorState(result.message);

    refreshCalendar();
    return successState(result.message);
  } catch {
    return errorState(SESSION_ACTION_FAILED);
  }
}

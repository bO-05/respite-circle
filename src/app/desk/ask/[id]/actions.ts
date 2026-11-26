"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guards";
import { DESK_ROLES } from "@/server/auth/policy";
import {
  parseWallTimeInput,
  validateDraftSlotInput,
  type DraftActionState,
  type DraftSlotSubmittedValues,
} from "@/server/domain/slots";
import {
  addDraftSlot,
  getDraftSlotActionContext,
  holdDraftSlot,
  releaseDraftSlot,
  removeDraftSlot,
  updateDraftSlot,
} from "@/server/repositories/draft-slots";
import { proposeDraftsForAsk } from "@/server/services/slot-construction";
import { reevaluateExclusions } from "@/server/services/candidate-evaluation";

/**
 * Server actions for the draft editor.
 *
 * Authorization is re-derived here on every call: the page's guard is never
 * the enforcement. The repository re-checks the desk role and church scope, and
 * its conditional write re-checks that the slot is still a draft on an ask that
 * is still waiting. Failures come back as calm values, never as a thrown stack
 * the browser could display.
 */

const SESSION_ENDED =
  "Your sign-in has ended. Open your access link again, then try once more.";
const GENERIC_FAILURE =
  "That change did not save. Nothing was published. Please try once more.";

/** Ask and slot ids are UUIDs; a hand-edited value is refused before a query. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorState(
  message: string,
  field: DraftActionState["field"] = "form",
  values?: DraftSlotSubmittedValues,
): DraftActionState {
  return { status: "error", message, field, values };
}

function successState(message: string, slotId?: string): DraftActionState {
  return { status: "success", message, slotId };
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

function refresh(askId: string): void {
  revalidatePath(`/desk/ask/${askId}`);
  revalidatePath("/desk");
}

/**
 * One form per draft, with an `intent` button: save, hold, release, or remove.
 * The intent decides which fields matter, so pressing Hold never fails because
 * a label field is momentarily blank.
 */
export async function draftSlotAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  // React resets an uncontrolled form after its action. Read the fields before
  // every check and hand them back with every refusal, so the coordinator's
  // unsaved words survive a refused Hold, Release, Remove, or Save.
  const submitted: DraftSlotSubmittedValues = {
    kind: text(formData, "kind"),
    label: text(formData, "label"),
    windowStart: text(formData, "windowStart"),
    windowEnd: text(formData, "windowEnd"),
    gated: formData.get("gated") === "on",
    orientationNote: text(formData, "orientationNote"),
  };
  const fail = (
    message: string,
    field: DraftActionState["field"] = "form",
  ) => errorState(message, field, submitted);

  const authorized = await deskSession();
  if (!authorized) return fail(SESSION_ENDED);

  const { session } = authorized;
  const slotId = text(formData, "slotId").trim();
  const intent = text(formData, "intent").trim() || "save";

  if (!UUID_PATTERN.test(slotId)) {
    return fail("That draft is not available.");
  }

  try {
    const context = await getDraftSlotActionContext(session, slotId);
    if (!context) return fail("That draft is not available.");

    if (context.askStatus !== "waiting_coordinator") {
      return fail(
        "This ask is no longer waiting for a coordinator, so its drafts cannot be changed here.",
      );
    }

    if (intent === "hold") {
      const result = await holdDraftSlot(session, {
        slotId,
        reason: text(formData, "holdReason"),
      });
      if (!result.ok) return fail(result.message, "reason");
      refresh(result.askId);
      return successState(result.message, slotId);
    }

    if (intent === "release") {
      const result = await releaseDraftSlot(session, slotId);
      if (!result.ok) return fail(result.message);
      refresh(result.askId);
      return successState(result.message, slotId);
    }

    if (intent === "remove") {
      const result = await removeDraftSlot(session, slotId);
      if (!result.ok) return fail(result.message);
      refresh(result.askId);
      return successState(result.message, slotId);
    }

    if (intent !== "save") {
      return fail("That action is not one this page offers.");
    }

    if (text(formData, "kind") === "drive" && !context.transportEnabled) {
      return fail(
        "A drive can only be offered after the church signs its volunteer-driver policy. No change was saved.",
        "kind",
      );
    }

    const start = parseWallTimeInput(
      text(formData, "windowStart"),
      context.timeZone,
    );
    if (!start.ok) return fail(start.message, "window");

    const end = parseWallTimeInput(
      text(formData, "windowEnd"),
      context.timeZone,
    );
    if (!end.ok) return fail(end.message, "window");

    const validated = validateDraftSlotInput({
      kind: text(formData, "kind"),
      label: text(formData, "label"),
      windowStart: start.date,
      windowEnd: end.date,
      gated: formData.get("gated") === "on",
      orientationNote: text(formData, "orientationNote"),
    });

    if (!validated.ok) return fail(validated.message, validated.field);

    const result = await updateDraftSlot(session, {
      slotId,
      ...validated.value,
    });
    if (!result.ok) return fail(result.message);

    refresh(result.askId);
    return successState(result.message, slotId);
  } catch {
    return errorState(GENERIC_FAILURE, "form", submitted);
  }
}

/** Add a coordinator-authored draft to a waiting ask. */
export async function addDraftAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const authorized = await deskSession();
  if (!authorized) return errorState(SESSION_ENDED);

  const askId = text(formData, "askId").trim();
  if (!UUID_PATTERN.test(askId)) {
    return errorState("That ask is not available.");
  }

  try {
    const result = await addDraftSlot(authorized.session, {
      askId,
      kind: text(formData, "kind"),
    });
    if (!result.ok) return errorState(result.message, "kind");
    refresh(result.askId);
    return successState(result.message, result.slotId);
  } catch {
    return errorState(GENERIC_FAILURE);
  }
}

/** Check every active volunteer against every draft time again. */
export async function reevaluateCandidatesAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const authorized = await deskSession();
  if (!authorized) return errorState(SESSION_ENDED);

  const askId = text(formData, "askId").trim();
  if (!UUID_PATTERN.test(askId)) {
    return errorState("That ask is not available.");
  }

  try {
    const result = await reevaluateExclusions(authorized.session, askId);
    if (!result.ok) return errorState(result.message);
    refresh(askId);
    return successState(result.message);
  } catch {
    return errorState(GENERIC_FAILURE);
  }
}

/** Run plain-code construction again, once, for an ask that has no drafts yet. */
export async function proposeDraftsAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const authorized = await deskSession();
  if (!authorized) return errorState(SESSION_ENDED);

  const askId = text(formData, "askId").trim();
  if (!UUID_PATTERN.test(askId)) {
    return errorState("That ask is not available.");
  }

  try {
    const result = await proposeDraftsForAsk(authorized.session, askId);

    if (result.reason === "created") {
      refresh(askId);
      const times = result.proposals === 1 ? "time" : "times";
      return successState(
        result.proposals === 0
          ? "The rules found no practical need in the nine answers. Nothing was added. A person can still add a time."
          : `The rules proposed ${result.proposals} draft ${times}. They are not published.`,
      );
    }

    if (result.reason === "already_constructed") {
      return errorState(
        "The rules have already proposed times for this ask. Nothing was added again.",
      );
    }
    if (result.reason === "blocked" || result.reason === "no_answers") {
      return errorState(
        result.blocked?.message ??
          "This ask cannot be turned into times. A person will decide.",
      );
    }
    if (result.reason === "not_reviewable") {
      return errorState(
        "This ask is not waiting for a coordinator, so no times were proposed.",
      );
    }
    return errorState("That ask is not available.");
  } catch {
    return errorState(GENERIC_FAILURE);
  }
}

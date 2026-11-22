"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guards";
import { DESK_ROLES } from "@/server/auth/policy";
import {
  INVITE_ACTION_FAILED,
  INVITE_SESSION_ENDED,
  type InviteActionState,
} from "@/server/domain/invites";
import { createInvite } from "@/server/repositories/invites";

/**
 * The coordinator's one invitation action.
 *
 * The page's guard is never the enforcement: this action re-derives the desk
 * session, and the repository writes the row through a church-scoped
 * `INSERT … SELECT`. A caregiver id from another church matches no row, so the
 * action answers with a calm refusal and stores nothing.
 *
 * The action writes the invitation row and its audit event. It never writes a
 * notification: no email, no SMS, no broadcast.
 */

function errorState(message: string): InviteActionState {
  return { status: "error", message };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function sendInviteAction(
  _previous: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  let authorized;
  try {
    authorized = await requireAction(DESK_ROLES);
  } catch {
    return errorState(INVITE_SESSION_ENDED);
  }

  try {
    const result = await createInvite(authorized.session, {
      caregiverId: text(formData, "caregiverId").trim(),
      body: text(formData, "body"),
    });

    if (!result.ok) {
      return errorState(result.message);
    }

    revalidatePath("/desk/invite");
    revalidatePath("/desk");
    revalidatePath("/ask");
    revalidatePath("/care");

    return { status: "success", message: result.message };
  } catch {
    return errorState(INVITE_ACTION_FAILED);
  }
}

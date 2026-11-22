"use client";

import { useActionState } from "react";
import {
  IDLE_REMINDER_ACTION,
  type ReminderActionState,
} from "@/server/domain/notifications";
import { writeReminderAction } from "@/app/desk/slot/[id]/actions";

/**
 * The one reminder's write control.
 *
 * A 44px primary target with a visible label. The button sends only the slot
 * id; the sentence is rendered again on the server from the church's template
 * and the time's own facts. The repository re-checks every condition, so this
 * control is an affordance, never the enforcement.
 */

function Feedback({ state }: { state: ReminderActionState }) {
  if (state.status === "idle") return null;
  const isError = state.status === "error";

  return (
    <p
      data-testid="write-reminder-feedback"
      role={isError ? "alert" : "status"}
      className={`max-w-prose rounded-md border px-4 py-3 text-base leading-relaxed ${
        isError
          ? "border-red bg-red-soft text-ink"
          : "border-green bg-green-soft text-ink"
      }`}
    >
      {state.message}
    </p>
  );
}

export function WriteReminderForm({ slotId }: { slotId: string }) {
  const [state, formAction, pending] = useActionState(
    writeReminderAction,
    IDLE_REMINDER_ACTION,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="slotId" value={slotId} />
      <button
        type="submit"
        data-testid="write-reminder"
        disabled={pending}
        className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Writing the reminder…" : "Write this reminder to the family"}
      </button>
      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        This writes the one message shown above. Nothing else is sent, and it
        cannot be written twice.
      </p>
      <Feedback state={state} />
    </form>
  );
}

"use client";

import { useActionState, useId } from "react";
import {
  IDLE_HOLD_ACTION,
  OVERRIDE_CONFIRMATION_FIELD,
  OVERRIDE_CONFIRMATION_VALUE,
  type HoldActionState,
} from "@/server/domain/holds";
import {
  closeHeldAskAction,
  overrideSafetyHoldAction,
} from "@/app/desk/ask/[id]/holds-actions";

/**
 * The close and override forms.
 *
 * Each is a plain HTML control with a 44px target, a visible label, and an
 * error announced and associated with its field. The server action re-derives
 * the session and the repository re-checks the ask inside a row lock; nothing
 * on this screen is the enforcement. The override's confirmation is a separate
 * control from its reason, so a reason alone can never convert a hold.
 */

function Feedback({
  state,
  testId,
}: {
  state: HoldActionState;
  testId: string;
}) {
  if (state.status === "idle") return null;
  const isError = state.status === "error";
  return (
    <p
      data-testid={testId}
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

export function CloseHeldAskForm({ askId }: { askId: string }) {
  const [state, formAction, pending] = useActionState(
    closeHeldAskAction,
    IDLE_HOLD_ACTION,
  );

  const noteId = useId();
  const hintId = useId();
  const errorId = useId();
  const noteError = state.status === "error" && state.field === "note";

  return (
    <form
      action={formAction}
      data-testid="hold-close-form"
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="askId" value={askId} />

      <label htmlFor={noteId} className="text-lg font-semibold text-ink">
        Your words for the family (required)
      </label>
      <p
        id={hintId}
        className="max-w-prose text-base leading-relaxed text-ink-muted"
      >
        They will read this exactly as you write it. Nothing is published and no
        message is generated.
      </p>
      <textarea
        id={noteId}
        name="note"
        data-testid="hold-close-note"
        rows={5}
        required
        aria-invalid={noteError || undefined}
        aria-describedby={noteError ? `${hintId} ${errorId}` : hintId}
        className="w-full max-w-prose rounded-md border border-line bg-paper px-4 py-3 text-lg leading-relaxed text-ink"
      />
      <div id={errorId}>
        <Feedback state={state} testId="hold-close-feedback" />
      </div>

      <button
        type="submit"
        data-testid="hold-close-submit"
        disabled={pending}
        className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-ink bg-ink px-5 py-2 text-lg font-semibold text-paper disabled:opacity-60"
      >
        {pending ? "Closing…" : "Close this ask with these words"}
      </button>
    </form>
  );
}

export function OverrideSafetyHoldForm({ askId }: { askId: string }) {
  const [state, formAction, pending] = useActionState(
    overrideSafetyHoldAction,
    IDLE_HOLD_ACTION,
  );

  const confirmId = useId();
  const reasonId = useId();
  const reasonHintId = useId();
  const confirmErrorId = useId();
  const reasonErrorId = useId();
  const confirmError = state.status === "error" && state.field === "confirm";
  const reasonError = state.status === "error" && state.field === "reason";

  return (
    <form
      action={formAction}
      data-testid="hold-override-form"
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="askId" value={askId} />

      <div className="flex max-w-prose flex-col gap-2">
        <div className="flex items-start gap-3">
          <input
            id={confirmId}
            type="checkbox"
            name={OVERRIDE_CONFIRMATION_FIELD}
            value={OVERRIDE_CONFIRMATION_VALUE}
            required
            data-testid="hold-override-confirm"
            aria-invalid={confirmError || undefined}
            aria-describedby={confirmError ? confirmErrorId : undefined}
            className="mt-1 h-6 w-6 shrink-0"
          />
          <label htmlFor={confirmId} className="text-lg leading-relaxed text-ink">
            I called the family today and confirmed there is no immediate
            danger.
          </label>
        </div>
        <div id={confirmErrorId}>
          {confirmError ? (
            <Feedback state={state} testId="hold-override-confirm-error" />
          ) : null}
        </div>
      </div>

      <label htmlFor={reasonId} className="text-lg font-semibold text-ink">
        Why you are converting this hold (required)
      </label>
      <p
        id={reasonHintId}
        className="max-w-prose text-base leading-relaxed text-ink-muted"
      >
        Kept with your name in the church&apos;s record. It is never done
        automatically, and no time is published by this action.
      </p>
      <textarea
        id={reasonId}
        name="reason"
        data-testid="hold-override-reason"
        rows={4}
        required
        aria-invalid={reasonError || undefined}
        aria-describedby={
          reasonError ? `${reasonHintId} ${reasonErrorId}` : reasonHintId
        }
        className="w-full max-w-prose rounded-md border border-line bg-paper px-4 py-3 text-lg leading-relaxed text-ink"
      />
      <div id={reasonErrorId}>
        {reasonError ? (
          <Feedback state={state} testId="hold-override-reason-error" />
        ) : null}
      </div>

      <Feedback state={state} testId="hold-override-feedback" />

      <button
        type="submit"
        data-testid="hold-override-submit"
        disabled={pending}
        className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-amber bg-amber-soft px-5 py-2 text-lg font-semibold text-ink disabled:opacity-60"
      >
        {pending ? "Recording…" : "Record the override"}
      </button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import {
  IDLE_SESSION_ACTION,
  type SessionActionState,
} from "@/server/domain/session-actions";
import {
  cancelSessionAction,
  fillCalendarAction,
  markCalledAction,
  restoreSessionAction,
} from "@/app/desk/sessions/actions";

/**
 * The coordinator's calendar forms.
 *
 * Each form announces its result through `useActionState`; the server action
 * re-derives the desk session and the repository re-checks the church and the
 * session state. Buttons are 44px targets and use a plain sentence.
 */

function Feedback({
  state,
  testId,
}: {
  state: SessionActionState;
  testId: string;
}) {
  if (state.status === "idle") return null;
  const isError = state.status === "error";
  return (
    <p
      data-testid={testId}
      role={isError ? "alert" : "status"}
      className={`rounded-md border px-4 py-3 text-base leading-relaxed ${
        isError
          ? "border-red bg-red-soft text-ink"
          : "border-green bg-green-soft text-ink"
      }`}
    >
      {state.message}
    </p>
  );
}

export function FillCalendarForm({
  label = "Fill the next four Tuesdays",
}: {
  label?: string;
}) {
  const [state, formAction, pending] = useActionState(
    fillCalendarAction,
    IDLE_SESSION_ACTION,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <button
        type="submit"
        data-testid="session-fill"
        disabled={pending}
        className="inline-flex min-h-11 w-fit items-center rounded-md border border-accent bg-accent px-5 py-2 text-base font-semibold text-paper disabled:opacity-60"
      >
        {pending ? "Filling the calendar…" : label}
      </button>
      <Feedback state={state} testId="session-fill-feedback" />
    </form>
  );
}

export function CancelSessionForm({
  sessionId,
  dateLabel,
}: {
  sessionId: string;
  dateLabel: string;
}) {
  const [state, formAction, pending] = useActionState(
    cancelSessionAction,
    IDLE_SESSION_ACTION,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <button
        type="submit"
        data-testid={`session-cancel-${sessionId}`}
        disabled={pending}
        className="inline-flex min-h-11 w-fit items-center rounded-md border border-accent bg-surface px-5 py-2 text-base font-semibold text-ink disabled:opacity-60"
      >
        {pending ? "Cancelling…" : `Cancel ${dateLabel}`}
      </button>
      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        Cancelling closes every place on that morning and puts a call task on
        the desk for each one. The family is sent nothing.
      </p>
      <Feedback state={state} testId="session-cancel-feedback" />
    </form>
  );
}

export function RestoreSessionForm({
  sessionId,
  dateLabel,
}: {
  sessionId: string;
  dateLabel: string;
}) {
  const [state, formAction, pending] = useActionState(
    restoreSessionAction,
    IDLE_SESSION_ACTION,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <button
        type="submit"
        data-testid={`session-restore-${sessionId}`}
        disabled={pending}
        className="inline-flex min-h-11 w-fit items-center rounded-md border border-boundary bg-surface px-5 py-2 text-base font-semibold text-ink disabled:opacity-60"
      >
        {pending ? "Restoring…" : `Put ${dateLabel} back on the calendar`}
      </button>
      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        The times cancelled earlier stay cancelled. A person decides what to
        re-offer.
      </p>
      <Feedback state={state} testId="session-restore-feedback" />
    </form>
  );
}

export function MarkCalledForm({ slotId }: { slotId: string }) {
  const [state, formAction, pending] = useActionState(
    markCalledAction,
    IDLE_SESSION_ACTION,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="slotId" value={slotId} />
      <button
        type="submit"
        data-testid={`call-task-done-${slotId}`}
        disabled={pending}
        className="inline-flex min-h-11 w-fit items-center rounded-md border border-boundary bg-surface px-5 py-2 text-base font-semibold text-ink disabled:opacity-60"
      >
        {pending ? "Recording…" : "I called this family"}
      </button>
      <Feedback state={state} testId="call-task-feedback" />
    </form>
  );
}

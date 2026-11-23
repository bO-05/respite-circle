"use client";

import { useActionState, useId } from "react";
import {
  COVERAGE_CALL_OUTCOMES,
  COVERAGE_CALL_OUTCOME_LABELS,
  COVERAGE_NOTE_MAX_LENGTH,
  IDLE_COVERAGE_ACTION,
  type CoverageActionState,
} from "@/server/domain/coverage";
import {
  expireSlotUnclaimedAction,
  recordCoverageCallAction,
  reofferSlotAction,
} from "@/app/desk/slot/[id]/actions";

/**
 * The three coverage-watch controls.
 *
 * Each is a plain form whose only payload is the slot id plus human input. The
 * server action re-derives the desk session and the repository re-locks the
 * slot; nothing here is the enforcement. Every message is announced, and the
 * destructive action is named plainly rather than hidden behind an icon.
 */

function Feedback({
  state,
  testId,
}: {
  state: CoverageActionState;
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

export function CoverageCallForm({ slotId }: { slotId: string }) {
  const [state, formAction, pending] = useActionState(
    recordCoverageCallAction,
    IDLE_COVERAGE_ACTION,
  );

  const noteId = useId();
  const hintId = useId();
  const errorId = useId();
  const outcomeError = state.status === "error" && state.field === "outcome";
  const noteError = state.status === "error" && state.field === "note";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="slotId" value={slotId} />

      <fieldset
        aria-describedby={outcomeError ? errorId : undefined}
        className="flex flex-col gap-2"
      >
        <legend className="text-lg font-semibold text-ink">
          What happened on the call?
        </legend>
        <div className="flex flex-col gap-1">
          {COVERAGE_CALL_OUTCOMES.map((outcome) => (
            <label
              key={outcome}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 text-base leading-relaxed text-ink"
            >
              <input
                type="radio"
                name="outcome"
                value={outcome}
                required
                defaultChecked={state.values?.outcome === outcome}
                className="h-5 w-5 shrink-0"
              />
              {COVERAGE_CALL_OUTCOME_LABELS[outcome]}
            </label>
          ))}
        </div>
      </fieldset>

      <label htmlFor={noteId} className="text-lg font-semibold text-ink">
        A note for the church&apos;s record (optional)
      </label>
      <p
        id={hintId}
        className="max-w-prose text-base leading-relaxed text-ink-muted"
      >
        The family does not see this note. It stays with the church&apos;s own
        record of the call.
      </p>
      <textarea
        id={noteId}
        name="note"
        data-testid="coverage-call-note"
        rows={3}
        maxLength={COVERAGE_NOTE_MAX_LENGTH}
        defaultValue={state.values?.note ?? ""}
        aria-describedby={noteError ? `${hintId} ${errorId}` : hintId}
        className="w-full max-w-prose rounded-md border border-line bg-paper px-4 py-3 text-lg leading-relaxed text-ink"
      />

      <button
        type="submit"
        data-testid="save-coverage-call"
        disabled={pending}
        className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Saving the call…" : "Save this call"}
      </button>

      <div id={errorId}>
        <Feedback state={state} testId="coverage-call-feedback" />
      </div>
    </form>
  );
}

export function CoverageReofferForm({
  slotId,
  disabledReason,
}: {
  slotId: string;
  disabledReason: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    reofferSlotAction,
    IDLE_COVERAGE_ACTION,
  );

  if (disabledReason) {
    return (
      <p
        data-testid="coverage-reoffer-disabled"
        className="max-w-prose text-base leading-relaxed text-ink-muted"
      >
        {disabledReason}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="slotId" value={slotId} />
      <button
        type="submit"
        data-testid="coverage-reoffer"
        disabled={pending}
        className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-line bg-surface px-5 py-2 text-lg font-semibold text-ink disabled:opacity-60"
      >
        {pending ? "Offering the time again…" : "Offer this time to the congregation again"}
      </button>
      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        This can happen once, and only after a call is recorded. It moves the
        time forward on the board and sends the family nothing.
      </p>
      <Feedback state={state} testId="coverage-reoffer-feedback" />
    </form>
  );
}

export function CoverageExpireForm({ slotId }: { slotId: string }) {
  const [state, formAction, pending] = useActionState(
    expireSlotUnclaimedAction,
    IDLE_COVERAGE_ACTION,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="slotId" value={slotId} />
      <button
        type="submit"
        data-testid="coverage-expire"
        disabled={pending}
        className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-line bg-surface px-5 py-2 text-lg font-semibold text-ink disabled:opacity-60"
      >
        {pending
          ? "Closing the time…"
          : "Close this time without a claim"}
      </button>
      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        This writes the church&apos;s proof that no message was sent about this
        time. It is refused, and nothing changes, if the family&apos;s page
        already has a message.
      </p>
      <Feedback state={state} testId="coverage-expire-feedback" />
    </form>
  );
}

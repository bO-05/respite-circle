"use client";

import { useActionState, useId } from "react";
import {
  approveButtonLabel,
  IDLE_REVIEW_ACTION,
  type ReviewActionState,
} from "@/server/domain/ask-review";
import {
  approveAskAction,
  publishHeldDraftAction,
  sendBackAskAction,
} from "@/app/desk/ask/[id]/approval-actions";

/**
 * The approve and send-back forms.
 *
 * Each form is a plain HTML control with a 44px primary target, a label, an
 * announced error, and the error associated with its field. The server action
 * re-derives the session and the repository re-checks the ask status inside a
 * row lock; nothing on this screen is the enforcement.
 */

function Feedback({
  state,
  testId,
}: {
  state: ReviewActionState;
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

export function ApproveAskForm({
  askId,
  publishableCount,
  heldCount,
}: {
  askId: string;
  publishableCount: number;
  heldCount: number;
}) {
  const [state, formAction, pending] = useActionState(
    approveAskAction,
    IDLE_REVIEW_ACTION,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="askId" value={askId} />
      <button
        type="submit"
        data-testid="approve-ask"
        disabled={pending}
        className="inline-flex min-h-11 w-fit items-center justify-center rounded-md bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Publishing…" : approveButtonLabel(publishableCount)}
      </button>
      {heldCount > 0 ? (
        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          {heldCount === 1
            ? "One held time stays unpublished with its reason."
            : `${heldCount} held times stay unpublished with their reasons.`}
        </p>
      ) : null}
      <Feedback state={state} testId="approve-feedback" />
    </form>
  );
}

export function SendBackForm({ askId }: { askId: string }) {
  const [state, formAction, pending] = useActionState(
    sendBackAskAction,
    IDLE_REVIEW_ACTION,
  );

  const noteId = useId();
  const hintId = useId();
  const errorId = useId();
  const noteError = state.status === "error" && state.field === "note";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="askId" value={askId} />

      <label htmlFor={noteId} className="text-lg font-semibold text-ink">
        A note for the family (required)
      </label>
      <p
        id={hintId}
        className="max-w-prose text-base leading-relaxed text-ink-muted"
      >
        They will read this exactly as you write it. Nothing new is published
        from this ask, and an open low-risk time comes off the board.
      </p>
      <textarea
        id={noteId}
        name="note"
        data-testid="send-back-note"
        rows={5}
        required
        defaultValue={state.values?.note ?? ""}
        aria-invalid={noteError || undefined}
        aria-describedby={noteError ? `${hintId} ${errorId}` : hintId}
        className="w-full max-w-prose rounded-md border border-line bg-paper px-4 py-3 text-lg leading-relaxed text-ink"
      />
      <div id={errorId}>
        <Feedback state={state} testId="send-back-feedback" />
      </div>

      <button
        type="submit"
        data-testid="send-back-submit"
        disabled={pending}
        className="inline-flex min-h-11 w-fit items-center justify-center rounded-md border border-ink bg-ink px-5 py-2 text-lg font-semibold text-paper disabled:opacity-60"
      >
        {pending ? "Sending back…" : "Send back with this note"}
      </button>
    </form>
  );
}

/**
 * A held draft on an already-approved ask. One deliberate action resolves the
 * recorded hold and publishes the time; the audit log keeps both facts.
 */
export function PublishHeldDraftForm({ slotId }: { slotId: string }) {
  const [state, formAction, pending] = useActionState(
    publishHeldDraftAction,
    IDLE_REVIEW_ACTION,
  );

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="slotId" value={slotId} />
      <button
        type="submit"
        data-testid="publish-held"
        disabled={pending}
        className="inline-flex min-h-11 w-fit items-center justify-center rounded-md bg-accent px-5 py-2 text-base font-semibold text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Publishing…" : "Resolve the hold and publish"}
      </button>
      <Feedback state={state} testId="held-publish-feedback" />
    </form>
  );
}

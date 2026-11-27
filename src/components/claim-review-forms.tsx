"use client";

import { useActionState, useId } from "react";
import {
  IDLE_CLAIM_REVIEW_ACTION,
  type ClaimReviewActionState,
} from "@/server/domain/claim-review";
import {
  approveClaimAction,
  revokeClaimAction,
} from "@/app/desk/slot/[id]/actions";

/**
 * The confirm and take-back forms.
 *
 * Each is a plain HTML control with a 44px primary target, a visible label,
 * and an error announced and associated with its field. The server action
 * re-derives the session and the repository re-checks the claim inside a row
 * lock; nothing on this screen is the enforcement.
 */

function Feedback({
  state,
  testId,
}: {
  state: ClaimReviewActionState;
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

export function ApproveClaimForm({ slotId }: { slotId: string }) {
  const [state, formAction, pending] = useActionState(
    approveClaimAction,
    IDLE_CLAIM_REVIEW_ACTION,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="slotId" value={slotId} />
      <button
        type="submit"
        data-testid="approve-claim"
        disabled={pending}
        className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Confirming…" : "Confirm this time"}
      </button>
      <Feedback state={state} testId="approve-claim-feedback" />
    </form>
  );
}

export function RevokeClaimForm({ slotId }: { slotId: string }) {
  const [state, formAction, pending] = useActionState(
    revokeClaimAction,
    IDLE_CLAIM_REVIEW_ACTION,
  );

  const reasonId = useId();
  const hintId = useId();
  const errorId = useId();
  const reasonError = state.status === "error" && state.field === "reason";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="slotId" value={slotId} />

      <label htmlFor={reasonId} className="text-lg font-semibold text-ink">
        Why are you taking this claim back? (required)
      </label>
      <p
        id={hintId}
        className="max-w-prose text-base leading-relaxed text-ink-muted"
      >
        The reason is kept in the church&apos;s record. The family is not told,
        and nothing is sent to them.
      </p>
      <textarea
        id={reasonId}
        name="reason"
        data-testid="revoke-claim-reason"
        rows={3}
        required
        aria-invalid={reasonError || undefined}
        aria-describedby={reasonError ? `${hintId} ${errorId}` : hintId}
        className="w-full max-w-prose rounded-md border border-boundary bg-paper px-4 py-3 text-lg leading-relaxed text-ink"
      />
      <div id={errorId}>
        <Feedback state={state} testId="revoke-claim-feedback" />
      </div>

      <button
        type="submit"
        data-testid="revoke-claim"
        disabled={pending}
        className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-boundary bg-surface px-5 py-2 text-lg font-semibold text-ink disabled:opacity-60"
      >
        {pending ? "Taking the claim back…" : "Take this claim back"}
      </button>
    </form>
  );
}

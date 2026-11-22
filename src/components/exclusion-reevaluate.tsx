"use client";

import { useActionState } from "react";
import { IDLE_DRAFT_ACTION } from "@/server/domain/slots";
import { reevaluateCandidatesAction } from "@/app/desk/ask/[id]/actions";

/**
 * The panel's one control: check every active volunteer again.
 *
 * It is a plain form with a 44px target and an announced result. The kind of
 * change it is meant for is a coordinator recording a checklist, a reference, a
 * driver record, or a familiar-face attestation; the explanation then changes on
 * the next check rather than being frozen at construction time.
 */
export function ReevaluateCandidatesForm({ askId }: { askId: string }) {
  const [state, formAction, pending] = useActionState(
    reevaluateCandidatesAction,
    IDLE_DRAFT_ACTION,
  );

  const isError = state.status === "error";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="askId" value={askId} />
      <button
        type="submit"
        data-testid="exclusion-reevaluate"
        disabled={pending}
        className="inline-flex min-h-11 w-fit items-center justify-center rounded-md border border-ink bg-ink px-5 py-2 text-base font-semibold text-paper disabled:opacity-60"
      >
        {pending ? "Checking…" : "Check again"}
      </button>
      {state.status !== "idle" ? (
        <p
          data-testid="exclusion-feedback"
          role={isError ? "alert" : "status"}
          className={`max-w-prose rounded-md border px-4 py-3 text-base leading-relaxed ${
            isError
              ? "border-red bg-red-soft text-ink"
              : "border-green bg-green-soft text-ink"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

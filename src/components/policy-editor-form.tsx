"use client";

import {
  useActionState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { savePolicyAction } from "@/app/desk/policy/actions";
import {
  IDLE_POLICY_ACTION,
  type PolicyActionState,
} from "@/server/domain/policy-editor";

/**
 * The frame around the policy editor's fields.
 *
 * The fields themselves are server-rendered: the crisis script and referral
 * content never leave the coordinator's own page. This client wrapper owns
 * only the submit state, so a refused save (a blank sign-off, an unconfirmed
 * loosening) shows a calm, announced message without losing what a person
 * typed.
 *
 * The submit is dispatched by hand rather than through `action={formAction}`.
 * A native form action makes React reset every uncontrolled field when the
 * action settles, which would wipe a long edit the moment a sign-off or the
 * typed LOOSEN word is refused. Dispatching the same action inside a
 * transition keeps the typed fields in place for the correction and reports
 * the same pending state on the button.
 */
function Feedback({ state }: { state: PolicyActionState }) {
  if (state.status === "idle") return null;

  const isError = state.status === "error";

  return (
    <div
      data-testid="policy-feedback"
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={`rounded-md border px-4 py-3 text-base leading-relaxed ${
        isError
          ? "border-red bg-red-soft text-ink"
          : "border-green bg-green-soft text-ink"
      }`}
    >
      <p className="font-semibold">{state.message}</p>
      {state.errors.length > 0 ? (
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          {state.errors.map((error, index) => (
            <li key={`${index}-${error}`}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PolicyEditorForm({
  nextVersion,
  children,
}: {
  nextVersion: number;
  children: ReactNode;
}) {
  const [state, formAction, actionPending] = useActionState(
    savePolicyAction,
    IDLE_POLICY_ACTION,
  );
  const [transitionPending, startTransition] = useTransition();
  const pending = actionPending || transitionPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => {
      formAction(formData);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="policy-editor"
      aria-labelledby="policy-editor-heading"
      className="flex flex-col gap-8 rounded-lg border border-line bg-surface p-5"
    >
      <div>
        <h2
          id="policy-editor-heading"
          className="font-serif text-2xl text-ink"
        >
          Edit the promises
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          Saving creates version {nextVersion}. Every earlier version stays
          exactly as a family received it. Nothing is published until a named
          person signs it below.
        </p>
      </div>

      {children}

      <div className="flex flex-col gap-3 border-t border-line pt-6">
        <button
          type="submit"
          data-testid="policy-save"
          disabled={pending}
          className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground disabled:opacity-60"
        >
          {pending ? "Saving the new version…" : `Save and sign version ${nextVersion}`}
        </button>
        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          One save, one new version. The promises page and the next ask read it
          immediately; no restart and no redeploy.
        </p>
        <Feedback state={state} />
      </div>
    </form>
  );
}

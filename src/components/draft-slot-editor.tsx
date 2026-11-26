"use client";

import { useActionState } from "react";
import {
  IDLE_DRAFT_ACTION,
  type DraftActionState,
  type SlotKind,
  type SlotTier,
} from "@/server/domain/slots";
import {
  addDraftAction,
  draftSlotAction,
  proposeDraftsAction,
} from "@/app/desk/ask/[id]/actions";

/**
 * The draft editor's forms.
 *
 * Every field the coordinator may change is here: kind, label, window, gated
 * flag, and orientation note, plus hold, resolve, remove, and add. The server
 * action re-derives the session, the church scope, the ask status, and the
 * transport policy; nothing on this screen is the enforcement.
 *
 * The forms are plain HTML controls with labels, announced errors, and 44px
 * targets. A held draft shows its reason and a Resolve control; the page states
 * that it cannot be published until the hold is resolved.
 */

export type DraftSlotCardView = {
  id: string;
  kind: SlotKind;
  tier: SlotTier;
  label: string;
  windowStartLocal: string;
  windowEndLocal: string;
  windowLabel: string;
  gated: boolean;
  orientationNote: string;
  ruleRef: string;
  ruleText: string;
  holdReason: string | null;
  heldAtLabel: string | null;
  sessionMissing: boolean;
};

const KIND_OPTIONS: Array<{ value: SlotKind; label: string }> = [
  { value: "companion", label: "Companion place at Respite Morning" },
  { value: "home", label: "Home visit" },
  { value: "drive", label: "Drive" },
  { value: "meal", label: "Meal" },
];

function Feedback({
  state,
  testId,
}: {
  state: DraftActionState;
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

export function DraftSlotCard({
  slot,
  transportEnabled,
}: {
  slot: DraftSlotCardView;
  transportEnabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    draftSlotAction,
    IDLE_DRAFT_ACTION,
  );

  const held = Boolean(slot.holdReason);
  // A refusal hands back the fields exactly as submitted. React resets an
  // uncontrolled form after its action, so these defaults are what keeps the
  // coordinator's typed words on screen instead of discarding them.
  const values = state.status === "error" ? state.values : undefined;
  const fieldError = (field: DraftActionState["field"]) =>
    state.status === "error" && state.field === field;

  return (
    <li
      data-testid="draft-slot"
      data-slot-id={slot.id}
      data-kind={slot.kind}
      data-gated={slot.gated ? "true" : "false"}
      data-held={held ? "true" : "false"}
      className="rounded-lg border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-2xl text-ink">
          {slot.label || "Untitled draft"}
        </h3>
        <p
          data-testid="draft-gated"
          className="inline-flex min-h-7 items-center rounded-full border border-line bg-paper px-3 text-base font-semibold text-ink"
        >
          {slot.gated ? "Needs the in-home or driver checks" : "No extra checks"}
        </p>
      </div>

      <p
        data-testid="draft-rule-ref"
        className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
      >
        {slot.ruleText}
      </p>

      <p
        data-testid="draft-window"
        className="mt-2 max-w-prose text-base leading-relaxed text-ink"
      >
        <span className="font-semibold">Window:</span> {slot.windowLabel}
      </p>

      {slot.sessionMissing ? (
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          No Respite Morning is linked to this draft yet. A person links one when
          the session is confirmed.
        </p>
      ) : null}

      {held ? (
        <div
          data-testid="draft-held-notice"
          className="mt-4 rounded-md border border-amber bg-amber-soft px-4 py-3 text-base leading-relaxed text-ink"
        >
          <p className="font-semibold">
            Held — this draft cannot be published until the hold is resolved.
          </p>
          <p className="mt-1">
            <span className="font-semibold">Reason:</span> {slot.holdReason}
          </p>
          {slot.heldAtLabel ? (
            <p className="mt-1 text-ink-muted">Held {slot.heldAtLabel}</p>
          ) : null}
        </div>
      ) : null}

      <form action={formAction} className="mt-5 flex flex-col gap-4">
        <input type="hidden" name="slotId" value={slot.id} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${slot.id}-kind`}
              className="text-base font-semibold text-ink"
            >
              Kind
            </label>
            {/*
              An uncontrolled select keeps the option it mounted with: React
              only re-seeds defaultSelected when the default moves from null to
              a value, so a refusal that hands back a different kind would be
              undone by React's post-action form reset. Re-mounting on the
              handed-back value makes the coordinator's unsaved choice stick,
              as it already does for the text inputs, the checkbox, and the
              note.
            */}
            <select
              key={values?.kind ?? "stored-kind"}
              id={`${slot.id}-kind`}
              name="kind"
              data-testid="draft-kind"
              defaultValue={values?.kind ?? slot.kind}
              className="min-h-11 rounded-md border border-line bg-paper px-3 py-2 text-base text-ink"
              aria-describedby={
                fieldError("kind") ? `${slot.id}-kind-error` : undefined
              }
            >
              {KIND_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.value === "drive" && !transportEnabled}
                >
                  {option.label}
                  {option.value === "drive" && !transportEnabled
                    ? " — no driver policy signed"
                    : ""}
                </option>
              ))}
            </select>
            {fieldError("kind") ? (
              <p
                id={`${slot.id}-kind-error`}
                role="alert" className="text-base leading-relaxed text-red"
              >
                {state.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${slot.id}-label`}
              className="text-base font-semibold text-ink"
            >
              Label a neighbour will read
            </label>
            <input
              id={`${slot.id}-label`}
              name="label"
              data-testid="draft-label"
              type="text"
              maxLength={120}
              defaultValue={values?.label ?? slot.label}
              className="min-h-11 rounded-md border border-line bg-paper px-3 py-2 text-base text-ink"
              aria-describedby={
                fieldError("label") ? `${slot.id}-label-error` : undefined
              }
            />
            {fieldError("label") ? (
              <p
                id={`${slot.id}-label-error`}
                role="alert" className="text-base leading-relaxed text-red"
              >
                {state.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${slot.id}-window-start`}
              className="text-base font-semibold text-ink"
            >
              Window starts
            </label>
            <input
              id={`${slot.id}-window-start`}
              name="windowStart"
              data-testid="draft-window-start"
              type="datetime-local"
              defaultValue={values?.windowStart ?? slot.windowStartLocal}
              className="min-h-11 rounded-md border border-line bg-paper px-3 py-2 text-base text-ink"
              aria-describedby={
                fieldError("window") ? `${slot.id}-window-error` : undefined
              }
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${slot.id}-window-end`}
              className="text-base font-semibold text-ink"
            >
              Window ends
            </label>
            <input
              id={`${slot.id}-window-end`}
              name="windowEnd"
              data-testid="draft-window-end"
              type="datetime-local"
              defaultValue={values?.windowEnd ?? slot.windowEndLocal}
              className="min-h-11 rounded-md border border-line bg-paper px-3 py-2 text-base text-ink"
              aria-describedby={
                fieldError("window") ? `${slot.id}-window-error` : undefined
              }
            />
          </div>
        </div>

        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          Times are in the church&apos;s own timezone. Leave both blank when the
          window should be chosen with the family.
        </p>
        {fieldError("window") ? (
          <p
            id={`${slot.id}-window-error`}
            role="alert" className="text-base leading-relaxed text-red"
          >
            {state.message}
          </p>
        ) : null}

        <div className="flex items-start gap-3">
          <input
            id={`${slot.id}-gated`}
            name="gated"
            data-testid="draft-gated-flag"
            type="checkbox"
            defaultChecked={values?.gated ?? slot.gated}
            className="mt-1 size-11 rounded border border-line"
          />
          <label htmlFor={`${slot.id}-gated`} className="text-base text-ink">
            Needs the in-home checks or the driver policy before anyone can take
            this time.
          </label>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${slot.id}-orientation`}
            className="text-base font-semibold text-ink"
          >
            Orientation note — only the approved claimer reads this
          </label>
          <textarea
            id={`${slot.id}-orientation`}
            name="orientationNote"
            data-testid="draft-orientation"
            rows={5}
            maxLength={2_000}
            defaultValue={values?.orientationNote ?? slot.orientationNote}
            className="rounded-md border border-line bg-paper px-3 py-2 text-base leading-relaxed text-ink"
            aria-describedby={
              fieldError("orientationNote")
                ? `${slot.id}-orientation-error`
                : undefined
            }
          />
          {fieldError("orientationNote") ? (
            <p
              id={`${slot.id}-orientation-error`}
              role="alert" className="text-base leading-relaxed text-red"
            >
              {state.message}
            </p>
          ) : null}
        </div>

        {!held ? (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`${slot.id}-hold-reason`}
              className="text-base font-semibold text-ink"
            >
              Reason for a hold — only needed if you hold this draft
            </label>
            <input
              id={`${slot.id}-hold-reason`}
              name="holdReason"
              data-testid="draft-hold-reason"
              type="text"
              maxLength={500}
              className="min-h-11 rounded-md border border-line bg-paper px-3 py-2 text-base text-ink"
              aria-describedby={
                fieldError("reason") ? `${slot.id}-hold-error` : undefined
              }
            />
            {fieldError("reason") ? (
              <p
                id={`${slot.id}-hold-error`}
                role="alert" className="text-base leading-relaxed text-red"
              >
                {state.message}
              </p>
            ) : null}
          </div>
        ) : null}

        {/*
          One error, one place. A field-level message already sits beside its
          control; rendering the same sentence again here would make a reader
          (and a screen-wide text assertion) see it twice.
        */}
        {state.status !== "error" || state.field === "form" ? (
          <Feedback state={state} testId="draft-feedback" />
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            name="intent"
            value="save"
            data-testid="draft-save"
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 py-2 text-base font-semibold text-accent-foreground disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save this draft"}
          </button>

          {held ? (
            <button
              type="submit"
              name="intent"
              value="release"
              data-testid="draft-release"
              disabled={pending}
              className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink disabled:opacity-60"
            >
              Resolve the hold
            </button>
          ) : (
            <button
              type="submit"
              name="intent"
              value="hold"
              data-testid="draft-hold-submit"
              disabled={pending}
              className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink disabled:opacity-60"
            >
              Hold this draft
            </button>
          )}

          <button
            type="submit"
            name="intent"
            value="remove"
            data-testid="draft-remove"
            disabled={pending}
            className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink disabled:opacity-60"
          >
            Remove this draft
          </button>
        </div>
      </form>
    </li>
  );
}

export function AddDraftForm({
  askId,
  transportEnabled,
}: {
  askId: string;
  transportEnabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    addDraftAction,
    IDLE_DRAFT_ACTION,
  );

  return (
    <form
      action={formAction}
      data-testid="draft-add"
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5"
    >
      <input type="hidden" name="askId" value={askId} />
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`${askId}-add-kind`}
          className="text-base font-semibold text-ink"
        >
          Add a draft yourself
        </label>
        <select
          id={`${askId}-add-kind`}
          name="kind"
          data-testid="draft-add-kind"
          defaultValue="meal"
          className="min-h-11 rounded-md border border-line bg-paper px-3 py-2 text-base text-ink"
        >
          {KIND_OPTIONS.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.value === "drive" && !transportEnabled}
            >
              {option.label}
            </option>
          ))}
        </select>
        <p
          data-testid="draft-add-note"
          className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          {transportEnabled
            ? "Anything you add is a draft. It stays invisible until you publish it."
            : "A drive can only be added after the church signs its volunteer-driver policy. Anything you add is a draft and stays invisible until you publish it."}
        </p>
      </div>
      <Feedback state={state} testId="draft-add-feedback" />
      <button
        type="submit"
        data-testid="draft-add-submit"
        disabled={pending}
        className="inline-flex min-h-11 w-fit items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add this draft"}
      </button>
    </form>
  );
}

export function ProposeTimesForm({ askId }: { askId: string }) {
  const [state, formAction, pending] = useActionState(
    proposeDraftsAction,
    IDLE_DRAFT_ACTION,
  );

  return (
    <form
      action={formAction}
      data-testid="draft-propose"
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5"
    >
      <input type="hidden" name="askId" value={askId} />
      <p className="max-w-prose text-base leading-relaxed text-ink">
        The rules can read the nine answers and propose draft times. They run
        once per ask; they never overwrite a draft you have edited.
      </p>
      <Feedback state={state} testId="draft-propose-feedback" />
      <button
        type="submit"
        data-testid="draft-propose-submit"
        disabled={pending}
        className="inline-flex min-h-11 w-fit items-center rounded-md bg-accent px-5 py-2 text-base font-semibold text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Reading the nine answers…" : "Propose times from the nine answers"}
      </button>
    </form>
  );
}

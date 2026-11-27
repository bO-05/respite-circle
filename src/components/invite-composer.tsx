"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  IDLE_INVITE_ACTION,
  INVITE_MAX_LENGTH,
  renderInviteTemplate,
  type InviteActionState,
  type InviteFamilyOption,
} from "@/server/domain/invites";
import { sendInviteAction } from "@/app/desk/invite/actions";

/**
 * The invitation composer.
 *
 * The message box starts from the church's own sentence for the selected
 * family, and a coordinator may change every word. The template moves with the
 * family only while the words are still untouched; once a person has edited
 * them, their sentence stays. Nothing is emailed or texted: the server action
 * writes one in-app row with the author and the instant it was sent.
 */

function familyLabel(family: InviteFamilyOption): string {
  return `${family.caregiverFirstName} ${family.caregiverLastName} — for ${family.careRecipientFirstName}`;
}

function templateFor(
  family: InviteFamilyOption | undefined,
  coordinatorFirstName: string,
): string {
  if (!family) return "";
  return (
    renderInviteTemplate({
      recipientFirstName: family.careRecipientFirstName,
      coordinatorFirstName,
    }) ?? ""
  );
}

function Feedback({ state }: { state: InviteActionState }) {
  if (state.status === "idle") return null;
  const isError = state.status === "error";

  return (
    <p
      data-testid="invite-feedback"
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

export function InviteComposer({
  families,
  coordinatorFirstName,
}: {
  families: readonly InviteFamilyOption[];
  coordinatorFirstName: string;
}) {
  const [state, formAction, pending] = useActionState(
    sendInviteAction,
    IDLE_INVITE_ACTION,
  );

  const firstFamily = families[0];
  const firstTemplate = templateFor(firstFamily, coordinatorFirstName);

  const [selectedId, setSelectedId] = useState(firstFamily?.caregiverId ?? "");
  const [body, setBody] = useState(firstTemplate);
  const [bodyEdited, setBodyEdited] = useState(false);
  const lastTemplate = useRef(firstTemplate);

  // React 19 resets a form's DOM after a successful action. A controlled
  // select can then display its first option while React's state still holds
  // the family the coordinator chose. Remounting the two controlled fields
  // after each completed send makes the DOM agree with the state again, so the
  // next sentence a person sees is not silently for a different family.
  const [formGeneration, setFormGeneration] = useState(0);
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && state.status === "success") {
      setFormGeneration((value) => value + 1);
    }
    wasPending.current = pending;
  }, [pending, state.status]);

  const selectId = useId();
  const selectHelpId = useId();
  const bodyId = useId();
  const bodyHelpId = useId();
  const countId = useId();

  const selectedFamily =
    families.find((family) => family.caregiverId === selectedId) ?? firstFamily;
  const selectedName = selectedFamily?.caregiverFirstName ?? "the family";

  function chooseFamily(nextId: string): void {
    const family = families.find((item) => item.caregiverId === nextId);
    setSelectedId(nextId);
    if (!family) return;

    const nextTemplate = templateFor(family, coordinatorFirstName);
    // A person's own words are never overwritten by a family change. An
    // untouched template moves to the family the coordinator just chose.
    if (!bodyEdited || body === lastTemplate.current) {
      setBody(nextTemplate);
      setBodyEdited(false);
    }
    lastTemplate.current = nextTemplate;
  }

  return (
    <form
      action={formAction}
      data-testid="invite-composer"
      className="flex flex-col gap-6 rounded-lg border border-line bg-surface p-5"
    >
      <div className="flex flex-col gap-2">
        <label
          htmlFor={selectId}
          className="text-lg font-semibold leading-snug text-ink"
        >
          Who is this invitation for?
        </label>
        <p
          id={selectHelpId}
          className="max-w-prose text-base leading-relaxed text-ink-muted"
        >
          Only families in your own church are listed. The invitation is
          addressed to one person, never to a group.
        </p>
        <select
          key={`invite-family-${formGeneration}`}
          id={selectId}
          name="caregiverId"
          value={selectedId}
          onChange={(event) => chooseFamily(event.target.value)}
          aria-describedby={selectHelpId}
          className="min-h-11 w-full max-w-xl rounded-md border border-boundary bg-paper px-3 py-2 text-lg text-ink"
          required
        >
          {families.map((family) => (
            <option key={family.caregiverId} value={family.caregiverId}>
              {familyLabel(family)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor={bodyId}
          className="text-lg font-semibold leading-snug text-ink"
        >
          The message {selectedName} will read
        </label>
        <p
          id={bodyHelpId}
          className="max-w-prose text-base leading-relaxed text-ink-muted"
        >
          This is the church&apos;s own sentence. Change any words you like — it
          is sent exactly as you write it here.
        </p>
        <textarea
          key={`invite-body-${formGeneration}`}
          id={bodyId}
          name="body"
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setBodyEdited(event.target.value !== lastTemplate.current);
          }}
          aria-describedby={`${bodyHelpId} ${countId}`}
          rows={7}
          className="w-full max-w-prose rounded-md border border-boundary bg-paper px-4 py-3 text-lg leading-relaxed text-ink"
          required
        />
        <p
          id={countId}
          className="max-w-prose text-base leading-relaxed text-ink-muted"
        >
          {body.length} of {INVITE_MAX_LENGTH.toLocaleString("en-US")}{" "}
          characters. One or two sentences is plenty.
        </p>
        {bodyEdited ? (
          <p className="max-w-prose text-base leading-relaxed text-ink-muted">
            You have changed the church&apos;s sentence. It is kept as your own
            words, with your name and today&apos;s date.
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        data-testid="invite-send"
        disabled={pending || !selectedFamily}
        className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Saving the invitation…" : "Send the invitation"}
      </button>

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        Nothing is emailed or texted, and nothing is posted to the board.{" "}
        {selectedName} sees this the first time they open their link, and it is
        kept here with your name and today&apos;s date.
      </p>

      <Feedback state={state} />
    </form>
  );
}

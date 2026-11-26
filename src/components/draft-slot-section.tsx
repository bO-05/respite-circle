import Link from "next/link";
import {
  AddDraftForm,
  DraftSlotCard,
  ProposeTimesForm,
  type DraftSlotCardView,
} from "@/components/draft-slot-editor";
import {
  constructionBlockedForStatus,
  formatWindowLabel,
  ruleReferenceText,
  skippedMessage,
  toDateTimeLocalValue,
} from "@/server/domain/slots";
import { AUTO_PUBLISH_DESK_NOTE } from "@/server/domain/auto-publish";
import type { DraftEditorContext } from "@/server/repositories/draft-slots";

/**
 * The draft slot editor on `/desk/ask/[id]`.
 *
 * This is a read-only server wrapper; the forms are client components because
 * they use `useActionState` to announce their result. The section renders only
 * what the scoped repository returned: drafts for this ask, in this church.
 *
 * Nothing here is published. A held draft names its reason and offers Resolve;
 * the publication guard (`canPublishDraft`) refuses a held draft, and the next
 * feature's publish action must call it.
 */
export function DraftSlotSection({
  context,
  timeZone,
}: {
  context: DraftEditorContext;
  timeZone: string;
}) {
  const blocked = constructionBlockedForStatus(context.askStatus);
  const waiting = context.askStatus === "waiting_coordinator";

  const cards: DraftSlotCardView[] = context.slots.map((slot) => ({
    id: slot.id,
    kind: slot.kind,
    tier: slot.tier,
    label: slot.label,
    windowStartLocal: toDateTimeLocalValue(slot.windowStart, timeZone),
    windowEndLocal: toDateTimeLocalValue(slot.windowEnd, timeZone),
    windowLabel: formatWindowLabel(
      slot.windowStart,
      slot.windowEnd,
      timeZone,
    ),
    gated: slot.gated,
    orientationNote: slot.orientationNote ?? "",
    ruleRef: slot.ruleRef,
    ruleText: ruleReferenceText(slot.ruleRef),
    holdReason: slot.holdReason,
    heldAtLabel: slot.heldAt
      ? formatWindowLabel(slot.heldAt, null, timeZone)
      : null,
    sessionMissing: slot.kind === "companion" && slot.sessionId === null,
  }));

  const heldCount = cards.filter((card) => card.holdReason).length;
  const skipped = context.skipped.map((entry) => ({
    ...entry,
    message: entry.message || skippedMessage(entry.reason),
  }));
  const constructedWithoutContent =
    context.slotsConstructedAt !== null &&
    cards.length === 0 &&
    context.proposedCount === 0 &&
    skipped.length === 0;

  return (
    <section
      data-testid="draft-editor"
      aria-labelledby="draft-editor-heading"
      className="flex flex-col gap-5"
    >
      <div>
        <h2 id="draft-editor-heading" className="font-serif text-2xl text-ink">
          Times plain code proposes
        </h2>
        <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
          Plain code — not the model — builds every draft here from the nine
          answers. The model never writes a proposal, a label, or a note.
        </p>
        <p
          data-testid="draft-not-published"
          className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          Every draft here waits for a person. Volunteers, caregivers, and the
          congregation board cannot see any of them until a coordinator
          publishes the ask. A low-risk time the switch published by itself is
          listed under the publish decision below.
        </p>
        {context.autoPublishLowRisk ? (
          <p
            data-testid="draft-auto-publish"
            className="mt-2 max-w-prose rounded-md border border-amber bg-amber-soft px-4 py-3 text-base leading-relaxed text-ink"
          >
            {AUTO_PUBLISH_DESK_NOTE}
          </p>
        ) : null}
      </div>

      {blocked ? (
        <div
          data-testid="draft-construction-refused"
          className="rounded-lg border border-amber bg-amber-soft p-5 text-lg leading-relaxed text-ink"
        >
          <p className="font-semibold">No times are proposed for this ask.</p>
          <p className="mt-2">{blocked.message}</p>
          <p className="mt-2">
            There is no add-a-time control on a held ask. Personal care is never
            a volunteer slot, and a safety flag gets a phone call today.
          </p>
        </div>
      ) : null}

      {!blocked && !waiting ? (
        <div className="rounded-lg border border-line bg-surface p-5 text-base leading-relaxed text-ink">
          This ask is no longer waiting for a coordinator, so its drafts are
          read-only here. Its published times are managed from the desk.
        </div>
      ) : null}

      {waiting ? (
        <>
          {skipped.length > 0 ? (
            <div
              data-testid="draft-skipped"
              className="rounded-lg border border-line bg-surface p-5"
            >
              <h3 className="font-serif text-xl text-ink">
                Asked for, but not proposed
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {skipped.map((entry) => (
                  <li
                    key={`${entry.kind}-${entry.reason}`}
                    data-testid="draft-skipped-item"
                    data-kind={entry.kind}
                    data-reason={entry.reason}
                    className="max-w-prose text-base leading-relaxed text-ink"
                  >
                    {entry.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {cards.length > 0 ? (
            <ul
              data-testid="draft-list"
              className="flex flex-col gap-4"
              aria-label="Draft times for this ask"
            >
              {cards.map((card) => (
                <DraftSlotCard
                  key={card.id}
                  slot={card}
                  transportEnabled={context.transportEnabled}
                />
              ))}
            </ul>
          ) : null}

          {cards.length === 0 && constructedWithoutContent ? (
            <div
              data-testid="draft-empty"
              className="rounded-lg border border-line bg-surface p-5"
            >
              <h3 className="font-serif text-xl text-ink">
                No practical need was named
              </h3>
              <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
                The nine answers did not name a sitting need, a ride, or a meal.
                You can still add a time yourself if you know one that would
                help this family.
              </p>
            </div>
          ) : null}

          {context.slotsConstructedAt === null ? (
            <div
              data-testid="draft-none-yet"
              className="rounded-lg border border-line bg-surface p-5"
            >
              <h3 className="font-serif text-xl text-ink">
                Plain code has not proposed times yet
              </h3>
              <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
                {context.hasDecisions
                  ? "The nine answers are recorded. You can let plain code propose times, or add one yourself."
                  : "The nine answers are not recorded yet, so plain code has nothing to read. A person can still add a time."}
              </p>
            </div>
          ) : null}

          {context.slotsConstructedAt === null && context.hasDecisions ? (
            <ProposeTimesForm askId={context.askId} />
          ) : null}

          <AddDraftForm
            askId={context.askId}
            transportEnabled={context.transportEnabled}
          />

          {heldCount > 0 ? (
            <p className="max-w-prose text-base leading-relaxed text-ink">
              {heldCount === 1
                ? "One draft is held. Held drafts cannot be published until their hold is resolved."
                : `${heldCount} drafts are held. Held drafts cannot be published until their hold is resolved.`}
            </p>
          ) : null}

          <p className="max-w-prose text-base leading-relaxed text-ink-muted">
            A held draft keeps its reason with it, and every change to these
            drafts is written to the audit log. Publishing, and the
            consent-and-gating check for each time, comes next in the desk
            review.
          </p>
        </>
      ) : null}

      <Link
        href="/desk"
        className="inline-flex min-h-11 w-fit items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink"
      >
        Back to the desk
      </Link>
    </section>
  );
}

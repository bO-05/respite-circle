import Link from "next/link";
import {
  ApproveAskForm,
  PublishHeldDraftForm,
  SendBackForm,
} from "@/components/ask-review-forms";
import { formatApprovalLine } from "@/server/domain/ask-review";
import { formatWindowLabel } from "@/server/domain/slots";
import type { DraftSlotRow } from "@/server/repositories/draft-slots";
import type { AskPublication, AskStatus } from "@/server/repositories/ask-review";

/**
 * The coordinator's publish / send-back section on `/desk/ask/[id]`.
 *
 * A waiting ask shows both decisions: approve (which publishes exactly the
 * drafts that are not held) and send back (which publishes nothing and requires
 * a human note). An approved ask shows the visible approval line, every
 * published time with its own approval line, and any held draft with the single
 * action that can resolve its hold and publish it. A sent-back ask shows the
 * note the family is reading, exactly as it was written.
 *
 * Nothing here is a score, a ranking, or an automatic decision.
 */
export function AskReviewSection({
  askId,
  status,
  publication,
  drafts,
}: {
  askId: string;
  status: AskStatus;
  publication: AskPublication;
  drafts: DraftSlotRow[];
}) {
  const timeZone = publication.timeZone;
  const publishable = drafts.filter((draft) => !draft.holdReason);
  const held = drafts.filter((draft) => Boolean(draft.holdReason));
  const approvalLine = formatApprovalLine({
    approverFirstName: publication.approvedByName,
    approvedAt: publication.approvedAt,
    timeZone,
  });

  if (status === "waiting_coordinator") {
    return (
      <section
        data-testid="ask-review"
        data-status={status}
        aria-labelledby="ask-review-heading"
        className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5"
      >
        <div>
          <h2 id="ask-review-heading" className="font-serif text-2xl text-ink">
            Publish or send this back
          </h2>
          <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
            Approving publishes every draft that is not held as an open time on
            the congregation board. Your name and the time appear on each one,
            so a neighbour can see that a person approved it.
          </p>
          <p
            data-testid="approval-counts"
            className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
          >
            Ready to publish: {publishable.length}. Held: {held.length}.
            {held.length > 0
              ? " A held time stays unpublished, with its reason, until the hold is resolved."
              : ""}
          </p>
        </div>

        <ApproveAskForm
          askId={askId}
          publishableCount={publishable.length}
          heldCount={held.length}
        />

        <div className="border-t border-line pt-5">
          <h3 className="font-serif text-xl text-ink">
            If this is not the right answer
          </h3>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
            Send the ask back with a note. Nothing is published, every draft
            stays private, and the family reads your words exactly as you wrote
            them.
          </p>
          <div className="mt-3">
            <SendBackForm askId={askId} />
          </div>
        </div>
      </section>
    );
  }

  if (status === "approved") {
    return (
      <section
        data-testid="ask-review"
        data-status={status}
        aria-labelledby="ask-review-heading"
        className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5"
      >
        <div>
          <h2 id="ask-review-heading" className="font-serif text-2xl text-ink">
            Published to the congregation
          </h2>
          {approvalLine ? (
            <p
              data-testid="ask-approval-line"
              className="mt-2 w-fit rounded-full border border-green bg-green-soft px-4 py-2 text-base font-semibold text-ink"
            >
              {approvalLine}
            </p>
          ) : null}
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
            The board shows the time, what it needs, and this approval line.
            It never shows the family&apos;s words.
          </p>
        </div>

        {publication.published.length === 0 ? (
          <p
            data-testid="nothing-published"
            className="max-w-prose text-base leading-relaxed text-ink"
          >
            Approved, but no draft time was ready to publish. A held time can
            be published below once its hold is resolved.
          </p>
        ) : (
          <ul
            data-testid="published-list"
            className="flex flex-col gap-3"
            aria-label="Published times"
          >
            {publication.published.map((published) => {
              const line = formatApprovalLine({
                approverFirstName: published.approvedByName,
                approvedAt: published.approvedAt,
                timeZone,
              });
              return (
                <li
                  key={published.id}
                  data-testid="published-slot"
                  data-slot-id={published.id}
                  data-kind={published.kind}
                  data-status={published.status}
                  className="rounded-md border border-line bg-paper p-4"
                >
                  <h3 className="font-serif text-xl text-ink">
                    {published.label}
                  </h3>
                  <p className="mt-1 text-base text-ink-muted">
                    {formatWindowLabel(
                      published.windowStart,
                      published.windowEnd,
                      timeZone,
                    )}
                  </p>
                  {line ? (
                    <p
                      data-testid="published-approval-line"
                      className="mt-2 text-base font-semibold text-ink"
                    >
                      {line}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {held.length > 0 ? (
          <div
            data-testid="held-drafts"
            className="rounded-md border border-amber bg-amber-soft p-4"
          >
            <h3 className="font-serif text-xl text-ink">
              Held times, not published
            </h3>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
              These stay unpublished, with their reasons. Publishing one takes a
              deliberate second look.
            </p>
            <ul className="mt-3 flex flex-col gap-4">
              {held.map((draft) => (
                <li
                  key={draft.id}
                  data-testid="held-draft"
                  data-slot-id={draft.id}
                  className="rounded-md border border-line bg-surface p-4"
                >
                  <p className="text-lg font-semibold text-ink">
                    {draft.label}
                  </p>
                  <p className="mt-1 text-base text-ink-muted">
                    {formatWindowLabel(
                      draft.windowStart,
                      draft.windowEnd,
                      timeZone,
                    )}
                  </p>
                  <p
                    data-testid="held-draft-reason"
                    className="mt-2 max-w-prose text-base leading-relaxed text-ink"
                  >
                    Held: {draft.holdReason}
                  </p>
                  <PublishHeldDraftForm slotId={draft.id} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Link
          href="/circle"
          className="inline-flex min-h-11 w-fit items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          See the board
        </Link>
      </section>
    );
  }

  if (status === "sent_back") {
    const note = publication.sendBackNote;
    const sender = publication.sentBackByName ?? "A coordinator";
    return (
      <section
        data-testid="ask-review"
        data-status={status}
        aria-labelledby="ask-review-heading"
        className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
      >
        <div>
          <h2 id="ask-review-heading" className="font-serif text-2xl text-ink">
            Sent back to the family
          </h2>
          <p
            data-testid="send-back-meta"
            className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
          >
            {sender} sent this back
            {publication.sentBackAt
              ? ` on ${formatWindowLabel(
                  publication.sentBackAt,
                  null,
                  timeZone,
                )}`
              : ""}
            . Nothing was published, and every draft stayed private.
          </p>
        </div>

        {note ? (
          <blockquote
            data-testid="send-back-copy"
            className="max-w-prose whitespace-pre-wrap break-words rounded-md border border-line bg-accent-soft px-5 py-4 text-lg leading-relaxed text-ink"
          >
            {note}
          </blockquote>
        ) : (
          <p className="max-w-prose text-base leading-relaxed text-ink">
            No note was recorded with this send-back.
          </p>
        )}
      </section>
    );
  }

  // Safety holds, personal-care holds, closed, withdrawn, and unsubmitted asks
  // have no publish or send-back decision on this page.
  return null;
}

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ApproveClaimForm,
  RevokeClaimForm,
} from "@/components/claim-review-forms";
import { formatClaimConfirmationLine } from "@/server/domain/claim-review";
import { formatWindowLabel } from "@/server/domain/slots";
import type { DeskSlotClaimReview } from "@/server/repositories/claim-review";

/**
 * The desk's claim decision for one time.
 *
 * A claim is the only state with actions. Once confirmed, the family's one
 * message is shown back to the coordinator exactly as it was stored, and no
 * second decision is offered. A claim taken back leaves the time open and the
 * family untouched. Every branch is a server read; the buttons are forms that
 * the server re-authorizes.
 */
export function ClaimReviewSection({
  review,
}: {
  review: DeskSlotClaimReview;
}) {
  const timeZone = review.timeZone;
  const volunteer = review.volunteerFirstName ?? "A neighbour";
  const confirmedLine = formatClaimConfirmationLine({
    confirmerFirstName: review.claimConfirmedByName,
    confirmedAt: review.claimConfirmedAt,
    timeZone,
  });
  const claimedLine = review.claimedAt
    ? formatWindowLabel(review.claimedAt, null, timeZone)
    : null;

  let content: ReactNode;

  if (review.status === "claimed") {
    content = (
      <>
        <div>
          <h2 id="claim-review-heading" className="font-serif text-2xl text-ink">
            One neighbour has said yes
          </h2>
          <p
            data-testid="claim-volunteer-name"
            className="mt-2 max-w-prose text-lg leading-relaxed text-ink"
          >
            <span className="font-semibold">{volunteer}</span> said yes to this
            time.
          </p>
          {claimedLine ? (
            <p
              data-testid="claim-claimed-at"
              className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted"
            >
              Said yes {claimedLine}.
            </p>
          ) : null}
        </div>

        <p className="max-w-prose text-base leading-relaxed text-ink">
          Nothing has been sent to the family yet. Confirming sends exactly one
          message, from the church&apos;s own template, with {volunteer}
          &apos;s first name and the time. No model writes any part of it.
        </p>

        <ApproveClaimForm slotId={review.slotId} />

        <div className="border-t border-line pt-5">
          <h3 className="font-serif text-xl text-ink">
            If this person cannot come
          </h3>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
            Taking the claim back returns the time to the board for someone
            else. The family is not told, and no message is sent.
          </p>
          <div className="mt-3">
            <RevokeClaimForm slotId={review.slotId} />
          </div>
        </div>
      </>
    );
  } else if (review.status === "covered") {
    content = (
      <>
        <div>
          <h2 id="claim-review-heading" className="font-serif text-2xl text-ink">
            Confirmed with the family
          </h2>
          {confirmedLine ? (
            <p
              data-testid="claim-confirmed-line"
              className="mt-2 w-fit rounded-full border border-green bg-green-soft px-4 py-2 text-base font-semibold text-ink"
            >
              {confirmedLine}
            </p>
          ) : null}
        </div>

        {review.confirmation ? (
          <>
            <p className="max-w-prose text-base leading-relaxed text-ink">
              This is the one message the family received. It stays exactly as
              it was stored.
            </p>
            <blockquote
              data-testid="confirmation-body"
              className="max-w-prose whitespace-pre-wrap break-words rounded-md border border-line bg-accent-soft px-5 py-4 text-lg leading-relaxed text-ink"
            >
              {review.confirmation.body}
            </blockquote>
            <p className="max-w-prose text-base leading-relaxed text-ink-muted">
              {volunteer} can now read the orientation note on their own claim.
              A confirmed time is not taken back from this screen.
            </p>
          </>
        ) : (
          <p
            data-testid="confirmation-missing"
            className="max-w-prose text-base font-semibold leading-relaxed text-ink"
          >
            No confirmation message is on record for this time. Speak with the
            family directly before you rely on a message.
          </p>
        )}
      </>
    );
  } else if (review.status === "open") {
    content = (
      <>
        <h2 id="claim-review-heading" className="font-serif text-2xl text-ink">
          No one has said yes yet
        </h2>
        <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
          When a neighbour claims this time, it appears here for you to confirm.
          Nothing is sent to the family before that.
        </p>
        <p
          data-testid="claim-review-empty"
          className="max-w-prose text-base leading-relaxed text-ink-muted"
        >
          If it stays unclaimed, call the family yourself. Nothing is sent to
          them automatically.
        </p>
      </>
    );
  } else if (review.status === "draft") {
    content = (
      <>
        <h2 id="claim-review-heading" className="font-serif text-2xl text-ink">
          This time is not published yet
        </h2>
        <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
          A draft is not on the board, so no neighbour can claim it. Publish it
          from the ask review when it is ready.
        </p>
        <Link
          href={`/desk/ask/${review.askId}`}
          className="inline-flex min-h-11 w-fit items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          Open the ask review
        </Link>
      </>
    );
  } else if (review.status === "done") {
    content = (
      <>
        <h2 id="claim-review-heading" className="font-serif text-2xl text-ink">
          This time is done
        </h2>
        <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
          The visit is finished and the volunteer closed it. The family&apos;s
          confirmation stays on their own page.
        </p>
        {confirmedLine ? (
          <p
            data-testid="claim-confirmed-line"
            className="w-fit rounded-full border border-green bg-green-soft px-4 py-2 text-base font-semibold text-ink"
          >
            {confirmedLine}
          </p>
        ) : null}
        {review.confirmation ? (
          <blockquote
            data-testid="confirmation-body"
            className="max-w-prose whitespace-pre-wrap break-words rounded-md border border-line bg-paper px-5 py-4 text-lg leading-relaxed text-ink"
          >
            {review.confirmation.body}
          </blockquote>
        ) : null}
      </>
    );
  } else {
    content = (
      <>
        <h2 id="claim-review-heading" className="font-serif text-2xl text-ink">
          This time is closed
        </h2>
        <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
          {review.status === "cancelled"
            ? "The church cancelled this time. Nothing is sent to the family from this screen."
            : "This time closed without a claim. The coordinator calls the family; the app sends nothing."}
        </p>
      </>
    );
  }

  return (
    <section
      data-testid="claim-review"
      data-status={review.status}
      data-slot-id={review.slotId}
      aria-labelledby="claim-review-heading"
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
    >
      {content}
    </section>
  );
}

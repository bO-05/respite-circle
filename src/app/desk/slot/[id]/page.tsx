import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimReviewSection } from "@/components/claim-review-section";
import { CoverageSection } from "@/components/coverage-card";
import { ReminderSection } from "@/components/reminder-section";
import { RolePage } from "@/components/role-page";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { formatApprovalLine } from "@/server/domain/ask-review";
import { formatWindowLabel } from "@/server/domain/slots";
import { getDeskSlotClaimReview } from "@/server/repositories/claim-review";
import { getDeskSlotCoverage } from "@/server/repositories/coverage";
import { getDeskSlotReminder } from "@/server/repositories/reminders";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  companion: "Companion place",
  home: "In-home visit",
  drive: "Drive",
  meal: "Meal",
  errand: "Errand",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft — not published",
  open: "Open on the board",
  claimed: "Claimed — waiting for you",
  covered: "Covered — confirmed with the family",
  done: "Done",
  cancelled: "Cancelled",
  expired_unclaimed: "Closed unclaimed",
};

/**
 * One time as the desk reviews it.
 *
 * Two different human decisions live here and stay visibly separate:
 * publication approval (`approved_by/at`) put the time on the board, and claim
 * confirmation (`claim_confirmed_by/at`) covers the neighbour who said yes.
 * Confirming a claim never overwrites the publication trail, because the board
 * and every approval line depend on it.
 *
 * The family's verbatim words and the orientation note are not part of this
 * read. Only the claim, the publication record, and the one confirmation
 * message the family was sent appear here.
 */
export default async function DeskSlotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { person, session } = await requirePage(DESK_ROLES);
  const { id } = await params;
  const [review, reminder, coverage] = await Promise.all([
    getDeskSlotClaimReview(session, id),
    getDeskSlotReminder(session, id),
    getDeskSlotCoverage(session, id),
  ]);

  if (!review) {
    notFound();
  }

  const showCoverage =
    coverage !== null &&
    (coverage.status === "open" ||
      coverage.status === "expired_unclaimed" ||
      coverage.calls.length > 0);

  const timeZone = review.timeZone;
  const publicationLine = formatApprovalLine({
    approverFirstName: review.publishedByName,
    approvedAt: review.approvedAt,
    timeZone,
  });

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Time review"
      lead="A neighbour has said yes. Confirm the claim, or take it back before the family hears anything."
    >
      <dl className="grid gap-4 rounded-lg border border-line bg-surface p-5 sm:grid-cols-2">
        <div>
          <dt className="text-base font-semibold text-ink">Kind</dt>
          <dd className="mt-1 text-base text-ink-muted">
            {KIND_LABEL[review.kind] ?? review.kind}
          </dd>
        </div>
        <div>
          <dt className="text-base font-semibold text-ink">Status</dt>
          <dd
            data-testid="slot-status"
            data-status={review.status}
            className="mt-1 text-base text-ink-muted"
          >
            {STATUS_LABEL[review.status] ?? review.status}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-base font-semibold text-ink">Label</dt>
          <dd className="mt-1 text-base text-ink-muted">{review.label}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-base font-semibold text-ink">Window</dt>
          <dd
            data-testid="slot-window"
            className="mt-1 text-base text-ink-muted"
          >
            {formatWindowLabel(
              review.windowStart,
              review.windowEnd,
              timeZone,
            )}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-base font-semibold text-ink">For</dt>
          <dd className="mt-1 text-base text-ink-muted">
            {review.caregiverFirstName}, for {review.careRecipientFirstName}
          </dd>
        </div>
        {review.gated ? (
          <div className="sm:col-span-2">
            <dt className="text-base font-semibold text-ink">Gate</dt>
            <dd className="mt-1 text-base text-ink-muted">
              This slot needs the in-home or transport checks before a neighbour
              can take it.
            </dd>
          </div>
        ) : null}
      </dl>

      <section
        aria-labelledby="publication-heading"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="publication-heading" className="font-serif text-2xl text-ink">
          Published by a person
        </h2>
        <p
          data-testid="slot-publication-line"
          className="mt-2 max-w-prose text-base leading-relaxed text-ink"
        >
          {publicationLine ?? "This time is not published to the board yet."}
        </p>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          Publication and claim confirmation are two separate decisions. This
          page keeps both, so the board&apos;s approval line can never be
          replaced by a later confirmation.
        </p>
      </section>

      <ClaimReviewSection review={review} />

      {showCoverage && coverage ? (
        <CoverageSection coverage={coverage} />
      ) : null}

      {reminder ? <ReminderSection reminder={reminder} /> : null}

      <div className="flex flex-wrap gap-4">
        <Link
          href={`/desk/ask/${review.askId}`}
          className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          Back to the ask
        </Link>
        <Link
          href="/desk"
          className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          Back to the desk
        </Link>
      </div>
    </RolePage>
  );
}

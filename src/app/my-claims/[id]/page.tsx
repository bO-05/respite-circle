import Link from "next/link";
import { notFound } from "next/navigation";
import {
  MyClaimDonePanel,
  MyClaimVisitPanel,
} from "@/components/my-claim-actions";
import { MY_CLAIM_TONE_CLASS } from "@/components/my-claim-card";
import { ClaimFlash } from "@/components/my-claim-flash";
import { RolePage } from "@/components/role-page";
import { CLAIMS_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import {
  boardClaimHint,
  boardGatedLine,
  boardKindCopy,
  coordinatorDisplayName,
} from "@/server/domain/board";
import {
  doneFlashMessage,
  doneFlashTone,
  isDoneFlashCode,
  isVisitFlashCode,
  myClaimExpectationCopy,
  myClaimNoteMissingCopy,
  myClaimNotePendingCopy,
  myClaimStatusCopy,
  visitFlashMessage,
  visitFlashTone,
} from "@/server/domain/my-claims";
import { formatWindowLabel } from "@/server/domain/slots";
import { getMyClaim } from "@/server/repositories/my-claims";

export const dynamic = "force-dynamic";

/**
 * One volunteer's claim, in full.
 *
 * The page carries the time, the place, what the visit needs, and — only after
 * the coordinator has confirmed the claim — the family's orientation note. The
 * repository withholds the note before that on every read, so the pre-approval
 * page cannot leak it through a hidden field or the RSC payload.
 *
 * Check-in and check-out are offered for a confirmed home visit; marking the
 * time done is offered once its window has passed. Both actions post to route
 * handlers that re-derive the session and re-apply the same predicates.
 *
 * The caregiver's verbatim words are not part of this page or its data. The
 * volunteer sees a time, the shape of the help, and the note the coordinator
 * wrote for them.
 */
export default async function MyClaimDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { person, session } = await requirePage(CLAIMS_ROLES);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const claim = await getMyClaim(session, id);

  if (!claim) {
    notFound();
  }

  const visitParam = typeof query.visit === "string" ? query.visit : null;
  const visitCode = isVisitFlashCode(visitParam) ? visitParam : null;
  const doneParam = typeof query.done === "string" ? query.done : null;
  const doneCode = isDoneFlashCode(doneParam) ? doneParam : null;

  const flash = visitCode
    ? {
        message: visitFlashMessage(visitCode, claim.coordinatorFirstName),
        tone: visitFlashTone(visitCode),
      }
    : doneCode
      ? {
          message: doneFlashMessage(doneCode, claim.coordinatorFirstName),
          tone: doneFlashTone(doneCode),
        }
      : null;

  const now = new Date();
  const kind = boardKindCopy(claim.kind);
  const gatedLine = boardGatedLine(claim.kind);
  const status = myClaimStatusCopy(claim.status, claim.coordinatorFirstName);
  const name = coordinatorDisplayName(claim.coordinatorFirstName);

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Your claim"
      lead="The time you said yes to, and what to expect."
    >
      <div>
        <Link
          href="/my-claims"
          className="inline-flex min-h-11 items-center text-base font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          Back to your claims
        </Link>
      </div>

      {flash ? <ClaimFlash message={flash.message} tone={flash.tone} /> : null}

      <section
        data-testid="claim-detail"
        data-slot-id={claim.id}
        data-kind={claim.kind}
        data-status={claim.status}
        aria-labelledby="claim-heading"
        className="rounded-md border-t border-line bg-surface p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p
            data-testid="claim-kind"
            className="inline-flex min-h-7 items-center rounded-full border border-line bg-paper px-3 text-base font-semibold text-ink"
          >
            {kind.word}
          </p>
          <p
            data-testid="claim-status"
            className={`inline-flex min-h-7 items-center rounded-full border px-3 text-base font-semibold text-ink ${
              MY_CLAIM_TONE_CLASS[status.tone]
            }`}
          >
            {status.label}
          </p>
        </div>

        <h2
          id="claim-heading"
          className="mt-3 font-serif text-3xl leading-tight text-ink"
        >
          {claim.label}
        </h2>

        <div className="mt-3 flex flex-col gap-1">
          <p
            data-testid="claim-window"
            className="max-w-prose text-xl leading-relaxed tabular-nums text-ink"
          >
            {formatWindowLabel(
              claim.windowStart,
              claim.windowEnd,
              claim.timeZone,
            )}
          </p>
          <p
            data-testid="claim-location"
            className="max-w-prose text-base leading-relaxed text-ink"
          >
            {kind.location}
          </p>
        </div>

        {claim.status === "claimed" ? (
          <p
            data-testid="claim-waiting"
            className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted"
          >
            {boardClaimHint(claim.coordinatorFirstName)}
          </p>
        ) : null}

        {claim.status === "cancelled" ? (
          <p
            data-testid="claim-cancelled"
            className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted"
          >
            The church cancelled this time. A coordinator will be in touch
            about it.
          </p>
        ) : null}

        {claim.status === "done" ? (
          <p
            data-testid="claim-done-thanks"
            className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted"
          >
            Thank you for saying yes. This time is closed.
          </p>
        ) : null}
      </section>

      <section
        data-testid="claim-expect"
        aria-labelledby="expect-heading"
        className="rounded-md border-t border-line bg-surface p-5"
      >
        <h2 id="expect-heading" className="font-serif text-2xl text-ink">
          What to expect
        </h2>
        <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
          {myClaimExpectationCopy(claim.kind)}
        </p>
        {gatedLine ? (
          <p
            data-testid="claim-gated"
            className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted"
          >
            {gatedLine}
          </p>
        ) : null}
      </section>

      <section
        data-testid="claim-note-section"
        aria-labelledby="note-heading"
        className="rounded-md border-t border-line bg-surface p-5"
      >
        <h2 id="note-heading" className="font-serif text-2xl text-ink">
          The family&apos;s orientation note
        </h2>

        {claim.noteVisible ? (
          claim.orientationNote ? (
            <>
              <blockquote
                data-testid="claim-note"
                className="mt-3 max-w-prose whitespace-pre-wrap break-words border-l-4 border-accent bg-paper p-4 text-lg leading-relaxed text-ink"
              >
                {claim.orientationNote}
              </blockquote>
              <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
                Written by your coordinator and kept with this time. Only the
                person who said yes to it reads it here.
              </p>
            </>
          ) : (
            <p
              data-testid="claim-note-missing"
              className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
            >
              {myClaimNoteMissingCopy(claim.coordinatorFirstName)}
            </p>
          )
        ) : (
          <p
            data-testid="claim-note-pending"
            className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
          >
            {myClaimNotePendingCopy(claim.coordinatorFirstName)}
          </p>
        )}
      </section>

      <MyClaimVisitPanel claim={claim} />
      <MyClaimDonePanel claim={claim} now={now} />

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        {name.charAt(0).toUpperCase() + name.slice(1)} is the person to speak
        to about this time. Nothing here is sent to the family automatically.
      </p>
    </RolePage>
  );
}

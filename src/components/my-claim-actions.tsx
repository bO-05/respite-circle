import Link from "next/link";
import {
  canCheckIn,
  canCheckOut,
  canMarkDone,
  myClaimDoneHint,
  myClaimVisitHint,
} from "@/server/domain/my-claims";
import { formatWindowLabel } from "@/server/domain/slots";
import type { MyClaimDetail } from "@/server/repositories/my-claims";

/**
 * The two actions that belong to the volunteer after the coordinator confirms
 * a time: check in and out of a home visit, and mark the time done once it has
 * passed.
 *
 * The buttons are plain HTML forms posting to route handlers. The server
 * re-derives the session and re-applies the same pure predicates, so hiding a
 * form here is never the enforcement. Times are shown in the church's own
 * timezone.
 */

function CheckpointLine({
  label,
  at,
  timeZone,
  testId,
}: {
  label: string;
  at: Date | null;
  timeZone: string;
  testId: string;
}) {
  if (!at) return null;
  return (
    <p data-testid={testId} className="max-w-prose text-base leading-relaxed tabular-nums text-ink">
      <span className="font-semibold">{label}: </span>
      {formatWindowLabel(at, null, timeZone)}
    </p>
  );
}

export function MyClaimVisitPanel({
  claim,
}: {
  claim: MyClaimDetail;
}) {
  if (claim.kind !== "home") return null;

  const visitInput = {
    kind: claim.kind,
    status: claim.status,
    visit: claim.visit,
  };
  const checkIn = canCheckIn(visitInput, claim.coordinatorFirstName);
  const checkOut = canCheckOut(visitInput, claim.coordinatorFirstName);
  const hasRecord = Boolean(claim.visit.checkedInAt || claim.visit.checkedOutAt);

  if (claim.status !== "covered" && !hasRecord) return null;

  return (
    <section
      data-testid="claim-visit"
      aria-labelledby="visit-heading"
      className="rounded-lg border border-line bg-surface p-5"
    >
      <h2 id="visit-heading" className="font-serif text-2xl text-ink">
        Check in and out
      </h2>
      <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
        {myClaimVisitHint(claim.coordinatorFirstName)}
      </p>

      <div className="mt-3 flex flex-col gap-1">
        <CheckpointLine
          label="Checked in"
          at={claim.visit.checkedInAt}
          timeZone={claim.timeZone}
          testId="claim-checked-in"
        />
        <CheckpointLine
          label="Checked out"
          at={claim.visit.checkedOutAt}
          timeZone={claim.timeZone}
          testId="claim-checked-out"
        />
      </div>

      {claim.status === "covered" ? (
        <div className="mt-4 flex flex-col gap-3">
          {checkIn.ok ? (
            <form
              action={`/api/slots/${claim.id}/visit`}
              method="post"
              data-testid="claim-check-in-form"
              className="flex flex-col gap-2"
            >
              <input type="hidden" name="action" value="check_in" />
              <button
                type="submit"
                className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground"
              >
                Check in
              </button>
            </form>
          ) : null}

          {checkOut.ok ? (
            <form
              action={`/api/slots/${claim.id}/visit`}
              method="post"
              data-testid="claim-check-out-form"
              className="flex flex-col gap-2"
            >
              <input type="hidden" name="action" value="check_out" />
              <button
                type="submit"
                className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-boundary bg-surface px-5 py-2 text-lg font-semibold text-ink"
              >
                Check out
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function MyClaimDonePanel({
  claim,
  now,
}: {
  claim: MyClaimDetail;
  now: Date;
}) {
  const closureHref = `/claim/${claim.id}/close`;

  if (claim.status === "done") {
    return (
      <section
        data-testid="claim-closed"
        aria-labelledby="closed-heading"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="closed-heading" className="font-serif text-2xl text-ink">
          This time is closed
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          Thank you for saying yes. The family can leave a thank-you or ask
          again — both are theirs to choose. Nothing else is needed from you.
        </p>
        <Link
          href={closureHref}
          data-testid="claim-closure-link"
          className="mt-4 inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground"
        >
          See the close of this time
        </Link>
      </section>
    );
  }

  if (claim.status !== "covered") return null;

  const done = canMarkDone(claim, now, claim.coordinatorFirstName);

  return (
    <section
      data-testid="claim-done"
      aria-labelledby="done-heading"
      className="rounded-lg border border-line bg-surface p-5"
    >
      <h2 id="done-heading" className="font-serif text-2xl text-ink">
        When the time has passed
      </h2>
      <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
        {myClaimDoneHint()}
      </p>

      {done.ok ? (
        <form
          action={`/api/slots/${claim.id}/done`}
          method="post"
          data-testid="claim-done-form"
          className="mt-4 flex flex-col gap-2"
        >
          <button
            type="submit"
            className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-green bg-green px-5 py-2 text-lg font-semibold text-accent-foreground"
          >
            Mark this done
          </button>
        </form>
      ) : (
        <p
          data-testid="claim-done-waiting"
          className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          {done.message}
        </p>
      )}

      <Link
        href={closureHref}
        data-testid="claim-closure-link"
        className="mt-4 inline-flex min-h-11 items-center text-base font-semibold text-ink underline decoration-accent underline-offset-4"
      >
        Close this time
      </Link>
    </section>
  );
}

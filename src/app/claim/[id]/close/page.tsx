import Link from "next/link";
import { notFound } from "next/navigation";
import { MY_CLAIM_TONE_CLASS } from "@/components/my-claim-card";
import { ClaimFlash } from "@/components/my-claim-flash";
import { RolePage } from "@/components/role-page";
import { CLAIMS_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { boardKindCopy, coordinatorDisplayName } from "@/server/domain/board";
import {
  closureDoneLine,
  closureLead,
  closureTitle,
  thankYouHeading,
} from "@/server/domain/closure";
import {
  doneFlashMessage,
  doneFlashTone,
  isDoneFlashCode,
  myClaimStatusCopy,
} from "@/server/domain/my-claims";
import { formatWindowLabel } from "@/server/domain/slots";
import { getClosure } from "@/server/repositories/closure";

export const dynamic = "force-dynamic";

/**
 * Closing one covered time.
 *
 * This is the volunteer's own screen: it shows the time, one calm status, the
 * one action that closes the loop, and — only after the family chose to leave
 * them — the family's thank-you. It never carries the family's story, the
 * orientation note, a count, or a chase.
 *
 * The done form posts to the same `POST /api/slots/[id]/done` route the claim
 * page uses; `markClaimDone` is the only write path. The route comes back here
 * so the volunteer sees a plain closure instead of a receipt.
 */
export default async function ClaimClosurePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { person, session } = await requirePage(CLAIMS_ROLES);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const closure = await getClosure(session, id);

  if (!closure) {
    notFound();
  }

  const doneParam = typeof query.done === "string" ? query.done : null;
  const doneCode = isDoneFlashCode(doneParam) ? doneParam : null;
  const flash = doneCode
    ? {
        message: doneFlashMessage(doneCode, closure.coordinatorFirstName),
        tone: doneFlashTone(doneCode),
      }
    : null;

  const kind = boardKindCopy(closure.kind);
  const status = myClaimStatusCopy(closure.status, closure.coordinatorFirstName);
  const name = coordinatorDisplayName(closure.coordinatorFirstName);

  return (
    <RolePage
      person={person}
      role={session.role}
      title={closureTitle(closure.status)}
      lead={closureLead(closure.status, closure.coordinatorFirstName)}
    >
      <div>
        <Link
          href={`/my-claims/${closure.id}`}
          className="inline-flex min-h-11 items-center text-base font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          Back to your claim
        </Link>
      </div>

      {flash ? <ClaimFlash message={flash.message} tone={flash.tone} /> : null}

      <section
        data-testid="closure-panel"
        data-slot-id={closure.id}
        data-kind={closure.kind}
        data-status={closure.status}
        aria-labelledby="closure-heading"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="inline-flex min-h-7 items-center rounded-full border border-line bg-paper px-3 text-base font-semibold text-ink">
            {kind.word}
          </p>
          <p
            data-testid="closure-status"
            className={`inline-flex min-h-7 items-center rounded-full border px-3 text-base font-semibold text-ink ${
              MY_CLAIM_TONE_CLASS[status.tone]
            }`}
          >
            {status.label}
          </p>
        </div>

        <h2
          id="closure-heading"
          className="mt-3 font-serif text-3xl leading-tight text-ink"
        >
          {closure.label}
        </h2>

        <div className="mt-3 flex flex-col gap-1">
          <p
            data-testid="closure-window"
            className="max-w-prose text-xl leading-relaxed text-ink"
          >
            {formatWindowLabel(
              closure.windowStart,
              closure.windowEnd,
              closure.timeZone,
            )}
          </p>
          <p className="max-w-prose text-base leading-relaxed text-ink">
            {kind.location}
          </p>
        </div>

        {closure.status === "done" ? (
          <p
            data-testid="closure-done"
            className="mt-4 max-w-prose text-lg leading-relaxed text-ink"
          >
            {closureDoneLine()}
          </p>
        ) : null}

        {closure.status === "covered" ? (
          closure.done.ok ? (
            <form
              action={`/api/slots/${closure.id}/done?from=claim-close`}
              method="post"
              data-testid="closure-done-form"
              className="mt-4 flex flex-col gap-2"
            >
              <button
                type="submit"
                className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-green bg-green px-5 py-2 text-lg font-semibold text-accent-foreground"
              >
                Mark this time done
              </button>
            </form>
          ) : (
            <p
              data-testid="closure-waiting"
              className="mt-4 max-w-prose text-base leading-relaxed text-ink-muted"
            >
              {closure.done.message}
            </p>
          )
        ) : null}

        {closure.status === "cancelled" ? (
          <p
            data-testid="closure-cancelled"
            className="mt-4 max-w-prose text-base leading-relaxed text-ink-muted"
          >
            The church cancelled this time. A coordinator will be in touch
            about it.
          </p>
        ) : null}
      </section>

      {closure.status === "done" && closure.thankYou ? (
        <section
          data-testid="closure-thank-you"
          aria-labelledby="closure-thank-you-heading"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2
            id="closure-thank-you-heading"
            className="font-serif text-2xl text-ink"
          >
            {thankYouHeading()}
          </h2>
          <blockquote
            data-testid="closure-thank-you-body"
            className="mt-3 max-w-prose whitespace-pre-wrap break-words border-l-4 border-accent bg-paper p-4 text-lg leading-relaxed text-ink"
          >
            {closure.thankYou}
          </blockquote>
          <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
            Kept with this time, exactly as the family wrote it. They chose to
            leave it; nothing was asked of them.
          </p>
        </section>
      ) : null}

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        Nothing else is sent to the family automatically.{" "}
        {name.charAt(0).toUpperCase() + name.slice(1)} is the person to speak to
        about this time.
      </p>
    </RolePage>
  );
}

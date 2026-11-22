import Link from "next/link";
import {
  askAgainHint,
  askAgainLinkLabel,
  careThankYouHeading,
  THANK_YOU_MAX_LENGTH,
} from "@/server/domain/closure";

/**
 * The calm end of one covered time, on the caregiver's own page.
 *
 * A thank-you is genuinely optional: the form carries no required marker, no
 * prompt cadence, and no "not now" that implies a future chase. Submitting it
 * keeps the words for the volunteer who came. Leaving it alone sends nothing
 * and costs nothing.
 *
 * Asking again is a plain link to the intake page, which starts blank. The
 * earlier words are never copied, quoted, or offered as a starting point.
 */
export function CareClosure({
  slotId,
  volunteerFirstName,
  thankYou,
}: {
  slotId: string;
  volunteerFirstName: string | null;
  thankYou: string | null;
}) {
  const person = volunteerFirstName ?? "the person who came";

  return (
    <div
      data-testid="care-closure"
      className="mt-4 flex flex-col gap-4 border-t border-line pt-4"
    >
      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        This time is done. Nothing else is needed from you.
      </p>

      {thankYou ? (
        <div data-testid="care-thank-you-kept">
          <p className="text-base font-semibold text-ink">
            {careThankYouHeading()}
          </p>
          <blockquote className="mt-2 max-w-prose whitespace-pre-wrap break-words rounded-md border border-line bg-paper px-4 py-3 text-lg leading-relaxed text-ink">
            {thankYou}
          </blockquote>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
            Kept for {person}.
          </p>
        </div>
      ) : (
        <form
          action={`/api/slots/${slotId}/thank-you`}
          method="post"
          data-testid="care-thank-you-form"
          className="flex flex-col gap-2"
        >
          <label
            htmlFor={`care-thank-you-${slotId}`}
            className="max-w-prose text-lg font-semibold leading-snug text-ink"
          >
            A thank-you for {person} (optional)
          </label>
          <p
            id={`care-thank-you-help-${slotId}`}
            className="max-w-prose text-base leading-relaxed text-ink-muted"
          >
            You can skip this. Nothing is sent unless you write it here.
          </p>
          <textarea
            id={`care-thank-you-${slotId}`}
            name="note"
            rows={3}
            maxLength={THANK_YOU_MAX_LENGTH}
            aria-describedby={`care-thank-you-help-${slotId}`}
            className="max-w-prose rounded-md border border-line bg-paper px-4 py-3 text-lg leading-relaxed text-ink"
          />
          <button
            type="submit"
            data-testid="care-thank-you-submit"
            className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-line bg-surface px-5 py-2 text-lg font-semibold text-ink"
          >
            Keep this thank-you
          </button>
        </form>
      )}

      <div className="flex flex-col gap-2">
        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          {askAgainHint()}
        </p>
        <Link
          href="/ask?again=1"
          data-testid="care-ask-again"
          className="inline-flex min-h-11 min-w-11 w-fit items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground"
        >
          {askAgainLinkLabel()}
        </Link>
      </div>
    </div>
  );
}

import Link from "next/link";
import { FillCalendarForm } from "@/components/session-forms";
import {
  sessionCalendarCountSentence,
  type SessionOverview,
} from "@/server/domain/session-calendar";

/**
 * The banner the desk shows when fewer than four future Tuesday mornings exist.
 *
 * It names the missing or cancelled weeks from the same guard that refuses a
 * companion proposal, so a coordinator reads one story in both places. The fill
 * control is idempotent and says so.
 */
export function SessionCalendarBanner({
  overview,
  showLink = true,
}: {
  overview: SessionOverview;
  showLink?: boolean;
}) {
  if (!overview.incomplete) return null;

  const paused =
    overview.calendars.length === 0 ||
    overview.calendars.every((calendar) => !calendar.active);

  return (
    <section
      data-testid="session-banner"
      data-incomplete="true"
      data-scheduled-count={overview.scheduledCount}
      data-target-count={overview.targetCount}
      aria-labelledby="session-banner-heading"
      className="rounded-md border-t-2 border-amber bg-amber-soft p-5"
    >
      <h2
        id="session-banner-heading"
        className="font-serif text-2xl leading-snug text-ink"
      >
        {paused
          ? "The weekly Respite Morning is paused"
          : "Fewer than four Tuesdays are planned"}
      </h2>
      <p
        data-testid="session-banner-message"
        className="mt-2 max-w-prose text-lg leading-relaxed text-ink"
      >
        {overview.guard.message}
      </p>
      <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
        {sessionCalendarCountSentence(
          overview.scheduledCount,
          overview.targetCount,
        )}
      </p>

      {paused ? null : (
        <div className="mt-4">
          <FillCalendarForm />
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
            Safe to run again: the same Tuesday is never added twice.
          </p>
        </div>
      )}

      {showLink ? (
        <Link
          href="/desk/sessions"
          className="mt-4 inline-flex min-h-11 items-center rounded-md border border-boundary bg-surface px-5 py-2 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          Open the Respite Morning calendar
        </Link>
      ) : null}
    </section>
  );
}

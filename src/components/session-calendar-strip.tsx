import Link from "next/link";
import { SessionCalendarBanner } from "@/components/session-calendar-banner";
import {
  capacityLine,
  formatSessionClock,
  formatSessionDateShort,
  type PlannedSession,
  type SessionOverview,
} from "@/server/domain/session-calendar";

/**
 * The desk's compact view of the Respite Morning calendar.
 *
 * Capacity and remaining places are visible here as well as on the sessions
 * page: a coordinator should never have to open a second screen to learn that
 * the next Tuesday is full.
 */

const STATUS_COPY: Record<PlannedSession["status"], string> = {
  scheduled: "On the calendar",
  cancelled: "Cancelled",
  completed: "Already happened",
  missing: "No morning on the calendar",
};

export function SessionCalendarStrip({ overview }: { overview: SessionOverview }) {
  const template = overview.calendars[0] ?? null;

  return (
    <section
      data-testid="desk-session-strip"
      aria-labelledby="desk-session-strip-heading"
      className="flex flex-col gap-4 rounded-md border-t border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="desk-session-strip-heading"
          className="font-serif text-2xl text-ink"
        >
          The Respite Morning calendar
        </h2>
        <Link
          href="/desk/sessions"
          className="inline-flex min-h-11 items-center rounded-md px-3 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          All Tuesdays and capacity
        </Link>
      </div>

      {template ? (
        <p className="text-base leading-relaxed text-ink-muted">
          Every {template.weekdayLabel}, {template.timeLabel}, with{" "}
          {template.capacity} companion places.
        </p>
      ) : (
        <p className="text-base leading-relaxed text-ink-muted">
          No weekly Respite Morning template is active.
        </p>
      )}

      <SessionCalendarBanner overview={overview} showLink={false} />

      {overview.calendars.map((calendar) => (
        <ul
          key={calendar.templateId}
          className="flex flex-col gap-2"
          aria-label={`${calendar.weekdayLabel} mornings`}
        >
          {calendar.planned.map((entry) => (
            <li
              key={entry.startsAt.toISOString()}
              data-testid="desk-session-row"
              data-status={entry.status}
              className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-2 first:border-t-0 first:pt-0"
            >
              <span className="text-base font-semibold tabular-nums text-ink">
                <time dateTime={entry.startsAt.toISOString()}>
                  {formatSessionDateShort(entry.startsAt, overview.timeZone)}
                </time>
                <span aria-hidden="true"> · </span>
                <span className="font-normal text-ink-muted">
                  {formatSessionClock(entry.startsAt, overview.timeZone)}–
                  {formatSessionClock(entry.endsAt, overview.timeZone)}
                </span>
              </span>
              <span
                data-testid="desk-session-capacity"
                className="text-base text-ink-muted"
              >
                {entry.status === "scheduled" || entry.status === "cancelled"
                  ? capacityLine(entry)
                  : STATUS_COPY[entry.status]}
              </span>
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}

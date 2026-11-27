import type { ReactNode } from "react";
import type { ChurchDay } from "@/server/domain/day-groups";

/**
 * One day on the board or on "Your times".
 *
 * On a phone the day reads as a heading above its cards. From `md` up the same
 * heading becomes the date rail at the left, with a rule between the date and
 * the times, so a week with several days reads as a week rather than a queue.
 *
 * The heading is one element, not a desktop copy and a mobile copy: a screen
 * reader hears "Tuesday 1 December" once, and the section is labelled by it.
 * Nothing here counts the times in the group — a number of places would turn a
 * neighbour's yes into a race.
 */
export function DateGroup({
  day,
  children,
}: {
  day: ChurchDay;
  children: ReactNode;
}) {
  const headingId = `day-group-${day.key}`;

  return (
    <section
      data-testid="date-group"
      data-date={day.key}
      aria-labelledby={headingId}
      className="grid gap-3 md:grid-cols-[6.5rem_minmax(0,1fr)] md:gap-6"
    >
      <div className="md:border-r md:border-line md:pr-4 md:pt-1">
        <h3 id={headingId} className="text-ink">
          <time
            dateTime={day.key}
            className="flex flex-wrap items-baseline gap-x-2 font-sans tabular-nums md:flex-col md:items-start"
          >
            <span className="font-serif italic font-medium text-[17px] text-accent">
              {day.weekday}
            </span>{" "}
            <span className="text-2xl leading-none md:text-3xl">
              {day.day}
            </span>{" "}
            <span className="text-base text-ink-muted">{day.month}</span>
          </time>
        </h3>
      </div>
      <ul className="flex min-w-0 flex-col gap-4">{children}</ul>
    </section>
  );
}

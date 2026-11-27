import type { ReactNode } from "react";
import type { ChurchDay } from "@/server/domain/day-groups";

/**
 * One day on the board or on "Your times".
 *
 * Round 5 draws the day as a notice band rather than a card rail: the weekday
 * in Fraunces, the date in Source Sans 3 with tabular figures, and a gold
 * hairline under the band. The times below it are hairline-separated rows, one
 * per time, so a week reads like a parish notice sheet and not a stack of
 * boxes.
 *
 * The heading is one element, not a desktop copy and a mobile copy: a screen
 * reader hears "Tuesday 1 December" once, and the section is labelled by it.
 * Nothing here counts the times in the group — a number of places would turn a
 * neighbour's yes into a race.
 *
 * The weekday span keeps the Hall Light kicker class exactly; the numerals of
 * the date stay in the sans with tabular figures, because a date a person
 * compares down a column must not shift.
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
      className="border-t border-line pt-5 first:border-t-0 first:pt-0"
    >
      <h3 id={headingId} className="text-ink">
        <time
          dateTime={day.key}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gold pb-2 font-sans tabular-nums"
        >
          <span className="font-serif italic font-medium text-[17px] text-accent">
            {day.weekday}
          </span>{" "}
          <span className="text-2xl leading-none md:text-3xl">{day.day}</span>{" "}
          <span className="text-base text-ink-muted">{day.month}</span>
        </time>
      </h3>
      <ul className="flex min-w-0 flex-col">{children}</ul>
    </section>
  );
}

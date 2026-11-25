import {
  formatSessionClock,
  formatSessionDate,
} from "../../src/server/domain/session-calendar";

/**
 * The human date and window labels an assertion may name, derived from the
 * instant and the church's time zone.
 *
 * A literal `"Tuesday 24 November 2026, 10:00–14:00"` in an expectation is a
 * calendar date written out by hand: it drifts the moment a fixture instant
 * moves, and it hides which instant the assertion is really about. These
 * helpers turn the instant the test already holds into the sentence a person
 * reads.
 *
 * They call the calendar's own formatter rather than the renderer's
 * `formatWindowLabel`. Two domain modules produce this human format, so the
 * reminder and confirmation tests check one against the other instead of
 * restating the renderer's own output.
 */

/** `Tuesday 24 November 2026, 10:00`, in the church's own time zone. */
export function humanDateTime(date: Date, timeZone: string): string {
  return `${formatSessionDate(date, timeZone)}, ${formatSessionClock(
    date,
    timeZone,
  )}`;
}

/** `Tuesday 24 November 2026, 10:00–14:00`, for a window on one day. */
export function humanWindow(start: Date, end: Date, timeZone: string): string {
  return `${humanDateTime(start, timeZone)}\u2013${formatSessionClock(
    end,
    timeZone,
  )}`;
}

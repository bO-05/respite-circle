/**
 * Church-local time.
 *
 * Instants are stored in UTC; every human-facing date and time is rendered in
 * the church's own time zone from the `church.timezone` column. These helpers
 * are pure and shared by slot construction and the Respite Morning calendar, so
 * the two cannot disagree about what "Tuesday at 10:00" means across a
 * daylight-saving change.
 */

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const safe = isUsableTimeZone(timeZone) ? timeZone : "UTC";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: safe,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

export function isUsableTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function partsInZone(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const values: Record<string, number> = {};

  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function offsetMsAt(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asIfUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asIfUtc - Math.floor(date.getTime() / 1_000) * 1_000;
}

/**
 * Convert a church-local wall time to a UTC instant. The two passes handle a
 * daylight-saving transition: the first guess may land on the other side of it.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const first = wallAsUtc - offsetMsAt(new Date(wallAsUtc), timeZone);
  const second = wallAsUtc - offsetMsAt(new Date(first), timeZone);
  return new Date(second);
}

/** 0 = Sunday, matching `session_template.weekday`. */
export function civilWeekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

/** Parse a Postgres `time` value (`"10:00:00"`) into whole hours and minutes. */
export function parseClockTime(value: string): {
  hour: number;
  minute: number;
} | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return { hour, minute };
}

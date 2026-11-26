import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  civilWeekday,
  partsInZone,
} from "./time-zone";

/**
 * The day rail the board and "Your times" group their cards under.
 *
 * A time is grouped by its civil date in the church's own time zone, never by
 * the viewer's clock or by UTC: a Saturday morning in New York must not become
 * a Saturday evening heading. The group key is the ISO date, so string order is
 * calendar order and no group can appear under two headings.
 *
 * This module is pure and imports no database code, so the grouping is
 * unit-tested without a browser.
 */

export type ChurchDay = {
  /** `2026-12-01` in the church's time zone: stable, sortable, unique. */
  key: string;
  /** `Tuesday` */
  weekday: string;
  /** 1 */
  day: number;
  /** `December` */
  month: string;
  year: number;
};

export type DayGroup<T> = {
  day: ChurchDay;
  items: T[];
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The civil day an instant falls on, for the church reading the board. */
export function churchDayFor(start: Date, timeZone: string): ChurchDay {
  const parts = partsInZone(start, timeZone);
  return {
    key: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    weekday:
      WEEKDAY_NAMES[civilWeekday(parts.year, parts.month, parts.day)] ??
      "Sunday",
    day: parts.day,
    month: MONTH_NAMES[parts.month - 1] ?? "",
    year: parts.year,
  };
}

/**
 * Group cards by day, in calendar order, keeping each day's own order.
 * A time with no window is not invented into a day: it is returned apart so the
 * page can list it in plain words instead of guessing a date for it.
 */
export function groupByChurchDay<T>(
  items: readonly T[],
  getStart: (item: T) => Date | null,
  timeZone: string,
): { groups: DayGroup<T>[]; undated: T[] } {
  const dated = new Map<string, DayGroup<T>>();
  const undated: T[] = [];

  for (const item of items) {
    const start = getStart(item);
    if (!start) {
      undated.push(item);
      continue;
    }
    const day = churchDayFor(start, timeZone);
    const existing = dated.get(day.key);
    if (existing) {
      existing.items.push(item);
    } else {
      dated.set(day.key, { day, items: [item] });
    }
  }

  const groups = [...dated.values()].sort((left, right) =>
    left.day.key.localeCompare(right.day.key),
  );

  return { groups, undated };
}

/**
 * The board groups only when there is more than one day to separate. One day
 * needs no rail, and a rail around a single day would be furniture, not
 * structure.
 */
export function dayGroupCount(
  grouped: { groups: unknown[]; undated: unknown[] },
): number {
  return grouped.groups.length + (grouped.undated.length > 0 ? 1 : 0);
}

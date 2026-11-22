/**
 * The metrics page's arithmetic, kept pure.
 *
 * Two jobs:
 *
 *   - turn a stated `from`/`to` range of church-local civil dates into one
 *     inclusive start instant and one exclusive next-midnight instant, so a
 *     daylight-saving change cannot lose or repeat an hour;
 *   - measure coordinator minutes from audit timestamps alone.
 *
 * The measure is deliberately a floor, not an effort estimate. For each
 * request, it adds the short gaps between a coordinator's actions on that
 * request. A gap longer than `COORDINATOR_GAP_MINUTES` is a pause between
 * sittings and is never counted as work. A request with only one action has no
 * interval at all, and the page says so instead of inventing minutes.
 */

import { MONTH_NAMES, partsInZone, zonedWallTimeToUtc } from "./time-zone";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The default window: today and the 29 days before it. */
export const METRICS_DEFAULT_DAYS = 30;

/** A range longer than this is refused rather than quietly shortened. */
export const METRICS_MAX_DAYS = 366;

/** Gaps longer than this are a pause between sittings, not desk work. */
export const COORDINATOR_GAP_MINUTES = 20;

export type CivilDate = {
  year: number;
  month: number;
  day: number;
};

export type MetricsRangeInput = {
  from?: string | string[];
  to?: string | string[];
};

export type MetricsRange = {
  /** The church-local civil date the range starts on, `YYYY-MM-DD`. */
  from: string;
  /** The church-local civil date the range ends on, inclusive. */
  to: string;
  /** Inclusive UTC instant of local midnight on `from`. */
  start: Date;
  /** Exclusive UTC instant of local midnight after `to`. */
  endExclusive: Date;
  /** "25 October 2026 – 23 November 2026", for the page's range line. */
  label: string;
  isDefault: boolean;
  /** One calm sentence when a parameter was replaced, otherwise null. */
  notice: string | null;
};

function firstValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseCivilDate(value: string): CivilDate | null {
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1900 || year > 2100) return null;

  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function civilDateValue(date: CivilDate): string {
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${date.year}-${month}-${day}`;
}

function addCivilDays(date: CivilDate, days: number): CivilDate {
  const next = new Date(
    Date.UTC(date.year, date.month - 1, date.day + days, 12),
  );
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function daysBetween(from: CivilDate, to: CivilDate): number {
  const start = Date.UTC(from.year, from.month - 1, from.day, 12);
  const end = Date.UTC(to.year, to.month - 1, to.day, 12);
  return Math.round((end - start) / DAY_MS);
}

export function formatCivilDate(date: CivilDate): string {
  return `${date.day} ${MONTH_NAMES[date.month - 1]} ${date.year}`;
}

function todayIn(timeZone: string, now: Date): CivilDate {
  const parts = partsInZone(now, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function toRange(
  from: CivilDate,
  to: CivilDate,
  timeZone: string,
  isDefault: boolean,
  notice: string | null,
): MetricsRange {
  const dayAfter = addCivilDays(to, 1);

  return {
    from: civilDateValue(from),
    to: civilDateValue(to),
    start: zonedWallTimeToUtc(from.year, from.month, from.day, 0, 0, timeZone),
    endExclusive: zonedWallTimeToUtc(
      dayAfter.year,
      dayAfter.month,
      dayAfter.day,
      0,
      0,
      timeZone,
    ),
    label: `${formatCivilDate(from)} – ${formatCivilDate(to)}`,
    isDefault,
    notice,
  };
}

function defaultRange(
  timeZone: string,
  now: Date,
  notice: string | null,
): MetricsRange {
  const today = todayIn(timeZone, now);
  const from = addCivilDays(today, -(METRICS_DEFAULT_DAYS - 1));
  return toRange(from, today, timeZone, true, notice);
}

const BOTH_DATES_NOTICE =
  "Choose both dates to set a range. Showing the last 30 days instead.";
const UNREADABLE_DATE_NOTICE =
  "One of those dates isn't a date we can read. Showing the last 30 days instead.";
const BACKWARDS_NOTICE =
  "The start date is after the end date. Showing the last 30 days instead.";
const TOO_LONG_NOTICE = `A range can be up to ${METRICS_MAX_DAYS} days. Showing the last 30 days instead.`;

/**
 * Read the page's `?from=` and `?to=`. Every bad input falls back to the same
 * honest default and carries one sentence explaining why.
 */
export function parseMetricsRange(
  input: MetricsRangeInput,
  options: { timeZone: string; now: Date },
): MetricsRange {
  const rawFrom = firstValue(input.from)?.trim();
  const rawTo = firstValue(input.to)?.trim();

  if (!rawFrom && !rawTo) {
    return defaultRange(options.timeZone, options.now, null);
  }

  if (!rawFrom || !rawTo) {
    return defaultRange(options.timeZone, options.now, BOTH_DATES_NOTICE);
  }

  const from = parseCivilDate(rawFrom);
  const to = parseCivilDate(rawTo);

  if (!from || !to) {
    return defaultRange(options.timeZone, options.now, UNREADABLE_DATE_NOTICE);
  }

  if (daysBetween(from, to) < 0) {
    return defaultRange(options.timeZone, options.now, BACKWARDS_NOTICE);
  }

  if (daysBetween(from, to) + 1 > METRICS_MAX_DAYS) {
    return defaultRange(options.timeZone, options.now, TOO_LONG_NOTICE);
  }

  return toRange(from, to, options.timeZone, false, null);
}

export type CoordinatorAction = {
  /** The request the action belongs to, so its sitting can be measured. */
  askId: string;
  at: Date;
};

export type CoordinatorMinutes = {
  totalMinutes: number;
  /** Minutes per request that had at least one measurable gap, or null. */
  averageMinutes: number | null;
  requestsWithIntervals: number;
  /** Requests with any coordinator action at all. */
  requestsMeasured: number;
  actionsCounted: number;
  gapCapMinutes: number;
};

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Measure desk time from audit timestamps. Actions are grouped by request, so
 * two different families' requests never contribute a gap to each other.
 */
export function measureCoordinatorMinutes(
  actions: readonly CoordinatorAction[],
  gapCapMinutes: number = COORDINATOR_GAP_MINUTES,
): CoordinatorMinutes {
  const byRequest = new Map<string, number[]>();

  for (const action of actions) {
    const instant = action.at.getTime();
    if (!Number.isFinite(instant)) continue;

    const existing = byRequest.get(action.askId);
    if (existing) existing.push(instant);
    else byRequest.set(action.askId, [instant]);
  }

  let totalMinutes = 0;
  let requestsWithIntervals = 0;
  let actionsCounted = 0;

  for (const instants of byRequest.values()) {
    actionsCounted += instants.length;
    if (instants.length < 2) continue;

    instants.sort((a, b) => a - b);

    let countedForRequest = 0;
    for (let index = 1; index < instants.length; index += 1) {
      const gap = (instants[index] - instants[index - 1]) / MINUTE_MS;
      if (gap > 0 && gap <= gapCapMinutes) countedForRequest += gap;
    }

    if (countedForRequest > 0) {
      totalMinutes += countedForRequest;
      requestsWithIntervals += 1;
    }
  }

  const roundedTotal = roundOneDecimal(totalMinutes);

  return {
    totalMinutes: roundedTotal,
    averageMinutes:
      requestsWithIntervals > 0
        ? roundOneDecimal(roundedTotal / requestsWithIntervals)
        : null,
    requestsWithIntervals,
    requestsMeasured: byRequest.size,
    actionsCounted,
    gapCapMinutes,
  };
}

export function formatVolunteerHours(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const rounded = roundOneDecimal(safe / 3_600);

  if (rounded === 0) return "0 hours";
  if (rounded === 1) return "1 hour";

  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1);
  return `${text} hours`;
}

export function formatMinutes(minutes: number): string {
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  const rounded = roundOneDecimal(safe);
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1);
  return `${text} min`;
}

/** The method sentence under the coordinator-minutes number. */
export function coordinatorMinutesMethod(
  gapCapMinutes: number = COORDINATOR_GAP_MINUTES,
): string {
  return `Measured from the audit trail: the gaps of ${gapCapMinutes} minutes or less between a coordinator's actions on the same request. A longer pause is not counted as work.`;
}

/** The honest frame under every number on the page. */
export const METRICS_FRAME =
  "Counts from this church's own records for the range above. Nothing here is a forecast or a comparison with another church.";

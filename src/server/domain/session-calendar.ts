/**
 * The weekly Respite Morning calendar.
 *
 * One church-owned template describes the ordinary Tuesday: 10:00–14:00 in the
 * church's own time zone, with a fixed number of companion places. Plain code
 * turns that template into the next four occurrences. The database's unique
 * `(template_id, starts_at)` index is the real idempotence guard; this module
 * only computes which mornings are expected, which exist, and which are
 * missing, cancelled, or full.
 *
 * A companion place may only be proposed for a Tuesday that exists and has
 * room. The refusal messages are built here so the desk banner and the proposal
 * refusal quote the same dates.
 */

import type { CalendarGuard } from "./slots";
import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  civilWeekday,
  partsInZone,
  parseClockTime,
  zonedWallTimeToUtc,
} from "./time-zone";

/** The calendar is planned exactly four occurrences ahead. */
export const SESSIONS_AHEAD = 4;

export type TemplateSchedule = {
  id: string;
  /** 0 = Sunday, matching `session_template.weekday`. */
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  active: boolean;
};

export type CalendarSessionRow = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  status: "scheduled" | "completed" | "cancelled";
  usedCompanionPlaces: number;
};

export type PlannedSessionStatus =
  | "scheduled"
  | "completed"
  | "cancelled"
  | "missing";

export type PlannedSession = {
  startsAt: Date;
  endsAt: Date;
  sessionId: string | null;
  status: PlannedSessionStatus;
  capacity: number;
  usedCompanionPlaces: number;
  remainingCompanionPlaces: number;
  full: boolean;
};

export type SessionCalendar = {
  templateId: string;
  weekday: number;
  weekdayLabel: string;
  timeLabel: string;
  capacity: number;
  active: boolean;
  target: number;
  planned: PlannedSession[];
  missing: PlannedSession[];
  cancelled: PlannedSession[];
  scheduledCount: number;
  incomplete: boolean;
};

export type SessionOverview = {
  timeZone: string;
  calendars: SessionCalendar[];
  targetCount: number;
  scheduledCount: number;
  missingCount: number;
  cancelledCount: number;
  incomplete: boolean;
  guard: CalendarGuard;
};

const MS_PER_DAY = 24 * 60 * 60 * 1_000;
const MAX_DAYS_AHEAD = 35;

export function weekdayName(weekday: number): string {
  const index = Number.isInteger(weekday) ? weekday : 0;
  return WEEKDAY_NAMES[((index % 7) + 7) % 7] ?? "Tuesday";
}

/** `10:00–14:00`, seconds omitted for people. */
export function formatTimeRange(schedule: {
  startTime: string;
  endTime: string;
}): string {
  return `${clockLabel(schedule.startTime)}–${clockLabel(schedule.endTime)}`;
}

function clockLabel(value: string): string {
  const parsed = parseClockTime(value);
  if (!parsed) return value;
  return `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`;
}

function durationMinutes(schedule: {
  startTime: string;
  endTime: string;
}): number {
  const start = parseClockTime(schedule.startTime);
  const end = parseClockTime(schedule.endTime);
  if (!start || !end) return 4 * 60;

  const minutes =
    (end.hour * 60 + end.minute - (start.hour * 60 + start.minute)) % (24 * 60);
  return minutes > 0 ? minutes : 4 * 60;
}

type Occurrence = { startsAt: Date; endsAt: Date };

/**
 * The next `count` occurrences of the template's weekday and wall time,
 * strictly after `now`. Each occurrence is computed independently in the
 * church's time zone, so the daylight-saving change cannot shift the hour.
 */
export function nextOccurrences(
  schedule: Pick<TemplateSchedule, "weekday" | "startTime" | "endTime">,
  now: Date,
  timeZone: string,
  count: number = SESSIONS_AHEAD,
): Occurrence[] {
  const start = parseClockTime(schedule.startTime);
  if (!start) return [];

  const duration = durationMinutes(schedule) * 60 * 1_000;
  const today = partsInZone(now, timeZone);
  const anchor = Date.UTC(today.year, today.month - 1, today.day, 12);
  const occurrences: Occurrence[] = [];

  for (let offset = 0; offset <= MAX_DAYS_AHEAD && occurrences.length < count; offset += 1) {
    const candidate = new Date(anchor + offset * MS_PER_DAY);
    const year = candidate.getUTCFullYear();
    const month = candidate.getUTCMonth() + 1;
    const day = candidate.getUTCDate();

    if (civilWeekday(year, month, day) !== schedule.weekday) continue;

    const startsAt = zonedWallTimeToUtc(
      year,
      month,
      day,
      start.hour,
      start.minute,
      timeZone,
    );
    if (startsAt.getTime() <= now.getTime()) continue;

    occurrences.push({
      startsAt,
      endsAt: new Date(startsAt.getTime() + duration),
    });
  }

  return occurrences;
}

export function planSessionCalendar(input: {
  schedule: TemplateSchedule;
  sessions: readonly CalendarSessionRow[];
  now: Date;
  timeZone: string;
  target?: number;
}): SessionCalendar {
  const target = input.target ?? SESSIONS_AHEAD;
  const expected = nextOccurrences(
    input.schedule,
    input.now,
    input.timeZone,
    target,
  );
  const byStart = new Map<number, CalendarSessionRow>();
  for (const row of input.sessions) {
    byStart.set(row.startsAt.getTime(), row);
  }

  const planned: PlannedSession[] = expected.map((occurrence) => {
    const row = byStart.get(occurrence.startsAt.getTime());
    const status: PlannedSessionStatus = row?.status ?? "missing";
    const capacity = row?.capacity ?? input.schedule.capacity;
    const usedCompanionPlaces = row?.usedCompanionPlaces ?? 0;
    const remaining =
      status === "scheduled"
        ? Math.max(capacity - usedCompanionPlaces, 0)
        : Math.max(capacity, 0);

    return {
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      sessionId: row?.id ?? null,
      status,
      capacity,
      usedCompanionPlaces,
      remainingCompanionPlaces: remaining,
      full: status === "scheduled" && usedCompanionPlaces >= capacity,
    };
  });

  const missing = planned.filter((entry) => entry.status === "missing");
  const cancelled = planned.filter((entry) => entry.status === "cancelled");
  const scheduledCount = planned.filter(
    (entry) => entry.status === "scheduled",
  ).length;

  return {
    templateId: input.schedule.id,
    weekday: input.schedule.weekday,
    weekdayLabel: weekdayName(input.schedule.weekday),
    timeLabel: formatTimeRange(input.schedule),
    capacity: input.schedule.capacity,
    active: input.schedule.active,
    target,
    planned,
    missing,
    cancelled,
    scheduledCount,
    incomplete: planned.length < target || missing.length > 0 || cancelled.length > 0,
  };
}

export function buildSessionOverview(input: {
  schedules: readonly TemplateSchedule[];
  sessions: readonly CalendarSessionRow[];
  now: Date;
  timeZone: string;
  target?: number;
}): SessionOverview {
  const calendars = input.schedules.map((schedule) =>
    planSessionCalendar({
      schedule,
      sessions: input.sessions,
      now: input.now,
      timeZone: input.timeZone,
      target: input.target,
    }),
  );

  const overview = {
    timeZone: input.timeZone,
    calendars,
    targetCount: calendars.reduce((sum, calendar) => sum + calendar.target, 0),
    scheduledCount: calendars.reduce(
      (sum, calendar) => sum + calendar.scheduledCount,
      0,
    ),
    missingCount: calendars.reduce(
      (sum, calendar) => sum + calendar.missing.length,
      0,
    ),
    cancelledCount: calendars.reduce(
      (sum, calendar) => sum + calendar.cancelled.length,
      0,
    ),
    incomplete: calendars.some((calendar) => calendar.incomplete),
  };

  return { ...overview, guard: calendarGuard(overview) };
}

function uniqueLabels(
  calendars: readonly SessionCalendar[],
  timeZone: string,
  status: "missing" | "cancelled",
): string[] {
  const labels = new Map<string, string>();
  for (const calendar of calendars) {
    for (const entry of calendar.planned) {
      if (entry.status !== status) continue;
      labels.set(entry.startsAt.toISOString(), formatSessionDate(entry.startsAt, timeZone));
    }
  }
  return [...labels.values()];
}

export function calendarGuard(input: {
  calendars: readonly SessionCalendar[];
  incomplete: boolean;
  timeZone?: string;
}): CalendarGuard {
  const calendars = input.calendars;
  const timeZone = input.timeZone ?? "UTC";

  if (calendars.length === 0) {
    return {
      incomplete: true,
      message:
        "No weekly Respite Morning template is active, so no Tuesday is planned. A companion place cannot be proposed until the church's weekly morning is turned back on.",
    };
  }

  const usable = calendars.filter((calendar) => calendar.active);
  if (usable.length === 0) {
    return {
      incomplete: true,
      message:
        "The weekly Respite Morning template is paused or not active, so the Tuesdays ahead are not planned. A companion place cannot be proposed until it is turned back on.",
    };
  }

  if (!input.incomplete) return { incomplete: false, message: "" };

  const cancelled = uniqueLabels(usable, timeZone, "cancelled");
  const missing = uniqueLabels(usable, timeZone, "missing");
  const sentences: string[] = ["The next four Tuesdays are not all planned."];

  for (const label of cancelled) {
    sentences.push(`${label} was cancelled.`);
  }
  for (const label of missing) {
    sentences.push(`${label} has no Respite Morning yet.`);
  }

  sentences.push(
    "A companion place cannot be proposed for a week without a morning. Fill the calendar first.",
  );

  return { incomplete: true, message: sentences.join(" ") };
}

/** `9 of 12 places left` / `Full — 12 of 12 places taken`. */
export function capacityLine(entry: {
  capacity: number;
  usedCompanionPlaces: number;
  remainingCompanionPlaces: number;
}): string {
  const capacity = Math.max(entry.capacity, 0);
  if (entry.remainingCompanionPlaces <= 0) {
    return `Full — ${capacity} of ${capacity} places taken`;
  }
  return `${entry.remainingCompanionPlaces} of ${capacity} places left`;
}

/** `Tuesday 8 December 2026`, in the church's own time zone. */
export function formatSessionDate(date: Date, timeZone: string): string {
  const parts = partsInZone(date, timeZone);
  const weekday = WEEKDAY_NAMES[civilWeekday(parts.year, parts.month, parts.day)];
  const month = MONTH_NAMES[parts.month - 1] ?? "";

  if (!weekday || !month) return date.toISOString();
  return `${weekday} ${parts.day} ${month} ${parts.year}`;
}

/** `Tue 8 Dec`, for a compact desk strip. */
export function formatSessionDateShort(date: Date, timeZone: string): string {
  const parts = partsInZone(date, timeZone);
  const weekday = WEEKDAY_NAMES[civilWeekday(parts.year, parts.month, parts.day)];
  const month = MONTH_NAMES[parts.month - 1] ?? "";

  if (!weekday || !month) return date.toISOString();
  return `${weekday.slice(0, 3)} ${parts.day} ${month.slice(0, 3)}`;
}

export function formatSessionClock(date: Date, timeZone: string): string {
  const parts = partsInZone(date, timeZone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

import { describe, expect, it } from "vitest";
import {
  SESSIONS_AHEAD,
  buildSessionOverview,
  calendarGuard,
  capacityLine,
  formatSessionDate,
  formatTimeRange,
  nextOccurrences,
  planSessionCalendar,
  type CalendarSessionRow,
  type TemplateSchedule,
} from "@/server/domain/session-calendar";

/**
 * The weekly Respite Morning calendar.
 *
 * One Tuesday template, 10:00–14:00 in the church's own time zone, planned
 * exactly four occurrences ahead. The calendar is what a companion proposal may
 * draw on: a missing week is named, a cancelled week stays named, and a full
 * morning says so instead of quietly overbooking.
 */

const TIME_ZONE = "America/New_York";
const NOW = new Date("2026-11-22T12:00:00.000Z"); // Sunday 22 November, 07:00 in New York

const TEMPLATE: TemplateSchedule = {
  id: "template-1",
  weekday: 2,
  startTime: "10:00:00",
  endTime: "14:00:00",
  capacity: 12,
  active: true,
};

function row(
  id: string,
  startsAt: string,
  overrides: Partial<CalendarSessionRow> = {},
): CalendarSessionRow {
  const start = new Date(startsAt);
  return {
    id,
    startsAt: start,
    endsAt: new Date(start.getTime() + 4 * 60 * 60 * 1_000),
    capacity: 12,
    status: "scheduled",
    usedCompanionPlaces: 0,
    ...overrides,
  };
}

describe("the four Tuesdays ahead", () => {
  it("computes four Tuesday mornings from a Sunday, in the church's time zone", () => {
    const occurrences = nextOccurrences(TEMPLATE, NOW, TIME_ZONE);

    expect(SESSIONS_AHEAD).toBe(4);
    expect(occurrences).toHaveLength(4);
    expect(occurrences.map((entry) => entry.startsAt.toISOString())).toEqual([
      "2026-11-24T15:00:00.000Z",
      "2026-12-01T15:00:00.000Z",
      "2026-12-08T15:00:00.000Z",
      "2026-12-15T15:00:00.000Z",
    ]);
    expect(occurrences.map((entry) => entry.endsAt.toISOString())).toEqual([
      "2026-11-24T19:00:00.000Z",
      "2026-12-01T19:00:00.000Z",
      "2026-12-08T19:00:00.000Z",
      "2026-12-15T19:00:00.000Z",
    ]);
  });

  it("skips an occurrence that starts exactly now, so the seeded four are the next four", () => {
    const atStart = new Date("2026-11-24T15:00:00.000Z");
    const occurrences = nextOccurrences(TEMPLATE, atStart, TIME_ZONE);

    expect(occurrences[0]?.startsAt.toISOString()).toBe(
      "2026-12-01T15:00:00.000Z",
    );
  });

  it("keeps 10:00 local across the daylight-saving change", () => {
    const beforeDst = new Date("2027-03-01T12:00:00.000Z"); // Monday
    const occurrences = nextOccurrences(TEMPLATE, beforeDst, TIME_ZONE);

    expect(occurrences.map((entry) => entry.startsAt.toISOString())).toEqual([
      "2027-03-02T15:00:00.000Z", // EST
      "2027-03-09T15:00:00.000Z",
      "2027-03-16T14:00:00.000Z", // EDT, 10:00 local is 14:00 UTC
      "2027-03-23T14:00:00.000Z",
    ]);
  });
});

describe("capacity and missing weeks", () => {
  const sessions: CalendarSessionRow[] = [
    row("session-1", "2026-11-24T15:00:00.000Z", {
      usedCompanionPlaces: 3,
    }),
    row("session-2", "2026-12-01T15:00:00.000Z", {
      status: "cancelled",
    }),
    // Tuesday 8 December is missing on purpose.
    row("session-4", "2026-12-15T15:00:00.000Z", {
      usedCompanionPlaces: 12,
      capacity: 12,
    }),
  ];

  const calendar = planSessionCalendar({
    schedule: TEMPLATE,
    sessions,
    now: NOW,
    timeZone: TIME_ZONE,
  });

  it("names each week scheduled, cancelled, missing, or full", () => {
    expect(calendar.planned.map((entry) => entry.status)).toEqual([
      "scheduled",
      "cancelled",
      "missing",
      "scheduled",
    ]);
    expect(calendar.scheduledCount).toBe(2);
    expect(calendar.missing).toHaveLength(1);
    expect(calendar.cancelled).toHaveLength(1);
    expect(calendar.incomplete).toBe(true);
    expect(calendar.missing[0]?.startsAt.toISOString()).toBe(
      "2026-12-08T15:00:00.000Z",
    );
  });

  it("tracks remaining companion places and calls a full morning full", () => {
    expect(calendar.planned[0]?.remainingCompanionPlaces).toBe(9);
    expect(calendar.planned[0]?.full).toBe(false);
    expect(calendar.planned[1]?.remainingCompanionPlaces).toBe(12);
    expect(calendar.planned[3]?.remainingCompanionPlaces).toBe(0);
    expect(calendar.planned[3]?.full).toBe(true);

    expect(capacityLine(calendar.planned[0]!)).toBe(
      "9 of 12 places left",
    );
    expect(capacityLine(calendar.planned[3]!)).toBe(
      "Full — 12 of 12 places taken",
    );
  });

  it("builds a desk overview whose banner names the missing and cancelled weeks", () => {
    const overview = buildSessionOverview({
      schedules: [TEMPLATE],
      sessions,
      now: NOW,
      timeZone: TIME_ZONE,
    });

    expect(overview.targetCount).toBe(4);
    expect(overview.scheduledCount).toBe(2);
    expect(overview.missingCount).toBe(1);
    expect(overview.cancelledCount).toBe(1);
    expect(overview.incomplete).toBe(true);

    const guard = calendarGuard(overview);
    expect(guard.incomplete).toBe(true);
    expect(guard.message).toMatch(/not all planned/i);
    expect(guard.message).toContain("Tuesday 8 December 2026");
    expect(guard.message).toContain("Tuesday 1 December 2026");
    expect(guard.message).toMatch(/fill the calendar/i);
  });

  it("says the calendar is complete when all four are scheduled", () => {
    const complete = buildSessionOverview({
      schedules: [TEMPLATE],
      sessions: [
        row("s1", "2026-11-24T15:00:00.000Z"),
        row("s2", "2026-12-01T15:00:00.000Z"),
        row("s3", "2026-12-08T15:00:00.000Z"),
        row("s4", "2026-12-15T15:00:00.000Z"),
      ],
      now: NOW,
      timeZone: TIME_ZONE,
    });

    expect(complete.incomplete).toBe(false);
    expect(calendarGuard(complete).incomplete).toBe(false);
    expect(calendarGuard(complete).message).toBe("");
  });

  it("refuses proposals when no weekly template is active", () => {
    const overview = buildSessionOverview({
      schedules: [{ ...TEMPLATE, active: false }],
      sessions: [],
      now: NOW,
      timeZone: TIME_ZONE,
    });

    const guard = calendarGuard(overview);
    expect(guard.incomplete).toBe(true);
    expect(guard.message).toMatch(/template/i);
    expect(guard.message).toMatch(/paused|not active/i);
  });
});

describe("human date and time copy", () => {
  it("names the Tuesday in the church's own time zone", () => {
    expect(
      formatSessionDate(new Date("2026-12-08T15:00:00.000Z"), TIME_ZONE),
    ).toBe("Tuesday 8 December 2026");
  });

  it("prints the template hours without seconds", () => {
    expect(formatTimeRange({ startTime: "10:00:00", endTime: "14:00:00" })).toBe(
      "10:00–14:00",
    );
  });
});

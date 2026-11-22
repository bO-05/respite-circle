import { describe, expect, it } from "vitest";
import {
  COORDINATOR_GAP_MINUTES,
  METRICS_MAX_DAYS,
  formatMinutes,
  formatVolunteerHours,
  measureCoordinatorMinutes,
  parseMetricsRange,
} from "../../src/server/domain/metrics";

/**
 * VAL-METRICS-001 / -002 at the domain boundary.
 *
 * A range is two church-local civil dates, turned into one inclusive start and
 * one exclusive next-midnight so a daylight-saving change cannot lose or repeat
 * an hour. Coordinator minutes are measured from audit timestamps: the short
 * gaps between a coordinator's actions on one request. A gap longer than the
 * cap is a pause, not work, and is never counted.
 */

const TIME_ZONE = "America/New_York";
const NOW = new Date("2026-11-23T15:00:00.000Z"); // Monday 23 November, 10:00 EST

describe("the stated range", () => {
  it("defaults to the last 30 days ending today, in church time", () => {
    const range = parseMetricsRange({}, { timeZone: TIME_ZONE, now: NOW });

    expect(range.from).toBe("2026-10-25");
    expect(range.to).toBe("2026-11-23");
    expect(range.isDefault).toBe(true);
    expect(range.notice).toBeNull();
    // 00:00 on 25 October is still daylight time in New York (UTC-4).
    expect(range.start.toISOString()).toBe("2026-10-25T04:00:00.000Z");
    // The end is exclusive: 00:00 on 24 November is standard time (UTC-5).
    expect(range.endExclusive.toISOString()).toBe("2026-11-24T05:00:00.000Z");
    expect(range.label).toContain("25 October 2026");
    expect(range.label).toContain("23 November 2026");
  });

  it("keeps a stated range and ends at the next local midnight", () => {
    const range = parseMetricsRange(
      { from: "2026-11-01", to: "2026-11-30" },
      { timeZone: TIME_ZONE, now: NOW },
    );

    expect(range.isDefault).toBe(false);
    expect(range.notice).toBeNull();
    expect(range.from).toBe("2026-11-01");
    expect(range.to).toBe("2026-11-30");
    expect(range.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(range.endExclusive.toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });

  it("survives the spring-forward night without losing an hour", () => {
    const range = parseMetricsRange(
      { from: "2026-03-07", to: "2026-03-08" },
      { timeZone: TIME_ZONE, now: NOW },
    );

    const hours =
      (range.endExclusive.getTime() - range.start.getTime()) / 3_600_000;
    // Two civil days, one of which is 23 hours long in New York.
    expect(hours).toBe(47);
  });

  it("refuses a start after the end and says which range it used", () => {
    const range = parseMetricsRange(
      { from: "2026-11-30", to: "2026-11-01" },
      { timeZone: TIME_ZONE, now: NOW },
    );

    expect(range.isDefault).toBe(true);
    expect(range.notice).toMatch(/start date is after the end date/i);
    expect(range.label).toContain("25 October 2026");
  });

  it("refuses a date that does not exist", () => {
    const range = parseMetricsRange(
      { from: "2026-02-31", to: "2026-03-05" },
      { timeZone: TIME_ZONE, now: NOW },
    );

    expect(range.isDefault).toBe(true);
    expect(range.notice).toMatch(/isn't a date we can read/i);
  });

  it("refuses a range longer than a year", () => {
    const range = parseMetricsRange(
      { from: "2025-01-01", to: "2026-11-30" },
      { timeZone: TIME_ZONE, now: NOW },
    );

    expect(range.isDefault).toBe(true);
    expect(range.notice).toContain(String(METRICS_MAX_DAYS));
  });

  it("asks for both dates when only one is given", () => {
    const range = parseMetricsRange(
      { from: "2026-11-01" },
      { timeZone: TIME_ZONE, now: NOW },
    );

    expect(range.isDefault).toBe(true);
    expect(range.notice).toMatch(/both dates/i);
  });
});

describe("coordinator minutes from the audit trail", () => {
  const at = (iso: string) => new Date(iso);

  it("adds the short gaps between a coordinator's actions on one request", () => {
    const measured = measureCoordinatorMinutes([
      { askId: "a", at: at("2026-11-23T15:00:00.000Z") },
      { askId: "a", at: at("2026-11-23T15:05:00.000Z") },
      { askId: "b", at: at("2026-11-23T16:00:00.000Z") },
      { askId: "b", at: at("2026-11-23T16:04:00.000Z") },
    ]);

    expect(measured.totalMinutes).toBe(9);
    expect(measured.averageMinutes).toBe(4.5);
    expect(measured.requestsWithIntervals).toBe(2);
    expect(measured.requestsMeasured).toBe(2);
    expect(measured.actionsCounted).toBe(4);
  });

  it("does not count a long pause as work", () => {
    const measured = measureCoordinatorMinutes([
      { askId: "a", at: at("2026-11-23T15:00:00.000Z") },
      { askId: "a", at: at("2026-11-23T15:05:00.000Z") },
      { askId: "a", at: at("2026-11-24T15:05:00.000Z") },
    ]);

    expect(measured.totalMinutes).toBe(5);
    expect(measured.averageMinutes).toBe(5);
  });

  it("counts a gap exactly at the cap and not one second over", () => {
    const measured = measureCoordinatorMinutes([
      { askId: "a", at: at("2026-11-23T15:00:00.000Z") },
      { askId: "a", at: at("2026-11-23T15:20:00.000Z") },
      { askId: "a", at: at("2026-11-23T15:40:01.000Z") },
    ]);

    expect(COORDINATOR_GAP_MINUTES).toBe(20);
    expect(measured.totalMinutes).toBe(20);
  });

  it("leaves the average unmeasured when no request has two actions", () => {
    const measured = measureCoordinatorMinutes([
      { askId: "a", at: at("2026-11-23T15:00:00.000Z") },
      { askId: "b", at: at("2026-11-23T15:00:00.000Z") },
    ]);

    expect(measured.totalMinutes).toBe(0);
    expect(measured.averageMinutes).toBeNull();
    expect(measured.requestsWithIntervals).toBe(0);
    expect(measured.requestsMeasured).toBe(2);
  });

  it("sorts actions that arrive out of order", () => {
    const measured = measureCoordinatorMinutes([
      { askId: "a", at: at("2026-11-23T15:07:00.000Z") },
      { askId: "a", at: at("2026-11-23T15:00:00.000Z") },
      { askId: "a", at: at("2026-11-23T15:03:00.000Z") },
    ]);

    expect(measured.totalMinutes).toBe(7);
  });

  it("measures nothing from an empty range", () => {
    const measured = measureCoordinatorMinutes([]);
    expect(measured.totalMinutes).toBe(0);
    expect(measured.averageMinutes).toBeNull();
    expect(measured.requestsMeasured).toBe(0);
  });
});

describe("writing a measured number", () => {
  it("says hours in whole words", () => {
    expect(formatVolunteerHours(0)).toBe("0 hours");
    expect(formatVolunteerHours(3_600)).toBe("1 hour");
    expect(formatVolunteerHours(7_200)).toBe("2 hours");
    expect(formatVolunteerHours(6.5 * 3_600)).toBe("6.5 hours");
  });

  it("never shows more than one decimal place", () => {
    expect(formatVolunteerHours(3_600 * 1.04)).toBe("1 hour");
    expect(formatVolunteerHours(3_600 * 1.06)).toBe("1.1 hours");
  });

  it("writes minutes with a unit, and only one decimal", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(4)).toBe("4 min");
    expect(formatMinutes(4.5)).toBe("4.5 min");
    expect(formatMinutes(4.444)).toBe("4.4 min");
  });
});

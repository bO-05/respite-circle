import { describe, expect, it } from "vitest";
import {
  churchDayFor,
  dayGroupCount,
  groupByChurchDay,
} from "../../src/server/domain/day-groups";

/**
 * The day rail behind the board and "Your times".
 *
 * A time is grouped by its civil date in the church's own time zone, in
 * calendar order, with every time under exactly one heading. A time with no
 * window is never invented into a day.
 */

type Item = { id: string; start: Date | null };

const TZ = "America/New_York";

function at(iso: string): Date {
  return new Date(iso);
}

function items(...starts: Array<string | null>): Item[] {
  return starts.map((iso, index) => ({
    id: `item-${index}`,
    start: iso ? at(iso) : null,
  }));
}

describe("churchDayFor", () => {
  it("names the day in the church's time zone, not the server's", () => {
    // 01:30 UTC on 1 December is still the evening of 30 November in New York.
    const day = churchDayFor(at("2026-12-01T01:30:00.000Z"), TZ);
    expect(day.key).toBe("2026-11-30");
    expect(day.weekday).toBe("Monday");
    expect(day.day).toBe(30);
    expect(day.month).toBe("November");
    expect(day.year).toBe(2026);
  });

  it("keeps a noon instant on its own civil day", () => {
    const day = churchDayFor(at("2026-12-01T17:00:00.000Z"), TZ);
    expect(day.key).toBe("2026-12-01");
    expect(day.weekday).toBe("Tuesday");
    expect(day.month).toBe("December");
  });
});

describe("groupByChurchDay", () => {
  it("puts each time under one day and keeps calendar order", () => {
    const input = items(
      "2026-12-05T15:00:00.000Z", // Saturday
      "2026-12-01T15:00:00.000Z", // Tuesday
      "2026-12-01T19:00:00.000Z", // Tuesday, later
    );
    const grouped = groupByChurchDay(input, (item) => item.start, TZ);

    expect(grouped.groups.map((group) => group.day.key)).toEqual([
      "2026-12-01",
      "2026-12-05",
    ]);
    expect(grouped.groups[0]?.items.map((item) => item.id)).toEqual([
      "item-1",
      "item-2",
    ]);
    expect(grouped.groups[1]?.items.map((item) => item.id)).toEqual(["item-0"]);

    const seen = grouped.groups.flatMap((group) => group.items);
    expect(seen).toHaveLength(input.length);
    expect(new Set(seen).size).toBe(input.length);
  });

  it("keeps a time with no window out of every day", () => {
    const grouped = groupByChurchDay(
      items("2026-12-01T15:00:00.000Z", null),
      (item) => item.start,
      TZ,
    );
    expect(grouped.groups).toHaveLength(1);
    expect(grouped.undated.map((item) => item.id)).toEqual(["item-1"]);
  });

  it("counts only the days a reader would see", () => {
    const oneDay = groupByChurchDay(
      items("2026-12-01T15:00:00.000Z", "2026-12-01T19:00:00.000Z"),
      (item) => item.start,
      TZ,
    );
    expect(dayGroupCount(oneDay)).toBe(1);

    const twoDays = groupByChurchDay(
      items("2026-12-01T15:00:00.000Z", "2026-12-02T15:00:00.000Z"),
      (item) => item.start,
      TZ,
    );
    expect(dayGroupCount(twoDays)).toBe(2);

    const withUndated = groupByChurchDay(
      items("2026-12-01T15:00:00.000Z", null),
      (item) => item.start,
      TZ,
    );
    expect(dayGroupCount(withUndated)).toBe(2);
  });

  it("returns an empty result for an empty list", () => {
    const grouped = groupByChurchDay<Item>([], (item) => item.start, TZ);
    expect(grouped.groups).toEqual([]);
    expect(grouped.undated).toEqual([]);
    expect(dayGroupCount(grouped)).toBe(0);
  });
});

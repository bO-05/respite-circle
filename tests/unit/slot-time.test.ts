import { describe, expect, it } from "vitest";
import { slotHasStarted, slotStatusAt } from "../../src/server/domain/slot-time";

/**
 * VAL-R2PROM-001 on the pure clock rule.
 *
 * A published time is offered only until it starts. The rule is derived from
 * the clock at read time, never written by a page render: the board query and
 * the claim statement both compare `window_start` with `now`, and the desk
 * presents an `open` row past its start as `started` so its own status cannot
 * contradict the board.
 *
 * Both sides of one boundary are pinned here: one millisecond before the start
 * the time is offerable, and at the start — the exact instant, "at or before
 * now" — it is not. No test date is a weekday guess; the boundary is an ISO
 * instant.
 */

const START = new Date("2027-03-02T15:00:00.000Z");
const ONE_MS_BEFORE = new Date(START.getTime() - 1);
const ONE_MS_AFTER = new Date(START.getTime() + 1);

const STORED_STATUSES = [
  "draft",
  "open",
  "claimed",
  "covered",
  "done",
  "cancelled",
  "expired_unclaimed",
] as const;

describe("VAL-R2PROM-001 — a started time is never offerable", () => {
  it("is offerable one millisecond before its start and started at the start", () => {
    expect(slotHasStarted(START, ONE_MS_BEFORE)).toBe(false);
    // "at or before now" — the start instant itself is no longer offered.
    expect(slotHasStarted(START, START)).toBe(true);
    expect(slotHasStarted(START, ONE_MS_AFTER)).toBe(true);
  });

  it("treats a row with no window as offerable, because it has no start to pass", () => {
    expect(slotHasStarted(null, START)).toBe(false);
    expect(slotStatusAt("open", null, START)).toBe("open");
  });

  it("presents only an open row past its start as started", () => {
    for (const status of STORED_STATUSES) {
      const presented = slotStatusAt(status, START, START);
      if (status === "open") {
        expect(presented).toBe("started");
      } else {
        // A claimed, covered, done or closed row keeps its own word: those
        // statuses do not offer anything, so passing the start cannot make
        // them untrue.
        expect(presented).toBe(status);
      }
    }
  });

  it("leaves an open row before its start exactly as open", () => {
    expect(slotStatusAt("open", START, ONE_MS_BEFORE)).toBe("open");
  });

  it("does not resurrect an already closed row when its start passes", () => {
    for (const status of [
      "draft",
      "claimed",
      "covered",
      "done",
      "cancelled",
      "expired_unclaimed",
    ] as const) {
      expect(slotStatusAt(status, START, ONE_MS_AFTER)).toBe(status);
    }
  });
});

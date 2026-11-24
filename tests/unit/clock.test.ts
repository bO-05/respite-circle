import { describe, expect, it } from "vitest";
import { FAKE_NOW_ENV, resolveNow } from "@/lib/clock";

/**
 * `resolveNow` is the one clock the seed, the desk calendar, and slot
 * construction read. The env switch must be explicit, parse only a real
 * instant, and never silently freeze time at `Invalid Date`.
 */
describe("resolveNow", () => {
  const wallClock = new Date("2026-11-25T12:00:00.000Z");

  it("is the wall clock when RC_FAKE_NOW is unset or blank", () => {
    expect(resolveNow({}, wallClock)).toEqual(wallClock);
    expect(resolveNow({ [FAKE_NOW_ENV]: "" }, wallClock)).toEqual(wallClock);
    expect(resolveNow({ [FAKE_NOW_ENV]: "   " }, wallClock)).toEqual(wallClock);
  });

  it("reads an ISO instant from RC_FAKE_NOW", () => {
    expect(
      resolveNow({ [FAKE_NOW_ENV]: "2027-01-05T14:00:00.000Z" }, wallClock),
    ).toEqual(new Date("2027-01-05T14:00:00.000Z"));
  });

  it("ignores a value that is not a date", () => {
    expect(
      resolveNow({ [FAKE_NOW_ENV]: "next Tuesday" }, wallClock),
    ).toEqual(wallClock);
  });

  it("names the published switch", () => {
    expect(FAKE_NOW_ENV).toBe("RC_FAKE_NOW");
  });
});

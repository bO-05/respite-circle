/**
 * One clock for the parts of the app that plan a calendar.
 *
 * The seeded Respite Mornings, the construction guard, and the demo reset must
 * agree about which Tuesdays are ahead. If each read the wall clock on its own,
 * a fixture seeded last week could offer a companion place for a morning the
 * guard no longer counts. `resolveNow` is the single reader they share.
 *
 * `RC_FAKE_NOW` is a test and local-demo switch: set it to an ISO instant and
 * the seed, the desk calendar, and slot construction all see that instant, so a
 * later run date can be simulated without moving the machine's clock. It is
 * never set in Vercel. Unset (the default), the helper is a plain `new Date()`.
 * An unparseable value is ignored rather than freezing time at `Invalid Date`.
 */

export const FAKE_NOW_ENV = "RC_FAKE_NOW";

export type ClockEnv = Record<string, string | undefined>;

/**
 * The instant the app should treat as "now".
 *
 * `wallClock` is injected only so tests can prove the fallback; production
 * callers never pass it.
 */
export function resolveNow(
  env: ClockEnv = process.env,
  wallClock: Date = new Date(),
): Date {
  const raw = (env[FAKE_NOW_ENV] ?? "").trim();
  if (!raw) return wallClock;

  const simulated = new Date(raw);
  return Number.isNaN(simulated.getTime()) ? wallClock : simulated;
}

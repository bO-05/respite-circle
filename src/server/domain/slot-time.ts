/**
 * When a time stops being offered.
 *
 * A published time is offered only until it starts. After that instant the app
 * must not list it as a time anyone can take, and the claim statement must
 * refuse it even for a perfectly eligible volunteer.
 *
 * The stored row keeps its own status. `open` means "published and nobody has
 * said yes", which stays true after the start; only a person closing the time
 * (`expireSlotUnclaimed`, with its absence proof and its call promise) may turn
 * it into `expired_unclaimed`. So the rule is derived from the clock at read
 * time instead of written by a page render:
 *
 *   - the board query filters `window_start > now` in SQL
 *     (`src/server/repositories/board.ts`);
 *   - the claim statement carries `window_start > now` inside its predicate
 *     (`src/server/repositories/claim-gate.ts`), so a forged request matches
 *     no row;
 *   - the desk presents an open row past its start as `started`
 *     (`slotStatusAt`), so the screen that shows a row's status cannot call it
 *     open while the board has stopped offering it.
 *
 * Nothing here writes, and nothing here resurrects a claim: a started time is
 * closed for taking, not reopened, and its row is still waiting for the
 * coordinator's call and deliberate closure.
 */

/** True when the time's start is at or before `now`. A null window never passes. */
export function slotHasStarted(
  windowStart: Date | null,
  now: Date,
): boolean {
  return windowStart !== null && windowStart.getTime() <= now.getTime();
}

export type StartedSlotStatus = "started";

/**
 * The status to show for a stored row at `now`.
 *
 * Only `open` can become `started`: it is the one status that offers a place.
 * Every other status already says what happened (draft, claimed, covered, done,
 * cancelled, closed unclaimed) and passing the start cannot make it untrue.
 */
export function slotStatusAt<T extends string>(
  status: T,
  windowStart: Date | null,
  now: Date,
): T | StartedSlotStatus {
  return status === "open" && slotHasStarted(windowStart, now)
    ? "started"
    : status;
}

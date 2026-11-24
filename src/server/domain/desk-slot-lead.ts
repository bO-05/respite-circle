/**
 * The lead sentence on `/desk/slot/[id]`.
 *
 * A coordinator opens this page from a queue or a coverage card, and the first
 * sentence tells them what they are looking at. That sentence therefore has to
 * follow the row's status. One hard-coded line — "A neighbour has said yes" —
 * was rendered for every state, so a published time nobody had taken and a
 * time that closed unclaimed both claimed a neighbour who had not said yes.
 * The closed state is the one that carries the absence proof, so the wrong
 * sentence landed exactly where the app's central promise is proved.
 *
 * Every branch is a fixed human sentence. Nothing here names a neighbour, a
 * family, or a count; the page supplies those separately.
 */

export const DESK_SLOT_LEAD_STATUSES = [
  "draft",
  "open",
  "claimed",
  "covered",
  "done",
  "cancelled",
  "expired_unclaimed",
] as const;

export type DeskSlotLeadStatus = (typeof DESK_SLOT_LEAD_STATUSES)[number];

export function isDeskSlotLeadStatus(
  value: string,
): value is DeskSlotLeadStatus {
  return (DESK_SLOT_LEAD_STATUSES as readonly string[]).includes(value);
}

/**
 * The one sentence the desk reads first, matched to what actually happened.
 *
 * `claimed` keeps its confirm/take-back wording because it is the only state
 * with that decision. `open` invites the coordinator to wait or to close the
 * time without a claim. `expired_unclaimed` says plainly that no one took it
 * and points at the proof below. `covered`, `done` and `cancelled` describe
 * the finished states without offering a claim action that is no longer there.
 */
export function deskSlotLead(status: DeskSlotLeadStatus): string {
  switch (status) {
    case "claimed":
      return "A neighbour has said yes. Confirm the claim, or take it back before the family hears anything.";
    case "open":
      return "Published and waiting. No one has taken it yet — wait for a neighbour, or close this time without a claim before the family hears anything.";
    case "expired_unclaimed":
      return "No one took this time. It closed without a claim, and the family was sent nothing — the absence proof is below.";
    case "covered":
      return "A neighbour said yes, and you confirmed it with the family. The family has their one message; this time is covered.";
    case "done":
      return "This time is done. The visit is finished, and the family's one confirmation stays on their own page.";
    case "cancelled":
      return "The church cancelled this time. Nothing is sent to the family from this screen.";
    case "draft":
      return "This time is not published yet. No neighbour can see it or say yes until it goes on the board.";
  }
}

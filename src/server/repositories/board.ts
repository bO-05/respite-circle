import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as appDb } from "@/db/client";
import { resolveNow } from "@/lib/clock";
import {
  church,
  person,
  slot,
  slotKindEnum,
  slotStatusEnum,
  slotTierEnum,
} from "@/db/schema";
import { BOARD_ROLES, requireRoleSession, type Actor } from "@/server/auth/policy";
import type { AppDatabase } from "./coordinator";
import {
  readGatingRows,
  readViewerFacts,
  verdictFor,
  type ClaimVerdict,
  type GatingRow,
} from "./gating-facts";

/**
 * The congregation board's read.
 *
 * This is an explicit allow-list. It selects the slot's own kind, label,
 * window, gated flag, session id, the visible approval line, and — for a
 * volunteer viewing an open time — one plain eligibility verdict. There is
 * deliberately no join in the *returned* projection to `ask`, `caregiver`,
 * `care_recipient`, `ask_revision`, `decision`, `orientation_note`, or any
 * clinical field: a neighbour sees a time, never a story.
 *
 * Two published statuses are visible: `open` and the calm states `claimed` and
 * `covered`. `draft` is absent from the status filter, and an open row must
 * also carry an approval instant, so a row that somehow held `open` without
 * passing through `canPublishDraft` still cannot reach a neighbour.
 *
 * A time is offered only until it starts. Every visible status is filtered by
 * `window_start > now` (a row with no window has no start to pass), so a time
 * whose start has arrived is never listed as something a family can take. The
 * clock is `resolveNow()`, the app's one reader, so `RC_FAKE_NOW` moves this
 * boundary in tests and in a demo without moving the machine's clock. The row's
 * stored status is left alone: closing a
 * started time is the coordinator's deliberate `expireSlotUnclaimed`, which
 * writes the absence proof and honours the call promise. A read must never
 * counterfeit that transition.
 *
 * The gating facts are read in a second query that is never serialised to the
 * client. It is used only to answer "can this viewer take this time?" with the
 * same `canClaim` function the coordinator's exclusion panel and the future
 * claim route use, so the lock reason on the board cannot drift from the
 * enforcement.
 */

export type BoardSlotStatus = (typeof slotStatusEnum.enumValues)[number];
export type BoardSlotKind = (typeof slotKindEnum.enumValues)[number];
export type BoardSlotTier = (typeof slotTierEnum.enumValues)[number];

/** Exactly the statuses a volunteer may see. `draft` is not one of them. */
export const BOARD_VISIBLE_STATUSES = ["open", "claimed", "covered"] as const;

/** A refusal reason shown on an open time, or a plain yes. */
export type BoardClaim = ClaimVerdict;

export type BoardSlot = {
  id: string;
  kind: BoardSlotKind;
  tier: BoardSlotTier;
  label: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  gated: boolean;
  sessionId: string | null;
  status: "open" | "claimed" | "covered";
  approvedAt: Date | null;
  approvedByName: string | null;
  /**
   * How the time reached the board. `auto_low_risk` means the signed policy's
   * switch published a meal; the card labels it instead of naming a person who
   * never approved it.
   */
  publishedVia: "coordinator" | "auto_low_risk";
  /**
   * The one claim action's state. `null` means no claim action: the time is
   * already claimed or covered, or the viewer is the desk team rather than a
   * neighbour. Only an open, published time gets a verdict.
   */
  claim: BoardClaim | null;
};

export type BoardView = {
  timeZone: string;
  /** The named human who confirms a claim. A human name, never an id. */
  coordinatorFirstName: string | null;
  slots: BoardSlot[];
};

export async function getBoard(
  actor: Actor,
  database: AppDatabase = appDb,
  now: Date = resolveNow(),
): Promise<BoardView | null> {
  requireRoleSession(actor, BOARD_ROLES);

  const approver = alias(person, "board_approver");
  const isVolunteer = actor.role === "volunteer";

  const [churchRows, coordinatorRows, slotRows, viewerFacts, gatingRows] =
    await Promise.all([
      database
        .select({ timeZone: church.timezone })
        .from(church)
        .where(eq(church.id, actor.churchId))
        .limit(1),
      database
        .select({ firstName: person.firstName })
        .from(person)
        .where(
          and(
            eq(person.churchId, actor.churchId),
            eq(person.active, true),
            sql`${person.roles} @> '["coordinator"]'::jsonb`,
          ),
        )
        .orderBy(asc(person.createdAt), asc(person.id))
        .limit(1),
      database
        .select({
          id: slot.id,
          kind: slot.kind,
          tier: slot.tier,
          label: slot.label,
          windowStart: slot.windowStart,
          windowEnd: slot.windowEnd,
          gated: slot.gated,
          sessionId: slot.sessionId,
          status: slot.status,
          approvedAt: slot.approvedAt,
          approvedByName: approver.firstName,
          publishedVia: slot.publishedVia,
        })
        .from(slot)
        .leftJoin(approver, eq(approver.id, slot.approvedBy))
        .where(
          and(
            eq(slot.churchId, actor.churchId),
            inArray(slot.status, [...BOARD_VISIBLE_STATUSES]),
            // Open means published by a person, not merely marked open.
            isNotNull(slot.approvedAt),
            // A time that has started is no longer offered. A row with no
            // window has no start to pass and stays visible.
            or(isNull(slot.windowStart), gt(slot.windowStart, now)),
          ),
        )
        .orderBy(asc(slot.windowStart), asc(slot.id)),
      isVolunteer ? readViewerFacts(database, actor) : Promise.resolve(null),
      // The gate needs the family and policy behind each open row. This read is
      // internal: the ids, the recipient, and the caregiver never leave this
      // function or reach the rendered payload.
      isVolunteer
        ? readGatingRows(database, actor.churchId)
        : Promise.resolve([] as GatingRow[]),
    ]);

  const timeZone = churchRows[0]?.timeZone;
  if (!timeZone) return null;

  const gatingById = new Map(gatingRows.map((row) => [row.id, row]));
  const coordinatorFirstName = coordinatorRows[0]?.firstName ?? null;

  return {
    timeZone,
    coordinatorFirstName,
    slots: slotRows.map((row) => {
      const status = row.status as BoardSlot["status"];
      const gatingRow = gatingById.get(row.id);

      return {
        ...row,
        kind: row.kind as BoardSlotKind,
        tier: row.tier as BoardSlotTier,
        status,
        claim:
          isVolunteer && status === "open" && gatingRow
            ? verdictFor(viewerFacts, gatingRow, timeZone, now)
            : null,
      };
    }),
  };
}

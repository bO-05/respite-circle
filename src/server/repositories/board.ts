import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as appDb } from "@/db/client";
import { church, person, slot, slotKindEnum, slotStatusEnum, slotTierEnum } from "@/db/schema";
import { BOARD_ROLES, requireRoleSession, type Actor } from "@/server/auth/policy";
import type { AppDatabase } from "./coordinator";

/**
 * The congregation board's read.
 *
 * This is an explicit allow-list. It selects the slot's own kind, label,
 * window, gated flag, session id, the visible approval line, and nothing else.
 * There is deliberately no join to `ask`, `caregiver`, `care_recipient`,
 * `ask_revision`, or `decision`: a neighbour sees a time, never a story.
 *
 * Only published times are selected. `draft` is absent from the status filter,
 * so an unapproved ask can never leak a proposed time onto the board even if a
 * caller asks for it.
 */

export type BoardSlotStatus = (typeof slotStatusEnum.enumValues)[number];
export type BoardSlotKind = (typeof slotKindEnum.enumValues)[number];
export type BoardSlotTier = (typeof slotTierEnum.enumValues)[number];

/** Exactly the statuses a volunteer may see. `draft` is not one of them. */
export const BOARD_VISIBLE_STATUSES = ["open", "claimed", "covered"] as const;

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
};

export type BoardView = {
  timeZone: string;
  slots: BoardSlot[];
};

export async function getBoard(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<BoardView | null> {
  requireRoleSession(actor, BOARD_ROLES);

  const approver = alias(person, "board_approver");

  const [churchRows, slotRows] = await Promise.all([
    database
      .select({ timeZone: church.timezone })
      .from(church)
      .where(eq(church.id, actor.churchId))
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
      })
      .from(slot)
      .leftJoin(approver, eq(approver.id, slot.approvedBy))
      .where(
        and(
          eq(slot.churchId, actor.churchId),
          inArray(slot.status, [...BOARD_VISIBLE_STATUSES]),
        ),
      )
      .orderBy(asc(slot.windowStart), asc(slot.id)),
  ]);

  const timeZone = churchRows[0]?.timeZone;
  if (!timeZone) return null;

  return {
    timeZone,
    slots: slotRows.map((row) => ({
      ...row,
      kind: row.kind as BoardSlotKind,
      tier: row.tier as BoardSlotTier,
      status: row.status as BoardSlot["status"],
    })),
  };
}

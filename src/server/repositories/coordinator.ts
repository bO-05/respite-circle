import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { db as appDb } from "@/db/client";
import {
  ask,
  askStatusEnum,
  careRecipient,
  person,
  slot,
  slotKindEnum,
  slotStatusEnum,
} from "@/db/schema";
import {
  assertSameChurch,
  DESK_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";

/**
 * Coordinator-scoped reads.
 *
 * Every function takes the resolved session, checks the desk role, and filters
 * by `session.churchId`. An id from another church returns null, so a direct
 * URL or a hand-edited request behaves exactly like a missing row.
 *
 * Projections are explicit allow-lists: the caregiver's verbatim words and the
 * orientation note are deliberately absent from these foundation reads.
 */

export type AppDatabase = PostgresJsDatabase<typeof import("@/db/schema")>;

export type DeskAskStatus = (typeof askStatusEnum.enumValues)[number];
export type DeskSlotStatus = (typeof slotStatusEnum.enumValues)[number];
export type DeskSlotKind = (typeof slotKindEnum.enumValues)[number];

export type DeskAskSummary = {
  id: string;
  status: DeskAskStatus;
  createdAt: Date;
  caregiverFirstName: string;
  careRecipientFirstName: string;
};

export type DeskSlotSummary = {
  id: string;
  askId: string;
  status: DeskSlotStatus;
  kind: DeskSlotKind;
  label: string;
  gated: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
};

const DESK_QUEUE_STATUSES = [
  "waiting_coordinator",
  "safety_hold",
  "care_hold",
] as const;

/** The asks a coordinator or deputy may act on in their own church. */
export async function listDeskAsks(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<DeskAskSummary[]> {
  requireRoleSession(actor, DESK_ROLES);

  return database
    .select({
      id: ask.id,
      status: ask.status,
      createdAt: ask.createdAt,
      caregiverFirstName: person.firstName,
      careRecipientFirstName: careRecipient.firstName,
    })
    .from(ask)
    .innerJoin(person, eq(person.id, ask.caregiverId))
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .where(
      and(
        eq(ask.churchId, actor.churchId),
        inArray(ask.status, [...DESK_QUEUE_STATUSES]),
      ),
    )
    .orderBy(ask.createdAt);
}

/** One ask, only if it belongs to the actor's church. */
export async function getDeskAsk(
  actor: Actor,
  askId: string,
  database: AppDatabase = appDb,
): Promise<DeskAskSummary | null> {
  requireRoleSession(actor, DESK_ROLES);

  const rows = await database
    .select({
      id: ask.id,
      status: ask.status,
      createdAt: ask.createdAt,
      caregiverFirstName: person.firstName,
      careRecipientFirstName: careRecipient.firstName,
    })
    .from(ask)
    .innerJoin(person, eq(person.id, ask.caregiverId))
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .where(and(eq(ask.id, askId), eq(ask.churchId, actor.churchId)))
    .limit(1);

  return rows[0] ?? null;
}

/** One slot, only if it belongs to the actor's church. */
export async function getDeskSlot(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
): Promise<DeskSlotSummary | null> {
  requireRoleSession(actor, DESK_ROLES);

  const rows = await database
    .select({
      id: slot.id,
      askId: slot.askId,
      status: slot.status,
      kind: slot.kind,
      label: slot.label,
      gated: slot.gated,
      windowStart: slot.windowStart,
      windowEnd: slot.windowEnd,
    })
    .from(slot)
    .where(and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Reusable write-side scope check. A later approval/claim action calls this
 * before its conditional UPDATE so the church predicate is not forgotten.
 */
export function assertDeskChurchScope(actor: Actor, churchId: string): void {
  requireRoleSession(actor, DESK_ROLES);
  assertSameChurch(actor, churchId);
}

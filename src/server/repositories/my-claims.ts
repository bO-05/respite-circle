import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import {
  auditEvent,
  church,
  person,
  slot,
  slotKindEnum,
  slotTierEnum,
} from "@/db/schema";
import {
  CLAIMS_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import { isUuid } from "@/server/domain/claim";
import {
  canCheckIn,
  canCheckOut,
  canMarkDone,
  doneFlashMessage,
  isMyClaimStatus,
  isVisitAction,
  MY_CLAIM_STATUSES,
  noteIsVisible,
  NOTE_REVEAL_STATUSES,
  visitFlashMessage,
  type DoneRefusalCode,
  type MyClaimStatus,
  type VisitAction,
  type VisitFacts,
  type VisitRefusalCode,
} from "@/server/domain/my-claims";
import type { AppDatabase } from "./coordinator";

/**
 * A volunteer's own claims — the read and the two write paths.
 *
 * Privacy is structural:
 *
 *   - the list query selects an explicit allow-list and never mentions
 *     `orientation_note`;
 *   - the detail's first query also never mentions it;
 *   - a second, separate query reads the note only when the claim's status is
 *     `covered` or `done`, and carries the claimer's own `claimed_by` predicate.
 *
 * So before coordinator approval the note is not merely hidden by the page — it
 * is never selected for this volunteer at all. Another volunteer changing the id
 * in the URL gets `null`, which the page renders as not-found. A caregiver or a
 * coordinator is refused by `requireRoleSession` before a query runs.
 */

export type MyClaimKind = (typeof slotKindEnum.enumValues)[number];
export type MyClaimTier = (typeof slotTierEnum.enumValues)[number];

export type MyClaimSummary = {
  id: string;
  kind: MyClaimKind;
  tier: MyClaimTier;
  label: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  gated: boolean;
  status: MyClaimStatus;
  claimedAt: Date | null;
};

export type MyClaimList = {
  timeZone: string;
  coordinatorFirstName: string | null;
  claims: MyClaimSummary[];
};

export type MyClaimDetail = MyClaimSummary & {
  /** True only for `covered` and `done`; mirrors `noteIsVisible`. */
  noteVisible: boolean;
  /** Null whenever the predicate is closed, and null when no note exists. */
  orientationNote: string | null;
  visit: VisitFacts;
  timeZone: string;
  coordinatorFirstName: string | null;
};

async function readChurchTimeZone(
  churchId: string,
  database: AppDatabase,
): Promise<string | null> {
  const rows = await database
    .select({ timeZone: church.timezone })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);

  return rows[0]?.timeZone ?? null;
}

async function readCoordinatorFirstName(
  churchId: string,
  database: AppDatabase,
): Promise<string | null> {
  const rows = await database
    .select({ firstName: person.firstName })
    .from(person)
    .where(
      and(
        eq(person.churchId, churchId),
        eq(person.active, true),
        sql`${person.roles} @> '["coordinator"]'::jsonb`,
      ),
    )
    .orderBy(asc(person.createdAt), asc(person.id))
    .limit(1);

  return rows[0]?.firstName ?? null;
}

async function readVisitFacts(
  actor: Actor,
  slotId: string,
  database: AppDatabase,
): Promise<VisitFacts> {
  const rows = await database
    .select({ action: auditEvent.action, createdAt: auditEvent.createdAt })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.churchId, actor.churchId),
        eq(auditEvent.entity, "slot"),
        eq(auditEvent.entityId, slotId),
        eq(auditEvent.actorId, actor.personId),
        inArray(auditEvent.action, ["slot_checked_in", "slot_checked_out"]),
      ),
    )
    .orderBy(asc(auditEvent.createdAt));

  const checkedIn = rows.find((row) => row.action === "slot_checked_in");
  const checkedOut = rows.find((row) => row.action === "slot_checked_out");

  return {
    checkedInAt: checkedIn?.createdAt ?? null,
    checkedOutAt: checkedOut?.createdAt ?? null,
  };
}

/**
 * The volunteer's own list. No note column is selected, no ask is joined, and
 * the status allow-list excludes drafts and open times.
 */
export async function listMyClaims(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<MyClaimList> {
  requireRoleSession(actor, CLAIMS_ROLES);

  const [rows, coordinatorFirstName, timeZone] = await Promise.all([
    database
      .select({
        id: slot.id,
        kind: slot.kind,
        tier: slot.tier,
        label: slot.label,
        windowStart: slot.windowStart,
        windowEnd: slot.windowEnd,
        gated: slot.gated,
        status: slot.status,
        claimedAt: slot.claimedAt,
      })
      .from(slot)
      .where(
        and(
          eq(slot.churchId, actor.churchId),
          eq(slot.claimedBy, actor.personId),
          inArray(slot.status, [...MY_CLAIM_STATUSES]),
        ),
      )
      .orderBy(asc(slot.windowStart), asc(slot.id)),
    readCoordinatorFirstName(actor.churchId, database),
    readChurchTimeZone(actor.churchId, database),
  ]);

  if (!timeZone) {
    return { timeZone: "UTC", coordinatorFirstName, claims: [] };
  }

  const claims = rows
    .filter((row): row is typeof row & { status: MyClaimStatus } =>
      isMyClaimStatus(row.status),
    )
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      tier: row.tier,
      label: row.label,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
      gated: row.gated,
      status: row.status,
      claimedAt: row.claimedAt,
    }));

  return { timeZone, coordinatorFirstName, claims };
}

/**
 * One claim, owned by the signed-in volunteer. The note is a second read whose
 * WHERE clause carries both the ownership predicate and the status allow-list,
 * so the database never hands the note to a volunteer whose claim is still
 * waiting for confirmation.
 */
export async function getMyClaim(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
): Promise<MyClaimDetail | null> {
  requireRoleSession(actor, CLAIMS_ROLES);

  if (!isUuid(slotId)) return null;

  const [rows, coordinatorFirstName, timeZone] = await Promise.all([
    database
      .select({
        id: slot.id,
        kind: slot.kind,
        tier: slot.tier,
        label: slot.label,
        windowStart: slot.windowStart,
        windowEnd: slot.windowEnd,
        gated: slot.gated,
        status: slot.status,
        claimedAt: slot.claimedAt,
      })
      .from(slot)
      .where(
        and(
          eq(slot.id, slotId),
          eq(slot.churchId, actor.churchId),
          eq(slot.claimedBy, actor.personId),
          inArray(slot.status, [...MY_CLAIM_STATUSES]),
        ),
      )
      .limit(1),
    readCoordinatorFirstName(actor.churchId, database),
    readChurchTimeZone(actor.churchId, database),
  ]);

  const row = rows[0];
  if (!row || !isMyClaimStatus(row.status)) return null;

  const visible = noteIsVisible(row.status);

  const [noteRows, visit] = await Promise.all([
    visible
      ? database
          .select({ orientationNote: slot.orientationNote })
          .from(slot)
          .where(
            and(
              eq(slot.id, slotId),
              eq(slot.churchId, actor.churchId),
              eq(slot.claimedBy, actor.personId),
              inArray(slot.status, [...NOTE_REVEAL_STATUSES]),
            ),
          )
          .limit(1)
      : Promise.resolve([] as Array<{ orientationNote: string | null }>),
    row.kind === "home"
      ? readVisitFacts(actor, slotId, database)
      : Promise.resolve<VisitFacts>({ checkedInAt: null, checkedOutAt: null }),
  ]);

  return {
    id: row.id,
    kind: row.kind,
    tier: row.tier,
    label: row.label,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    gated: row.gated,
    status: row.status,
    claimedAt: row.claimedAt,
    noteVisible: visible,
    orientationNote: visible ? (noteRows[0]?.orientationNote ?? null) : null,
    visit,
    timeZone: timeZone ?? "UTC",
    coordinatorFirstName,
  };
}

async function auditVisit(
  database: AppDatabase,
  actor: Actor,
  slotId: string,
  action: string,
  detail: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await database.insert(auditEvent).values({
    churchId: actor.churchId,
    actorType: "human",
    actorId: actor.personId,
    action,
    entity: "slot",
    entityId: slotId,
    detail,
    createdAt: now,
  });
}

export type VisitOutcome =
  | {
      ok: true;
      code: "checked_in" | "checked_out";
      message: string;
      checkedInAt: Date;
      checkedOutAt: Date | null;
    }
  | { ok: false; code: VisitRefusalCode; message: string };

function visitRefusal(code: VisitRefusalCode) {
  return {
    ok: false as const,
    code,
    message: visitFlashMessage(code, null),
  };
}

/**
 * Check in or out of a confirmed home visit. One conditional transaction holds
 * the slot row, re-reads the claimer's own checkpoints, applies the pure
 * predicate, and writes the append-only audit row. A repeated action is a calm
 * refusal, never a second audit row.
 */
export async function recordVisitCheckpoint(
  actor: Actor,
  slotId: string,
  action: VisitAction,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<VisitOutcome> {
  requireRoleSession(actor, CLAIMS_ROLES);

  if (!isUuid(slotId) || !isVisitAction(action)) {
    return visitRefusal("not_found");
  }

  return database.transaction(async (tx): Promise<VisitOutcome> => {
    const [target] = await tx
      .select({
        id: slot.id,
        kind: slot.kind,
        status: slot.status,
      })
      .from(slot)
      .where(
        and(
          eq(slot.id, slotId),
          eq(slot.churchId, actor.churchId),
          eq(slot.claimedBy, actor.personId),
        ),
      )
      .limit(1)
      .for("update");

    if (!target) return visitRefusal("not_found");

    const visit = await readVisitFacts(actor, slotId, tx);
    const input = { kind: target.kind, status: target.status, visit };
    const check =
      action === "check_in" ? canCheckIn(input) : canCheckOut(input);

    if (!check.ok) {
      await auditVisit(tx, actor, slotId, "visit_refused", {
        action,
        reason: check.code,
        slotStatus: target.status,
        at: now.toISOString(),
      }, now);
      return { ok: false, code: check.code, message: check.message };
    }

    const auditAction =
      action === "check_in" ? "slot_checked_in" : "slot_checked_out";

    await auditVisit(tx, actor, slotId, auditAction, {
      at: now.toISOString(),
      kind: target.kind,
      previousStatus: target.status,
    }, now);

    return {
      ok: true,
      code: action === "check_in" ? "checked_in" : "checked_out",
      message: visitFlashMessage(
        action === "check_in" ? "checked_in" : "checked_out",
        null,
      ),
      checkedInAt: action === "check_in" ? now : visit.checkedInAt ?? now,
      checkedOutAt: action === "check_out" ? now : null,
    };
  });
}

export type DoneOutcome =
  | { ok: true; code: "done"; message: string }
  | { ok: false; code: DoneRefusalCode; message: string };

/**
 * Mark a confirmed claim done, only after its window, with an audit row in the
 * same transaction. Another volunteer's id finds no row and writes nothing.
 */
export async function markClaimDone(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<DoneOutcome> {
  requireRoleSession(actor, CLAIMS_ROLES);

  if (!isUuid(slotId)) {
    return {
      ok: false,
      code: "not_found",
      message: doneFlashMessage("not_found", null),
    };
  }

  return database.transaction(async (tx): Promise<DoneOutcome> => {
    const [target] = await tx
      .select({
        id: slot.id,
        kind: slot.kind,
        status: slot.status,
        windowStart: slot.windowStart,
        windowEnd: slot.windowEnd,
      })
      .from(slot)
      .where(
        and(
          eq(slot.id, slotId),
          eq(slot.churchId, actor.churchId),
          eq(slot.claimedBy, actor.personId),
        ),
      )
      .limit(1)
      .for("update");

    if (!target) {
      return {
        ok: false,
        code: "not_found",
        message: doneFlashMessage("not_found", null),
      };
    }

    const check = canMarkDone(target, now);

    if (!check.ok) {
      await auditVisit(tx, actor, slotId, "claim_done_refused", {
        reason: check.code,
        slotStatus: target.status,
        at: now.toISOString(),
      }, now);
      return { ok: false, code: check.code, message: check.message };
    }

    const updated = await tx
      .update(slot)
      .set({ status: "done" })
      .where(
        and(
          eq(slot.id, slotId),
          eq(slot.churchId, actor.churchId),
          eq(slot.claimedBy, actor.personId),
          eq(slot.status, "covered"),
        ),
      )
      .returning({ id: slot.id });

    if (!updated[0]) {
      return {
        ok: false,
        code: "not_covered",
        message: doneFlashMessage("not_covered", null),
      };
    }

    await auditVisit(tx, actor, slotId, "slot_done", {
      at: now.toISOString(),
      kind: target.kind,
      previousStatus: "covered",
    }, now);

    return {
      ok: true,
      code: "done",
      message: doneFlashMessage("done", null),
    };
  });
}

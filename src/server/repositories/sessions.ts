import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as appDb } from "@/db/client";
import {
  ask,
  auditEvent,
  callLog,
  careRecipient,
  church,
  person,
  session,
  sessionTemplate,
  slot,
} from "@/db/schema";
import {
  DESK_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import {
  SESSIONS_AHEAD,
  buildSessionOverview,
  formatSessionDate,
  nextOccurrences,
  type CalendarSessionRow,
  type SessionOverview,
  type TemplateSchedule,
} from "@/server/domain/session-calendar";
import type { CalendarGuard, SessionOption } from "@/server/domain/slots";
import type { AppDatabase } from "./coordinator";

/**
 * The weekly Respite Morning calendar, coordinator-scoped.
 *
 * Reads re-derive the desk role and filter by church. The materialisation job
 * inserts only the occurrences the template expects and relies on the unique
 * `(template_id, starts_at)` index for idempotence: a second run, or two
 * concurrent runs, insert nothing twice.
 *
 * Cancelling a morning is one transaction. Every live slot on that morning
 * becomes `cancelled`, one coordinator call task is written per cancelled slot,
 * and no notification row is ever created. The caregiver is owed a human call,
 * not a message.
 */

const LIVE_SLOT_STATUSES = ["draft", "open", "claimed", "covered"] as const;

export type SessionCancelOutcome =
  | {
      ok: true;
      sessionId: string;
      cancelledSlotCount: number;
      callTaskCount: number;
      message: string;
    }
  | {
      ok: false;
      reason: "not_found" | "not_scheduled";
      message: string;
    };

export type SessionRestoreOutcome =
  | { ok: true; sessionId: string; message: string }
  | { ok: false; reason: "not_found" | "not_cancelled"; message: string };

export type CallTask = {
  slotId: string;
  askId: string;
  kind: string;
  slotLabel: string;
  previousStatus: string;
  caregiverFirstName: string;
  careRecipientFirstName: string;
  sessionId: string;
  sessionStartsAt: Date;
  createdAt: Date;
};

export type CallTaskOutcome =
  | { ok: true; slotId: string; message: string }
  | { ok: false; message: string };

export async function readChurchTimeZone(
  churchId: string,
  database: AppDatabase,
): Promise<string> {
  const rows = await database
    .select({ timezone: church.timezone })
    .from(church)
    .where(eq(church.id, churchId))
    .limit(1);

  return rows[0]?.timezone ?? "UTC";
}

/** The weekly templates, in the order the church created them. */
export async function listTemplateSchedules(
  churchId: string,
  database: AppDatabase = appDb,
  activeOnly = false,
): Promise<TemplateSchedule[]> {
  const rows = await database
    .select({
      id: sessionTemplate.id,
      weekday: sessionTemplate.weekday,
      startTime: sessionTemplate.startTime,
      endTime: sessionTemplate.endTime,
      capacity: sessionTemplate.capacity,
      active: sessionTemplate.active,
    })
    .from(sessionTemplate)
    .where(
      activeOnly
        ? and(
            eq(sessionTemplate.churchId, churchId),
            eq(sessionTemplate.active, true),
          )
        : eq(sessionTemplate.churchId, churchId),
    )
    .orderBy(asc(sessionTemplate.createdAt), asc(sessionTemplate.id));

  return rows.map((row) => ({
    id: row.id,
    weekday: row.weekday,
    startTime: row.startTime,
    endTime: row.endTime,
    capacity: row.capacity,
    active: row.active,
  }));
}

/**
 * Future sessions with the number of companion places that still hold a place.
 * A cancelled or expired companion place does not hold one.
 */
export async function listCalendarSessionRows(
  churchId: string,
  database: AppDatabase = appDb,
  from: Date = new Date(),
): Promise<CalendarSessionRow[]> {
  const rows = await database
    .select({
      id: session.id,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      capacity: session.capacity,
      status: session.status,
      usedCompanionPlaces: sql<number>`(
        SELECT COUNT(*)::int
          FROM slot AS used
         WHERE used.session_id = "session"."id"
           AND used.kind = 'companion'
           AND used.status IN ('draft','open','claimed','covered','done')
      )`,
    })
    .from(session)
    .where(and(eq(session.churchId, churchId), gt(session.startsAt, from)))
    .orderBy(asc(session.startsAt))
    .limit(50);

  return rows.map((row) => ({
    id: row.id,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    capacity: row.capacity,
    status: row.status as CalendarSessionRow["status"],
    usedCompanionPlaces: Number(row.usedCompanionPlaces ?? 0),
  }));
}

/**
 * The desk-safe view of the calendar: template, planned Tuesdays, capacity,
 * and the banner copy when fewer than four future mornings exist.
 */
export async function getDeskSessionOverview(
  actor: Actor,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<SessionOverview> {
  requireRoleSession(actor, DESK_ROLES);

  const [schedules, sessions, timeZone] = await Promise.all([
    listTemplateSchedules(actor.churchId, database),
    listCalendarSessionRows(actor.churchId, database, now),
    readChurchTimeZone(actor.churchId, database),
  ]);

  return buildSessionOverview({
    schedules,
    sessions,
    now,
    timeZone,
  });
}

/**
 * The calendar guard for construction and manual additions. It reads the same
 * template and sessions the desk banner reads, so a refusal and the banner can
 * never name different weeks.
 */
export async function readCalendarGuard(
  churchId: string,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<CalendarGuard> {
  const [schedules, sessions, timeZone] = await Promise.all([
    listTemplateSchedules(churchId, database),
    listCalendarSessionRows(churchId, database, now),
    readChurchTimeZone(churchId, database),
  ]);

  return buildSessionOverview({
    schedules,
    sessions,
    now,
    timeZone,
  }).guard;
}

/** Build the guard from inputs a caller already loaded. */
export function calendarGuardFrom(
  schedules: readonly TemplateSchedule[],
  sessions: readonly SessionOption[],
  timeZone: string,
  now: Date,
): CalendarGuard {
  return buildSessionOverview({
    schedules,
    sessions: sessions.map((entry) => ({
      id: entry.id,
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      capacity: entry.capacity,
      status: entry.status,
      usedCompanionPlaces: entry.usedCompanionPlaces,
    })),
    now,
    timeZone,
  }).guard;
}

export type MaterialiseOutcome = {
  checked: number;
  inserted: number;
  timeZone: string;
};

/**
 * Fill the next four occurrences of every active template. The unique index on
 * `(template_id, starts_at)` is the idempotence guard; a second run inserts
 * zero rows and writes no audit noise.
 */
export async function materialiseSessionsForChurch(input: {
  churchId: string;
  database?: AppDatabase;
  now?: Date;
  actor?: Actor;
}): Promise<MaterialiseOutcome> {
  const database = input.database ?? appDb;
  const now = input.now ?? new Date();

  const [schedules, timeZone] = await Promise.all([
    listTemplateSchedules(input.churchId, database, true),
    readChurchTimeZone(input.churchId, database),
  ]);

  let checked = 0;
  let inserted = 0;
  const perTemplate: Array<{ templateId: string; checked: number; inserted: number }> = [];

  for (const schedule of schedules) {
    const occurrences = nextOccurrences(schedule, now, timeZone, SESSIONS_AHEAD);
    checked += occurrences.length;
    if (occurrences.length === 0) continue;

    const rows = await database
      .insert(session)
      .values(
        occurrences.map((occurrence) => ({
          churchId: input.churchId,
          templateId: schedule.id,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          capacity: schedule.capacity,
          status: "scheduled" as const,
        })),
      )
      .onConflictDoNothing({
        target: [session.templateId, session.startsAt],
      })
      .returning({ id: session.id });

    inserted += rows.length;
    perTemplate.push({
      templateId: schedule.id,
      checked: occurrences.length,
      inserted: rows.length,
    });
  }

  if (inserted > 0) {
    await database.insert(auditEvent).values({
      churchId: input.churchId,
      actorType: input.actor ? "human" : "system",
      actorId: input.actor?.personId ?? null,
      action: "sessions_materialised",
      entity: "session",
      entityId: null,
      detail: {
        checked,
        inserted,
        templates: perTemplate,
        target: SESSIONS_AHEAD,
      },
    });
  }

  return { checked, inserted, timeZone };
}

/**
 * Cancel one morning and every live place on it, then create one coordinator
 * call task per cancelled slot. The call tasks are append-only audit rows; a
 * call_log row later marks one done. No notification is written, for any slot
 * status.
 */
export async function cancelSessionForCoordinator(
  actor: Actor,
  sessionId: string,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<SessionCancelOutcome> {
  requireRoleSession(actor, DESK_ROLES);

  const timeZone = await readChurchTimeZone(actor.churchId, database);

  return database.transaction(async (tx): Promise<SessionCancelOutcome> => {
    const [locked] = await tx
      .select({
        id: session.id,
        status: session.status,
        startsAt: session.startsAt,
        templateId: session.templateId,
      })
      .from(session)
      .where(
        and(eq(session.id, sessionId), eq(session.churchId, actor.churchId)),
      )
      .limit(1)
      .for("update");

    if (!locked) {
      return {
        ok: false,
        reason: "not_found",
        message: "That Respite Morning is not available.",
      };
    }

    if (locked.status !== "scheduled") {
      return {
        ok: false,
        reason: "not_scheduled",
        message:
          locked.status === "cancelled"
            ? "That morning is already cancelled. Its call tasks are still on the desk."
            : "That morning has already happened. Nothing was cancelled.",
      };
    }

    const slots = await tx
      .select({
        id: slot.id,
        askId: slot.askId,
        kind: slot.kind,
        label: slot.label,
        status: slot.status,
      })
      .from(slot)
      .where(
        and(
          eq(slot.sessionId, sessionId),
          eq(slot.churchId, actor.churchId),
          inArray(slot.status, [...LIVE_SLOT_STATUSES]),
        ),
      )
      .orderBy(asc(slot.createdAt), asc(slot.id))
      .for("update");

    await tx
      .update(session)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(session.id, sessionId),
          eq(session.churchId, actor.churchId),
          eq(session.status, "scheduled"),
        ),
      );

    if (slots.length > 0) {
      await tx
        .update(slot)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(slot.churchId, actor.churchId),
            inArray(
              slot.id,
              slots.map((entry) => entry.id),
            ),
          ),
        );
    }

    await tx.insert(auditEvent).values([
      {
        churchId: actor.churchId,
        actorType: "human" as const,
        actorId: actor.personId,
        action: "session_cancelled",
        entity: "session",
        entityId: sessionId,
        detail: {
          templateId: locked.templateId,
          startsAt: locked.startsAt.toISOString(),
          cancelledSlotCount: slots.length,
          callTaskCount: slots.length,
          previousStatus: "scheduled",
          slotStatuses: slots.map((entry) => ({
            slotId: entry.id,
            status: entry.status,
          })),
        },
      },
      ...slots.map((entry) => ({
        churchId: actor.churchId,
        actorType: "human" as const,
        actorId: actor.personId,
        action: "call_task_created",
        entity: "slot",
        entityId: entry.id,
        detail: {
          sessionId,
          askId: entry.askId,
          kind: entry.kind,
          label: entry.label,
          previousStatus: entry.status,
          reason: "session_cancelled",
          startedAt: now.toISOString(),
        },
      })),
    ]);

    const label = formatSessionDate(locked.startsAt, timeZone);
    return {
      ok: true,
      sessionId,
      cancelledSlotCount: slots.length,
      callTaskCount: slots.length,
      message:
        slots.length === 0
          ? `${label} is cancelled. No place was open on it, so there is no call to make.`
          : `${label} is cancelled. ${slots.length === 1 ? "One place was cancelled" : `${slots.length} places were cancelled`}; ${slots.length === 1 ? "one call task is" : `${slots.length} call tasks are`} on the desk. The family was sent nothing.`,
    };
  });
}

/** Put a cancelled morning back on the calendar. Cancelled times stay cancelled. */
export async function restoreSessionForCoordinator(
  actor: Actor,
  sessionId: string,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<SessionRestoreOutcome> {
  requireRoleSession(actor, DESK_ROLES);

  const timeZone = await readChurchTimeZone(actor.churchId, database);

  return database.transaction(async (tx): Promise<SessionRestoreOutcome> => {
    const [locked] = await tx
      .select({
        id: session.id,
        status: session.status,
        startsAt: session.startsAt,
      })
      .from(session)
      .where(
        and(eq(session.id, sessionId), eq(session.churchId, actor.churchId)),
      )
      .limit(1)
      .for("update");

    if (!locked) {
      return {
        ok: false,
        reason: "not_found",
        message: "That Respite Morning is not available.",
      };
    }

    if (locked.status !== "cancelled") {
      return {
        ok: false,
        reason: "not_cancelled",
        message: "That morning is not cancelled, so there is nothing to restore.",
      };
    }

    await tx
      .update(session)
      .set({ status: "scheduled" })
      .where(
        and(
          eq(session.id, sessionId),
          eq(session.churchId, actor.churchId),
          eq(session.status, "cancelled"),
        ),
      );

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: "session_restored",
      entity: "session",
      entityId: sessionId,
      detail: {
        startsAt: locked.startsAt.toISOString(),
        restoredAt: now.toISOString(),
      },
    });

    const label = formatSessionDate(locked.startsAt, timeZone);
    return {
      ok: true,
      sessionId,
      message: `${label} is back on the calendar. The times cancelled earlier stay cancelled; a person decides what to re-offer.`,
    };
  });
}

/**
 * Coordinator call tasks created by a session cancellation, newest morning
 * first, excluding slots that already have a recorded call.
 */
export async function listCoordinatorCallTasks(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<CallTask[]> {
  requireRoleSession(actor, DESK_ROLES);

  const caregiverPerson = alias(person, "caregiver_person");

  const rows = await database
    .select({
      slotId: slot.id,
      askId: ask.id,
      kind: slot.kind,
      slotLabel: slot.label,
      previousStatus: sql<string>`${auditEvent.detail}->>'previousStatus'`,
      caregiverFirstName: caregiverPerson.firstName,
      careRecipientFirstName: careRecipient.firstName,
      sessionId: session.id,
      sessionStartsAt: session.startsAt,
      createdAt: auditEvent.createdAt,
    })
    .from(auditEvent)
    .innerJoin(slot, eq(slot.id, auditEvent.entityId))
    .innerJoin(ask, eq(ask.id, slot.askId))
    .innerJoin(caregiverPerson, eq(caregiverPerson.id, ask.caregiverId))
    .innerJoin(
      careRecipient,
      eq(careRecipient.id, ask.careRecipientId),
    )
    .innerJoin(session, eq(session.id, slot.sessionId))
    .where(
      and(
        eq(auditEvent.churchId, actor.churchId),
        eq(auditEvent.action, "call_task_created"),
        eq(slot.churchId, actor.churchId),
        eq(slot.status, "cancelled"),
        sql`NOT EXISTS (
          SELECT 1 FROM call_log AS already_called
           WHERE already_called.slot_id = ${slot.id}
        )`,
      ),
    )
    .orderBy(asc(session.startsAt), asc(caregiverPerson.firstName))
    .limit(50);

  return rows.map((row) => ({
    ...row,
    previousStatus: row.previousStatus ?? "open",
  }));
}

/** Record the coordinator's call for one cancelled place. */
export async function markCallTaskDone(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<CallTaskOutcome> {
  requireRoleSession(actor, DESK_ROLES);

  return database.transaction(async (tx): Promise<CallTaskOutcome> => {
    const [target] = await tx
      .select({
        id: slot.id,
        status: slot.status,
        askId: slot.askId,
      })
      .from(slot)
      .where(and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)))
      .limit(1)
      .for("update");

    if (!target) {
      return { ok: false, message: "That call task is not available." };
    }

    if (target.status !== "cancelled") {
      return {
        ok: false,
        message: "That place is not cancelled, so there is no call task to close.",
      };
    }

    const [task] = await tx
      .select({ id: auditEvent.id })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.churchId, actor.churchId),
          eq(auditEvent.action, "call_task_created"),
          eq(auditEvent.entity, "slot"),
          eq(auditEvent.entityId, slotId),
        ),
      )
      .limit(1);

    if (!task) {
      return { ok: false, message: "That call task is not available." };
    }

    const [existing] = await tx
      .select({ id: callLog.id })
      .from(callLog)
      .where(eq(callLog.slotId, slotId))
      .limit(1);

    if (existing) {
      return {
        ok: false,
        message: "A call is already recorded for that place.",
      };
    }

    await tx.insert(callLog).values({
      slotId,
      coordinatorId: actor.personId,
      outcome: "reached",
      note: "Marked called from the desk after a cancelled Respite Morning.",
      createdAt: now,
    });

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: "call_task_completed",
      entity: "slot",
      entityId: slotId,
      detail: { askId: target.askId, outcome: "reached" },
    });

    return { ok: true, slotId, message: "Call recorded. Thank you." };
  });
}

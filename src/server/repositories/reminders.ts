import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as appDb } from "@/db/client";
import {
  ask,
  auditEvent,
  careRecipient,
  church,
  notification,
  person,
  slot,
} from "@/db/schema";
import {
  CAREGIVER_ROLES,
  DESK_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import { isUuid } from "@/server/domain/claim";
import {
  DEFAULT_REMINDER_WINDOW_HOURS,
  canWriteReminder,
  reminderWindowOpensAt,
  renderReminder,
  type ReminderEligibility,
} from "@/server/domain/notifications";
import { getPolicyInForce } from "@/server/repositories/policy";
import type {
  AppDatabase,
  DeskSlotKind,
  DeskSlotStatus,
} from "./coordinator";

/**
 * The one reminder for a covered time, and the caregiver's own outbox.
 *
 * Three reads and one write:
 *
 *   - the desk's preview of the exact sentence the family will read, whether
 *     the reminder window is open, and whether the one row already exists;
 *   - the caregiver's own reminder rows, scoped to `caregiver_id`;
 *   - `writeReminder`, which locks the slot, re-checks every condition, and
 *     inserts at most one row from the human template.
 *
 * The database backs the rules: `notification_requires_covered_slot` refuses a
 * caregiver row for any other state, and `notification_slot_kind_uidx` allows
 * one confirmation and one reminder — two messages, never a third. This module
 * is the only write path, and it never composes text from model output.
 */

export type ReminderRow = {
  id: string;
  body: string;
  templateCode: string;
  createdAt: Date;
};

export type DeskSlotReminder = {
  slotId: string;
  status: DeskSlotStatus;
  kind: DeskSlotKind;
  label: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  timeZone: string;
  reminderWindowHours: number;
  /** When the one reminder becomes writable; null without a window. */
  windowOpensAt: Date | null;
  /** The exact body a person would store, or null when no template exists. */
  preview: { templateCode: string; body: string } | null;
  existing: ReminderRow | null;
  eligibility: ReminderEligibility;
};

export type CaregiverReminder = {
  id: string;
  slotId: string;
  body: string;
  templateCode: string;
  createdAt: Date;
  kind: DeskSlotKind;
  label: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  timeZone: string;
};

export type ReminderOutcomeCode =
  | "not_found"
  | "no_template"
  | "not_covered"
  | "no_window"
  | "past"
  | "too_early"
  | "missing_confirmation"
  | "already_written";

export type ReminderOutcome =
  | {
      ok: true;
      slotId: string;
      created: boolean;
      notificationId: string | null;
      body: string;
      templateCode: string;
      message: string;
    }
  | { ok: false; code: ReminderOutcomeCode; message: string };

export const REMINDER_AUDIT_ACTIONS = {
  written: "reminder_written",
  refused: "reminder_refused",
} as const;

export const REMINDER_WRITTEN_MESSAGE =
  "The reminder is on the family's page. It is the only one they will receive.";

export const REMINDER_ALREADY_WRITTEN_MESSAGE =
  "This family already has their one reminder. Nothing more was sent.";

function refusal(
  code: ReminderOutcomeCode,
  message: string,
): { ok: false; code: ReminderOutcomeCode; message: string } {
  return { ok: false, code, message };
}

async function auditRefusal(
  database: AppDatabase,
  actor: Actor,
  slotId: string,
  reason: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await database.insert(auditEvent).values({
    churchId: actor.churchId,
    actorType: "human",
    actorId: actor.personId,
    action: REMINDER_AUDIT_ACTIONS.refused,
    entity: "slot",
    entityId: slotId,
    detail: { reason, ...detail },
  });
}

/**
 * One time as the desk sees its reminder. The family's words and the
 * orientation note are not selected.
 */
export async function getDeskSlotReminder(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<DeskSlotReminder | null> {
  requireRoleSession(actor, DESK_ROLES);

  if (!isUuid(slotId)) return null;

  const claimer = alias(person, "reminder_volunteer");

  const [rows, policyRow, reminderRows, confirmationRows] = await Promise.all([
    database
      .select({
        slotId: slot.id,
        askId: slot.askId,
        status: slot.status,
        kind: slot.kind,
        label: slot.label,
        windowStart: slot.windowStart,
        windowEnd: slot.windowEnd,
        volunteerFirstName: claimer.firstName,
        careRecipientFirstName: careRecipient.firstName,
        timeZone: church.timezone,
      })
      .from(slot)
      .innerJoin(ask, eq(ask.id, slot.askId))
      .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
      .innerJoin(church, eq(church.id, slot.churchId))
      .leftJoin(claimer, eq(claimer.id, slot.claimedBy))
      .where(and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)))
      .limit(1),
    getPolicyInForce(actor.churchId, database),
    database
      .select({
        id: notification.id,
        body: notification.body,
        templateCode: notification.templateCode,
        createdAt: notification.createdAt,
      })
      .from(notification)
      .where(
        and(
          eq(notification.slotId, slotId),
          eq(notification.churchId, actor.churchId),
          eq(notification.kind, "reminder"),
        ),
      )
      .limit(1),
    database
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          eq(notification.slotId, slotId),
          eq(notification.churchId, actor.churchId),
          eq(notification.kind, "confirmation"),
        ),
      )
      .limit(1),
  ]);

  const row = rows[0];
  if (!row) return null;

  const reminderWindowHours =
    policyRow?.reminderWindowHours ?? DEFAULT_REMINDER_WINDOW_HOURS;
  const existing = reminderRows[0] ?? null;

  const eligibility = canWriteReminder({
    status: row.status,
    windowStart: row.windowStart,
    hasConfirmation: confirmationRows.length > 0,
    hasReminder: Boolean(existing),
    reminderWindowHours,
    now,
  });

  const preview =
    row.volunteerFirstName && row.careRecipientFirstName
      ? renderReminder({
          kind: row.kind,
          volunteerFirstName: row.volunteerFirstName,
          careRecipientFirstName: row.careRecipientFirstName,
          windowStart: row.windowStart,
          windowEnd: row.windowEnd,
          timeZone: row.timeZone,
        })
      : null;

  return {
    slotId: row.slotId,
    status: row.status as DeskSlotStatus,
    kind: row.kind as DeskSlotKind,
    label: row.label,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    timeZone: row.timeZone,
    reminderWindowHours,
    windowOpensAt: reminderWindowOpensAt(
      row.windowStart,
      reminderWindowHours,
    ),
    preview,
    existing,
    eligibility,
  };
}

/**
 * Write the one reminder for a covered time.
 *
 * The slot row is locked first, so two coordinators clicking at once serialize;
 * the second sees the existing row and writes nothing. The guard runs inside
 * the lock, and the template is rendered before any write. The notification
 * row is inserted after the lock confirms `covered`, so the database trigger
 * sees the state the rule is about.
 */
export async function writeReminder(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<ReminderOutcome> {
  requireRoleSession(actor, DESK_ROLES);

  if (!isUuid(slotId)) {
    return refusal("not_found", "That time is not available.");
  }

  return database.transaction(async (tx): Promise<ReminderOutcome> => {
    const [locked] = await tx
      .select({
        id: slot.id,
        askId: slot.askId,
        status: slot.status,
        kind: slot.kind,
        label: slot.label,
        windowStart: slot.windowStart,
        windowEnd: slot.windowEnd,
        claimedBy: slot.claimedBy,
      })
      .from(slot)
      .where(and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)))
      .limit(1)
      .for("update");

    if (!locked) {
      return refusal("not_found", "That time is not available.");
    }

    const policyRow = await getPolicyInForce(actor.churchId, tx);
    const reminderWindowHours =
      policyRow?.reminderWindowHours ?? DEFAULT_REMINDER_WINDOW_HOURS;

    const messageRows = await tx
      .select({
        id: notification.id,
        kind: notification.kind,
        body: notification.body,
        templateCode: notification.templateCode,
        createdAt: notification.createdAt,
      })
      .from(notification)
      .where(
        and(
          eq(notification.slotId, slotId),
          eq(notification.churchId, actor.churchId),
          inArray(notification.kind, ["confirmation", "reminder"]),
        ),
      );

    const existing = messageRows.find((row) => row.kind === "reminder") ?? null;
    const hasConfirmation = messageRows.some(
      (row) => row.kind === "confirmation",
    );

    const eligibility = canWriteReminder({
      status: locked.status,
      windowStart: locked.windowStart,
      hasConfirmation,
      hasReminder: Boolean(existing),
      reminderWindowHours,
      now,
    });

    if (!eligibility.ok) {
      if (eligibility.code === "already_written" && existing) {
        // A second click is a calm no-op, never a second message.
        return {
          ok: true,
          slotId,
          created: false,
          notificationId: existing.id,
          body: existing.body,
          templateCode: existing.templateCode,
          message: REMINDER_ALREADY_WRITTEN_MESSAGE,
        };
      }

      await auditRefusal(tx, actor, slotId, eligibility.code, {
        slotStatus: locked.status,
        reminderWindowHours,
        at: now.toISOString(),
      });

      return refusal(eligibility.code, eligibility.message);
    }

    const [context] = await tx
      .select({
        caregiverId: ask.caregiverId,
        careRecipientFirstName: careRecipient.firstName,
        timeZone: church.timezone,
      })
      .from(ask)
      .innerJoin(church, eq(church.id, ask.churchId))
      .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
      .where(and(eq(ask.id, locked.askId), eq(ask.churchId, actor.churchId)))
      .limit(1);

    if (!context) {
      await auditRefusal(tx, actor, slotId, "context_missing", {
        slotStatus: locked.status,
        at: now.toISOString(),
      });
      return refusal(
        "no_template",
        "This time has no family record the church can read, so nothing was sent. A person will check it.",
      );
    }

    const volunteerRows = locked.claimedBy
      ? await tx
          .select({ firstName: person.firstName, churchId: person.churchId })
          .from(person)
          .where(eq(person.id, locked.claimedBy))
          .limit(1)
      : [];
    const volunteerRow = volunteerRows[0];

    const volunteerFirstName =
      volunteerRow && volunteerRow.churchId === actor.churchId
        ? volunteerRow.firstName
        : null;

    const rendered = volunteerFirstName
      ? renderReminder({
          kind: locked.kind,
          volunteerFirstName,
          careRecipientFirstName: context.careRecipientFirstName,
          windowStart: locked.windowStart,
          windowEnd: locked.windowEnd,
          timeZone: context.timeZone,
        })
      : null;

    if (!rendered) {
      // Never write prose the church did not approve. Refuse and leave the row
      // as it was.
      await auditRefusal(tx, actor, slotId, "template_unavailable", {
        slotStatus: locked.status,
        kind: locked.kind,
        at: now.toISOString(),
      });
      return refusal(
        "no_template",
        "This time has no reminder the church can send, so nothing was written. A person will look at it.",
      );
    }

    const inserted = await tx
      .insert(notification)
      .values({
        churchId: actor.churchId,
        slotId,
        caregiverId: context.caregiverId,
        kind: "reminder",
        templateCode: rendered.templateCode,
        body: rendered.body,
        status: "queued",
        createdAt: now,
      })
      .returning({ id: notification.id });

    const notificationId = inserted[0]?.id ?? null;

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: REMINDER_AUDIT_ACTIONS.written,
      entity: "slot",
      entityId: slotId,
      detail: {
        kind: locked.kind,
        label: locked.label,
        templateCode: rendered.templateCode,
        windowStart: locked.windowStart?.toISOString() ?? null,
        reminderWindowHours,
        notificationId,
        at: now.toISOString(),
      },
      createdAt: now,
    });

    return {
      ok: true,
      slotId,
      created: true,
      notificationId,
      body: rendered.body,
      templateCode: rendered.templateCode,
      message: REMINDER_WRITTEN_MESSAGE,
    };
  });
}

/**
 * The caregiver's own reminders. The ownership predicate is
 * `notification.caregiver_id = actor.personId`; another family's rows are never
 * selected, and the read never selects the ask's words or the orientation note.
 */
export async function listCaregiverReminders(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<CaregiverReminder[]> {
  requireRoleSession(actor, CAREGIVER_ROLES);

  const rows = await database
    .select({
      id: notification.id,
      slotId: notification.slotId,
      body: notification.body,
      templateCode: notification.templateCode,
      createdAt: notification.createdAt,
      kind: slot.kind,
      label: slot.label,
      windowStart: slot.windowStart,
      windowEnd: slot.windowEnd,
      timeZone: church.timezone,
    })
    .from(notification)
    .innerJoin(slot, eq(slot.id, notification.slotId))
    .innerJoin(church, eq(church.id, notification.churchId))
    .where(
      and(
        eq(notification.churchId, actor.churchId),
        eq(notification.caregiverId, actor.personId),
        eq(notification.kind, "reminder"),
        eq(slot.churchId, actor.churchId),
      ),
    )
    .orderBy(desc(notification.createdAt), desc(notification.id));

  return rows.map((row) => ({
    ...row,
    kind: row.kind as DeskSlotKind,
  }));
}

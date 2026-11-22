import { and, desc, eq, inArray } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import { ask, auditEvent, slot } from "@/db/schema";
import {
  CAREGIVER_ROLES,
  CLAIMS_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import { isUuid } from "@/server/domain/claim";
import {
  canLeaveThankYou,
  careThanksFlashMessage,
  validateThankYou,
  type CareThanksFlashCode,
} from "@/server/domain/closure";
import {
  canMarkDone,
  isMyClaimStatus,
  MY_CLAIM_STATUSES,
  type DoneCheck,
  type MyClaimStatus,
} from "@/server/domain/my-claims";
import type { AppDatabase } from "./coordinator";
import {
  readChurchTimeZone,
  readCoordinatorFirstName,
  type MyClaimKind,
} from "./my-claims";

/**
 * Closing one covered time, and the caregiver's optional thank-you.
 *
 * The volunteer's read is the same ownership predicate as every other claim
 * read: `id + church_id + claimed_by = the signed-in volunteer`. Another
 * volunteer's id is a 404, and a caregiver or coordinator is refused before a
 * query runs.
 *
 * The thank-you is a human's own words about a time that happened. It is
 * stored as one append-only `audit_event` (`slot_thanked`) — never as a
 * notification, never as model output, and never as a second mutation of the
 * family's ask. The slot row is locked while it is written, so two submissions
 * serialize and only one row can exist.
 */

export type ClosureFacts = {
  id: string;
  askId: string;
  kind: MyClaimKind;
  label: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  status: MyClaimStatus;
  timeZone: string;
  coordinatorFirstName: string | null;
  /** The family's own words, present only after they chose to leave them. */
  thankYou: string | null;
  /** The pure done predicate for this claim and instant. */
  done: DoneCheck;
};

async function readThankYou(
  database: AppDatabase,
  churchId: string,
  slotId: string,
): Promise<string | null> {
  const [row] = await database
    .select({ detail: auditEvent.detail })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.churchId, churchId),
        eq(auditEvent.action, "slot_thanked"),
        eq(auditEvent.entity, "slot"),
        eq(auditEvent.entityId, slotId),
      ),
    )
    .orderBy(desc(auditEvent.createdAt), desc(auditEvent.id))
    .limit(1);

  const note = row?.detail?.note;
  return typeof note === "string" && note.length > 0 ? note : null;
}

/**
 * The closure page's facts for the volunteer who owns the claim.
 *
 * The orientation note is deliberately not selected here: closing a time needs
 * the time, its state, and the family's optional thank-you — not the family's
 * story.
 */
export async function getClosure(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<ClosureFacts | null> {
  requireRoleSession(actor, CLAIMS_ROLES);

  if (!isUuid(slotId)) return null;

  const [rows, coordinatorFirstName, timeZone] = await Promise.all([
    database
      .select({
        id: slot.id,
        askId: slot.askId,
        kind: slot.kind,
        label: slot.label,
        windowStart: slot.windowStart,
        windowEnd: slot.windowEnd,
        status: slot.status,
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

  const done = canMarkDone(
    {
      status: row.status,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
    },
    now,
    coordinatorFirstName,
  );

  const thankYou = await readThankYou(database, actor.churchId, slotId);

  return {
    id: row.id,
    askId: row.askId,
    kind: row.kind,
    label: row.label,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    status: row.status,
    timeZone: timeZone ?? "UTC",
    coordinatorFirstName,
    thankYou,
    done,
  };
}

export type ThankYouRefusalCode =
  | "not_found"
  | "not_done"
  | "already_thanked"
  | "too_long";

export type ThankYouOutcome =
  | {
      ok: true;
      code: "added" | "skipped";
      stored: boolean;
      message: string;
    }
  | {
      ok: false;
      code: ThankYouRefusalCode;
      message: string;
    };

const REFUSAL_FLASH: Record<ThankYouRefusalCode, CareThanksFlashCode> = {
  not_found: "not_found",
  not_done: "not_done",
  already_thanked: "already",
  too_long: "too_long",
};

function refusal(code: ThankYouRefusalCode): ThankYouOutcome {
  return {
    ok: false,
    code,
    message: careThanksFlashMessage(REFUSAL_FLASH[code], null),
  };
}

/**
 * Keep one optional thank-you on a finished time.
 *
 * Blank input is a deliberate skip: no row, no error, no pressure. A submitted
 * note is stored exactly as typed in the append-only audit log, alongside the
 * ask and kind, and the family's own confirmation row is untouched. The write
 * path never creates a notification, a reminder, or any follow-up.
 */
export async function recordCaregiverThankYou(
  actor: Actor,
  slotId: string,
  noteValue: unknown,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<ThankYouOutcome> {
  requireRoleSession(actor, CAREGIVER_ROLES);

  if (!isUuid(slotId)) return refusal("not_found");

  const validated = validateThankYou(noteValue);
  if (!validated.ok) {
    return {
      ok: false,
      code: "too_long",
      message: validated.message,
    };
  }

  return database.transaction(async (tx): Promise<ThankYouOutcome> => {
    const [target] = await tx
      .select({
        id: slot.id,
        askId: slot.askId,
        kind: slot.kind,
        status: slot.status,
      })
      .from(slot)
      .where(and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)))
      .limit(1)
      .for("update");

    if (!target) return refusal("not_found");

    const [owned] = await tx
      .select({ caregiverId: ask.caregiverId })
      .from(ask)
      .where(
        and(
          eq(ask.id, target.askId),
          eq(ask.churchId, actor.churchId),
          eq(ask.caregiverId, actor.personId),
        ),
      )
      .limit(1);

    if (!owned) return refusal("not_found");

    if (!canLeaveThankYou(target.status)) {
      return refusal("not_done");
    }

    const [existing] = await tx
      .select({ id: auditEvent.id })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.churchId, actor.churchId),
          eq(auditEvent.action, "slot_thanked"),
          eq(auditEvent.entity, "slot"),
          eq(auditEvent.entityId, slotId),
        ),
      )
      .limit(1);

    if (existing) return refusal("already_thanked");

    if (validated.note === null) {
      return {
        ok: true,
        code: "skipped",
        stored: false,
        message: careThanksFlashMessage("skipped", null),
      };
    }

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: "slot_thanked",
      entity: "slot",
      entityId: slotId,
      detail: {
        note: validated.note,
        askId: target.askId,
        kind: target.kind,
        slotStatus: target.status,
        at: now.toISOString(),
      },
      createdAt: now,
    });

    return {
      ok: true,
      code: "added",
      stored: true,
      message: careThanksFlashMessage("added", null),
    };
  });
}

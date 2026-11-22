import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
  canApproveClaim,
  canRevokeClaim,
  claimReviewRefusalCopy,
  CLAIM_APPROVED_MESSAGE,
  CLAIM_REVOKED_MESSAGE,
  validateRevokeReason,
  type ClaimReviewRefusalCode,
} from "@/server/domain/claim-review";
import { renderConfirmation } from "@/server/domain/notifications";
import type {
  AppDatabase,
  DeskAskStatus,
  DeskSlotKind,
  DeskSlotStatus,
} from "./coordinator";

/**
 * Coordinator claim review and the caregiver's one confirmation.
 *
 * Three reads and two writes:
 *
 *   - the desk's review of one time, which shows the claim but never the
 *     family's words or the orientation note;
 *   - the desk's short list of claims waiting for a person;
 *   - the caregiver's own confirmation rows, scoped to `caregiver_id`.
 *
 * The writes are single transactions. Approval locks the slot, re-checks that a
 * real claim exists, records the confirmation actor/instant in their own
 * columns, and inserts at most one confirmation row from a fixed human
 * template. Revocation requires a human reason and returns the time to open
 * without touching the outbox — a claim that has been confirmed cannot be
 * revoked here, which is what makes "revoking sends nothing" structural.
 *
 * The database backs both rules: `notification_requires_covered_slot` rejects a
 * caregiver row for a non-covered slot, and the partial unique index allows one
 * confirmation per slot. This repository is the only write path.
 */

export type ConfirmationRow = {
  id: string;
  body: string;
  templateCode: string;
  createdAt: Date;
};

export type DeskSlotClaimReview = {
  slotId: string;
  askId: string;
  status: DeskSlotStatus;
  kind: DeskSlotKind;
  label: string;
  gated: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
  claimedBy: string | null;
  claimedAt: Date | null;
  volunteerFirstName: string | null;
  /** Publication approval — the desk published the time. */
  approvedAt: Date | null;
  publishedByName: string | null;
  /** Claim confirmation — a later, distinct human decision. */
  claimConfirmedAt: Date | null;
  claimConfirmedByName: string | null;
  caregiverFirstName: string;
  careRecipientFirstName: string;
  timeZone: string;
  confirmation: ConfirmationRow | null;
};

export type PendingClaim = {
  slotId: string;
  kind: DeskSlotKind;
  label: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  claimedAt: Date | null;
  volunteerFirstName: string | null;
  caregiverFirstName: string;
  careRecipientFirstName: string;
  timeZone: string;
};

export type CaregiverConfirmation = {
  id: string;
  slotId: string;
  askId: string;
  body: string;
  templateCode: string;
  createdAt: Date;
  kind: DeskSlotKind;
  label: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  volunteerFirstName: string | null;
  timeZone: string;
  /** The time's life, so the page knows when the closure is the next step. */
  slotStatus: DeskSlotStatus;
  /** The ask's derived life; `closed` when every published time finished. */
  askStatus: DeskAskStatus;
  /** The family's own optional words, present only when they left some. */
  thankYou: string | null;
};

export const CLAIM_REVIEW_AUDIT_ACTIONS = {
  approved: "claim_approved",
  revoked: "claim_revoked",
  approvalRefused: "claim_approval_refused",
  revokeRefused: "claim_revoke_refused",
} as const;

export type ClaimApprovalOutcome =
  | {
      ok: true;
      slotId: string;
      message: string;
      notificationCreated: boolean;
    }
  | { ok: false; code: ClaimReviewRefusalCode; message: string };

export type ClaimRevocationOutcome =
  | { ok: true; slotId: string; message: string }
  | { ok: false; code: ClaimReviewRefusalCode; message: string };

function refusal(
  code: ClaimReviewRefusalCode,
  message: string,
): { ok: false; code: ClaimReviewRefusalCode; message: string } {
  return { ok: false, code, message };
}

async function auditRefusal(
  database: AppDatabase,
  actor: Actor,
  slotId: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await database.insert(auditEvent).values({
    churchId: actor.churchId,
    actorType: "human",
    actorId: actor.personId,
    action,
    entity: "slot",
    entityId: slotId,
    detail,
  });
}

/**
 * One time as the desk sees it for a claim decision. The family's verbatim
 * words and the orientation note are deliberately not selected.
 */
export async function getDeskSlotClaimReview(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
): Promise<DeskSlotClaimReview | null> {
  requireRoleSession(actor, DESK_ROLES);

  if (!isUuid(slotId)) return null;

  const claimer = alias(person, "claim_volunteer");
  const approver = alias(person, "slot_publisher");
  const confirmer = alias(person, "claim_confirmer");
  const caregiverPerson = alias(person, "slot_caregiver");

  const [rows, confirmations] = await Promise.all([
    database
      .select({
        slotId: slot.id,
        askId: slot.askId,
        status: slot.status,
        kind: slot.kind,
        label: slot.label,
        gated: slot.gated,
        windowStart: slot.windowStart,
        windowEnd: slot.windowEnd,
        claimedBy: slot.claimedBy,
        claimedAt: slot.claimedAt,
        volunteerFirstName: claimer.firstName,
        approvedAt: slot.approvedAt,
        publishedByName: approver.firstName,
        claimConfirmedAt: slot.claimConfirmedAt,
        claimConfirmedByName: confirmer.firstName,
        caregiverFirstName: caregiverPerson.firstName,
        careRecipientFirstName: careRecipient.firstName,
        timeZone: church.timezone,
      })
      .from(slot)
      .innerJoin(ask, eq(ask.id, slot.askId))
      .innerJoin(church, eq(church.id, slot.churchId))
      .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
      .innerJoin(caregiverPerson, eq(caregiverPerson.id, ask.caregiverId))
      .leftJoin(claimer, eq(claimer.id, slot.claimedBy))
      .leftJoin(approver, eq(approver.id, slot.approvedBy))
      .leftJoin(confirmer, eq(confirmer.id, slot.claimConfirmedBy))
      .where(and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)))
      .limit(1),
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
          eq(notification.kind, "confirmation"),
        ),
      )
      .limit(1),
  ]);

  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    status: row.status as DeskSlotStatus,
    kind: row.kind as DeskSlotKind,
    confirmation: confirmations[0] ?? null,
  };
}

/**
 * Claims waiting for a person at the desk, oldest first. Only the actor's own
 * church, and only a real claim — never a draft or a confirmed time.
 */
export async function listPendingClaims(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<PendingClaim[]> {
  requireRoleSession(actor, DESK_ROLES);

  const claimer = alias(person, "claim_volunteer");
  const caregiverPerson = alias(person, "slot_caregiver");

  const rows = await database
    .select({
      slotId: slot.id,
      kind: slot.kind,
      label: slot.label,
      windowStart: slot.windowStart,
      windowEnd: slot.windowEnd,
      claimedAt: slot.claimedAt,
      volunteerFirstName: claimer.firstName,
      caregiverFirstName: caregiverPerson.firstName,
      careRecipientFirstName: careRecipient.firstName,
      timeZone: church.timezone,
    })
    .from(slot)
    .innerJoin(ask, eq(ask.id, slot.askId))
    .innerJoin(church, eq(church.id, slot.churchId))
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .innerJoin(caregiverPerson, eq(caregiverPerson.id, ask.caregiverId))
    .leftJoin(claimer, eq(claimer.id, slot.claimedBy))
    .where(
      and(eq(slot.churchId, actor.churchId), eq(slot.status, "claimed")),
    )
    .orderBy(asc(slot.claimedAt), asc(slot.id));

  return rows.map((row) => ({
    ...row,
    kind: row.kind as DeskSlotKind,
  }));
}

/**
 * The caregiver's own confirmations. The ownership predicate is
 * `notification.caregiver_id = actor.personId`; another family's row is never
 * selected, and the read never selects the ask's words.
 *
 * Each row also carries the time's status and the ask's derived status, so the
 * page can offer the optional thank-you and the fresh ask only after a time is
 * actually done. The family's thank-you, when present, is one append-only audit
 * row read by the same ownership scope.
 */
export async function listCaregiverConfirmations(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<CaregiverConfirmation[]> {
  requireRoleSession(actor, CAREGIVER_ROLES);

  const claimer = alias(person, "confirmation_volunteer");

  const rows = await database
    .select({
      id: notification.id,
      slotId: notification.slotId,
      askId: slot.askId,
      body: notification.body,
      templateCode: notification.templateCode,
      createdAt: notification.createdAt,
      kind: slot.kind,
      label: slot.label,
      windowStart: slot.windowStart,
      windowEnd: slot.windowEnd,
      slotStatus: slot.status,
      askStatus: ask.status,
      volunteerFirstName: claimer.firstName,
      timeZone: church.timezone,
    })
    .from(notification)
    .innerJoin(slot, eq(slot.id, notification.slotId))
    .innerJoin(ask, eq(ask.id, slot.askId))
    .innerJoin(church, eq(church.id, notification.churchId))
    .leftJoin(claimer, eq(claimer.id, slot.claimedBy))
    .where(
      and(
        eq(notification.churchId, actor.churchId),
        eq(notification.caregiverId, actor.personId),
        eq(notification.kind, "confirmation"),
        eq(slot.churchId, actor.churchId),
        eq(ask.churchId, actor.churchId),
      ),
    )
    .orderBy(desc(notification.createdAt), desc(notification.id));

  if (rows.length === 0) return [];

  const thanks = await database
    .select({ entityId: auditEvent.entityId, detail: auditEvent.detail })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.churchId, actor.churchId),
        eq(auditEvent.action, "slot_thanked"),
        eq(auditEvent.entity, "slot"),
        inArray(
          auditEvent.entityId,
          rows.map((row) => row.slotId),
        ),
      ),
    )
    .orderBy(asc(auditEvent.createdAt));

  const thankYouBySlot = new Map<string, string>();
  for (const row of thanks) {
    const note = row.detail?.note;
    if (
      typeof row.entityId === "string" &&
      typeof note === "string" &&
      note.length > 0
    ) {
      thankYouBySlot.set(row.entityId, note);
    }
  }

  return rows.map((row) => ({
    ...row,
    kind: row.kind as DeskSlotKind,
    slotStatus: row.slotStatus as DeskSlotStatus,
    askStatus: row.askStatus as DeskAskStatus,
    thankYou: thankYouBySlot.get(row.slotId) ?? null,
  }));
}

/**
 * Confirm one claim.
 *
 * The slot row is locked first, so two coordinators cannot both move it. The
 * update keeps the publication columns untouched and records the confirmer in
 * `claim_confirmed_by/at`. Exactly one confirmation row is written, from the
 * fixed template for the slot's kind; an existing row (only possible if this
 * function interrupted) is never duplicated.
 */
export async function approveClaim(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<ClaimApprovalOutcome> {
  requireRoleSession(actor, DESK_ROLES);

  if (!isUuid(slotId)) {
    return refusal("not_found", claimReviewRefusalCopy(null));
  }

  return database.transaction(async (tx): Promise<ClaimApprovalOutcome> => {
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
        claimedAt: slot.claimedAt,
        approvedAt: slot.approvedAt,
      })
      .from(slot)
      .where(and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)))
      .limit(1)
      .for("update");

    if (!locked) {
      return refusal("not_found", claimReviewRefusalCopy(null));
    }

    const guard = canApproveClaim({
      status: locked.status,
      claimedBy: locked.claimedBy,
    });

    if (!guard.ok) {
      await auditRefusal(tx, actor, slotId, CLAIM_REVIEW_AUDIT_ACTIONS.approvalRefused, {
        reason: guard.code,
        slotStatus: locked.status,
        at: now.toISOString(),
      });
      return refusal(guard.code, guard.message);
    }

    const claimantId = locked.claimedBy as string;

    const [context] = await tx
      .select({
        timeZone: church.timezone,
        caregiverId: ask.caregiverId,
        careRecipientFirstName: careRecipient.firstName,
      })
      .from(ask)
      .innerJoin(church, eq(church.id, ask.churchId))
      .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
      .where(and(eq(ask.id, locked.askId), eq(ask.churchId, actor.churchId)))
      .limit(1);

    const [volunteerRow] = await tx
      .select({ firstName: person.firstName, churchId: person.churchId })
      .from(person)
      .where(eq(person.id, claimantId))
      .limit(1);

    const volunteerFirstName =
      volunteerRow && volunteerRow.churchId === actor.churchId
        ? volunteerRow.firstName
        : null;

    const rendered = context && volunteerFirstName
      ? renderConfirmation({
          kind: locked.kind,
          volunteerFirstName,
          careRecipientFirstName: context.careRecipientFirstName,
          windowStart: locked.windowStart,
          windowEnd: locked.windowEnd,
          timeZone: context.timeZone,
        })
      : null;

    if (!context || !rendered) {
      // Never move the claim if the church has no human template to send.
      await auditRefusal(tx, actor, slotId, CLAIM_REVIEW_AUDIT_ACTIONS.approvalRefused, {
        reason: "template_unavailable",
        slotStatus: locked.status,
        at: now.toISOString(),
      });
      return refusal(
        "unexpected",
        "This time has no message the church can send, so it was left as it was. A person will look at it.",
      );
    }

    const updated = await tx
      .update(slot)
      .set({
        status: "covered",
        claimConfirmedBy: actor.personId,
        claimConfirmedAt: now,
      })
      .where(
        and(
          eq(slot.id, slotId),
          eq(slot.churchId, actor.churchId),
          eq(slot.status, "claimed"),
          eq(slot.claimedBy, claimantId),
        ),
      )
      .returning({ id: slot.id });

    if (!updated[0]) {
      return refusal("not_claimed", claimReviewRefusalCopy(locked.status));
    }

    const [existing] = await tx
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          eq(notification.slotId, slotId),
          eq(notification.churchId, actor.churchId),
          eq(notification.kind, "confirmation"),
        ),
      )
      .limit(1);

    let notificationId = existing?.id ?? null;
    let notificationCreated = false;

    if (!notificationId) {
      const inserted = await tx
        .insert(notification)
        .values({
          churchId: actor.churchId,
          slotId,
          caregiverId: context.caregiverId,
          kind: "confirmation",
          templateCode: rendered.templateCode,
          body: rendered.body,
          status: "queued",
          createdAt: now,
        })
        .returning({ id: notification.id });

      notificationId = inserted[0]?.id ?? null;
      notificationCreated = Boolean(notificationId);
    }

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: CLAIM_REVIEW_AUDIT_ACTIONS.approved,
      entity: "slot",
      entityId: slotId,
      detail: {
        volunteerId: claimantId,
        claimedAt: locked.claimedAt?.toISOString() ?? null,
        confirmedAt: now.toISOString(),
        publishedApprovedAt: locked.approvedAt?.toISOString() ?? null,
        kind: locked.kind,
        label: locked.label,
        templateCode: rendered.templateCode,
        notificationId,
        notificationCreated,
      },
      createdAt: now,
    });

    return {
      ok: true,
      slotId,
      message: CLAIM_APPROVED_MESSAGE,
      notificationCreated,
    };
  });
}

/**
 * Take one claim back, before confirmation. The reason is required and kept
 * exactly as typed. The slot returns to `open` with no claimer, so the board
 * offers it again and the volunteer's own list drops it. Nothing is written to
 * the outbox, and a confirmed time is refused rather than silently unreserved.
 */
export async function revokeClaim(
  actor: Actor,
  input: { slotId: string; reason: unknown },
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<ClaimRevocationOutcome> {
  requireRoleSession(actor, DESK_ROLES);

  const slotId = input.slotId;
  if (!isUuid(slotId)) {
    return refusal("not_found", claimReviewRefusalCopy(null));
  }

  const reason = validateRevokeReason(input.reason);
  if (!reason.ok) {
    return refusal("invalid_reason", reason.message);
  }

  return database.transaction(async (tx): Promise<ClaimRevocationOutcome> => {
    const [locked] = await tx
      .select({
        id: slot.id,
        status: slot.status,
        claimedBy: slot.claimedBy,
        claimedAt: slot.claimedAt,
        claimConfirmedAt: slot.claimConfirmedAt,
      })
      .from(slot)
      .where(and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)))
      .limit(1)
      .for("update");

    if (!locked) {
      return refusal("not_found", claimReviewRefusalCopy(null));
    }

    const guard = canRevokeClaim({
      status: locked.status,
      claimedBy: locked.claimedBy,
    });

    if (!guard.ok) {
      await auditRefusal(tx, actor, slotId, CLAIM_REVIEW_AUDIT_ACTIONS.revokeRefused, {
        reason: guard.code,
        slotStatus: locked.status,
        at: now.toISOString(),
      });
      return refusal(guard.code, guard.message);
    }

    const claimantId = locked.claimedBy as string;

    const updated = await tx
      .update(slot)
      .set({
        status: "open",
        claimedBy: null,
        claimedAt: null,
      })
      .where(
        and(
          eq(slot.id, slotId),
          eq(slot.churchId, actor.churchId),
          eq(slot.status, "claimed"),
          eq(slot.claimedBy, claimantId),
        ),
      )
      .returning({ id: slot.id });

    if (!updated[0]) {
      return refusal("not_claimed", claimReviewRefusalCopy(locked.status));
    }

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: CLAIM_REVIEW_AUDIT_ACTIONS.revoked,
      entity: "slot",
      entityId: slotId,
      detail: {
        volunteerId: claimantId,
        claimedAt: locked.claimedAt?.toISOString() ?? null,
        reason: reason.reason,
        previousStatus: "claimed",
        at: now.toISOString(),
      },
      createdAt: now,
    });

    return { ok: true, slotId, message: CLAIM_REVOKED_MESSAGE };
  });
}

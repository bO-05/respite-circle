import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as appDb } from "@/db/client";
import {
  ask,
  askStatusEnum,
  auditEvent,
  church,
  person,
  session,
  slot,
  slotKindEnum,
  slotStatusEnum,
} from "@/db/schema";
import { CAREGIVER_ROLES, DESK_ROLES, requireRoleSession, type Actor } from "@/server/auth/policy";
import {
  canApproveAsk,
  canSendBackAsk,
  publicationSummary,
  SEND_BACK_SUCCESS_MESSAGE,
  validateSendBackNote,
} from "@/server/domain/ask-review";
import { canPublishDraft } from "@/server/domain/slots";
import { formatSessionDate } from "@/server/domain/session-calendar";
import { sha256Hex } from "@/server/services/decision-contract";
import type { AppDatabase } from "./coordinator";

/**
 * The approve / send-back writes and the desk's publication read.
 *
 * Both transitions are one transaction each: the ask row is locked, its status
 * is re-checked inside the lock, and the slots change in the same transaction.
 * A held draft is never published by approval; it keeps its reason and stays
 * `draft` until a coordinator resolves the hold, at which point the single
 * `publishHeldDraft` path can make it open.
 *
 * Every transition writes an append-only audit event with the acting person and
 * the database's own timestamp.
 */

export type AskStatus = (typeof askStatusEnum.enumValues)[number];
export type SlotStatus = (typeof slotStatusEnum.enumValues)[number];
export type SlotKind = (typeof slotKindEnum.enumValues)[number];

const PUBLISHED_DESK_STATUSES: SlotStatus[] = [
  "open",
  "claimed",
  "covered",
  "done",
];

export type PublishedSlot = {
  id: string;
  kind: SlotKind;
  label: string;
  gated: boolean;
  status: SlotStatus;
  windowStart: Date | null;
  windowEnd: Date | null;
  approvedAt: Date | null;
  approvedByName: string | null;
};

export type AskPublication = {
  askId: string;
  status: AskStatus;
  timeZone: string;
  approvedAt: Date | null;
  approvedByName: string | null;
  sendBackNote: string | null;
  sentBackAt: Date | null;
  sentBackByName: string | null;
  /** The human close of a held ask, shown back to the coordinator. */
  closeNote: string | null;
  closedAt: Date | null;
  closedByName: string | null;
  published: PublishedSlot[];
};

/**
 * Everything the review section needs: the ask's approval or send-back record
 * and the times the congregation can already see. Draft slots and held drafts
 * come from the draft editor's scoped read, so this projection never widens to
 * words or to a caregiver identity.
 */
export async function getAskPublication(
  actor: Actor,
  askId: string,
  database: AppDatabase = appDb,
): Promise<AskPublication | null> {
  requireRoleSession(actor, DESK_ROLES);

  const approver = alias(person, "approver");
  const sender = alias(person, "send_back_sender");
  const closer = alias(person, "close_sender");

  const [askRows, slotRows] = await Promise.all([
    database
      .select({
        id: ask.id,
        status: ask.status,
        timeZone: church.timezone,
        approvedAt: ask.approvedAt,
        approvedByName: approver.firstName,
        sendBackNote: ask.sendBackNote,
        sentBackAt: ask.sentBackAt,
        sentBackByName: sender.firstName,
        closeNote: ask.closeNote,
        closedAt: ask.closedAt,
        closedByName: closer.firstName,
      })
      .from(ask)
      .innerJoin(church, eq(church.id, ask.churchId))
      .leftJoin(approver, eq(approver.id, ask.approvedBy))
      .leftJoin(sender, eq(sender.id, ask.sentBackBy))
      .leftJoin(closer, eq(closer.id, ask.closedBy))
      .where(and(eq(ask.id, askId), eq(ask.churchId, actor.churchId)))
      .limit(1),
    database
      .select({
        id: slot.id,
        kind: slot.kind,
        label: slot.label,
        gated: slot.gated,
        status: slot.status,
        windowStart: slot.windowStart,
        windowEnd: slot.windowEnd,
        approvedAt: slot.approvedAt,
        approvedByName: approver.firstName,
      })
      .from(slot)
      .leftJoin(approver, eq(approver.id, slot.approvedBy))
      .where(
        and(
          eq(slot.askId, askId),
          eq(slot.churchId, actor.churchId),
          inArray(slot.status, PUBLISHED_DESK_STATUSES),
        ),
      )
      .orderBy(asc(slot.windowStart), asc(slot.id)),
  ]);

  const row = askRows[0];
  if (!row) return null;

  return {
    askId: row.id,
    status: row.status,
    timeZone: row.timeZone,
    approvedAt: row.approvedAt,
    approvedByName: row.approvedByName,
    sendBackNote: row.sendBackNote,
    sentBackAt: row.sentBackAt,
    sentBackByName: row.sentBackByName,
    closeNote: row.closeNote,
    closedAt: row.closedAt,
    closedByName: row.closedByName,
    published: slotRows.map((entry) => ({
      ...entry,
      kind: entry.kind as SlotKind,
      status: entry.status as SlotStatus,
    })),
  };
}

export type CaregiverNote = {
  askId: string;
  /** A send-back note or the human close of a held ask. */
  kind: "send_back" | "close";
  note: string;
  notedAt: Date | null;
  notedByName: string | null;
};

/**
 * The notes a caregiver can read on `/care`. Only their own asks, and only a
 * surface where a coordinator actually wrote to them: a send-back note, or the
 * human close of a safety or personal-care hold. The note is returned exactly
 * as stored. Nothing here is generated.
 */
export async function listCaregiverNotes(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<CaregiverNote[]> {
  requireRoleSession(actor, CAREGIVER_ROLES);

  const sender = alias(person, "note_sender");
  const closer = alias(person, "close_sender");

  const rows = await database
    .select({
      askId: ask.id,
      status: ask.status,
      sendBackNote: ask.sendBackNote,
      sentBackAt: ask.sentBackAt,
      sentBackByName: sender.firstName,
      closeNote: ask.closeNote,
      closedAt: ask.closedAt,
      closedByName: closer.firstName,
    })
    .from(ask)
    .leftJoin(sender, eq(sender.id, ask.sentBackBy))
    .leftJoin(closer, eq(closer.id, ask.closedBy))
    .where(
      and(
        eq(ask.churchId, actor.churchId),
        eq(ask.caregiverId, actor.personId),
        inArray(ask.status, ["sent_back", "closed"]),
        or(isNotNull(ask.sendBackNote), isNotNull(ask.closeNote)),
      ),
    )
    .orderBy(desc(ask.updatedAt), desc(ask.createdAt), desc(ask.id))
    .limit(5);

  const notes: CaregiverNote[] = [];

  for (const row of rows) {
    if (row.status === "closed" && row.closeNote !== null) {
      notes.push({
        askId: row.askId,
        kind: "close",
        note: row.closeNote,
        notedAt: row.closedAt,
        notedByName: row.closedByName,
      });
      continue;
    }

    if (row.status === "sent_back" && row.sendBackNote !== null) {
      notes.push({
        askId: row.askId,
        kind: "send_back",
        note: row.sendBackNote,
        notedAt: row.sentBackAt,
        notedByName: row.sentBackByName,
      });
    }
  }

  return notes;
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

export type ApproveOutcome =
  | {
      ok: true;
      askId: string;
      publishedCount: number;
      heldCount: number;
      message: string;
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_waiting"
        | "session_full"
        | "session_unavailable";
      message: string;
    };

const NOT_AVAILABLE = "That ask is not available.";

/**
 * Publish exactly the drafts that are not held, record the approver on the ask
 * and on every published slot, and move the ask to `approved`.
 *
 * The ask row is locked first. A second coordinator pressing Approve at the
 * same time re-reads the status under the lock and is refused, so no slot can
 * be published twice and no ask can be approved twice.
 */
export async function approveAsk(
  actor: Actor,
  askId: string,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<ApproveOutcome> {
  requireRoleSession(actor, DESK_ROLES);

  return database.transaction(async (tx): Promise<ApproveOutcome> => {
    const [lockedAsk] = await tx
      .select({ id: ask.id, status: ask.status, timeZone: church.timezone })
      .from(ask)
      .innerJoin(church, eq(church.id, ask.churchId))
      .where(and(eq(ask.id, askId), eq(ask.churchId, actor.churchId)))
      .limit(1)
      .for("update");

    if (!lockedAsk) {
      return { ok: false, reason: "not_found", message: NOT_AVAILABLE };
    }

    const guard = canApproveAsk(lockedAsk.status);
    if (!guard.ok) {
      return { ok: false, reason: "not_waiting", message: guard.message };
    }

    const drafts = await tx
      .select({
        id: slot.id,
        kind: slot.kind,
        label: slot.label,
        status: slot.status,
        holdReason: slot.holdReason,
        sessionId: slot.sessionId,
      })
      .from(slot)
      .where(
        and(
          eq(slot.askId, askId),
          eq(slot.churchId, actor.churchId),
          eq(slot.status, "draft"),
        ),
      )
      .orderBy(asc(slot.createdAt), asc(slot.id))
      .for("update");

    const publishable = drafts.filter((draft) => canPublishDraft(draft).ok);
    const held = drafts.filter((draft) => !canPublishDraft(draft).ok);

    // A full morning cannot accept another companion place. Publishing is the
    // last gate: a draft that would overbook its session refuses the whole
    // approval, before the ask moves or any slot becomes visible.
    const companions = publishable.filter(
      (draft) => draft.kind === "companion",
    );
    if (companions.length > 0) {
      if (companions.some((draft) => !draft.sessionId)) {
        return {
          ok: false,
          reason: "session_unavailable",
          message:
            "A companion place has no Respite Morning on the calendar. Link it to a Tuesday before approving. Nothing was published.",
        };
      }

      const sessionIds = [
        ...new Set(companions.map((draft) => draft.sessionId as string)),
      ];
      const sessionRows = await tx
        .select({
          id: session.id,
          startsAt: session.startsAt,
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
        .where(
          and(
            eq(session.churchId, actor.churchId),
            inArray(session.id, sessionIds),
          ),
        )
        .for("update");

      const byId = new Map(sessionRows.map((row) => [row.id, row]));

      for (const draft of companions) {
        const row = byId.get(draft.sessionId as string);
        if (!row) {
          return {
            ok: false,
            reason: "session_unavailable",
            message:
              "A companion place is linked to a Respite Morning that is no longer on the calendar. Move it before approving. Nothing was published.",
          };
        }

        const label = formatSessionDate(row.startsAt, lockedAsk.timeZone);

        if (row.status !== "scheduled") {
          return {
            ok: false,
            reason: "session_unavailable",
            message: `${label} is not a scheduled Respite Morning. Move this companion place before approving. Nothing was published.`,
          };
        }

        if (Number(row.usedCompanionPlaces) > row.capacity) {
          return {
            ok: false,
            reason: "session_full",
            message: `${label} is full (${row.capacity} of ${row.capacity} places taken). A full morning cannot accept another companion place. Nothing was published.`,
          };
        }
      }
    }

    const approvedRows = await tx
      .update(ask)
      .set({
        status: "approved",
        approvedBy: actor.personId,
        approvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(ask.id, askId),
          eq(ask.churchId, actor.churchId),
          eq(ask.status, "waiting_coordinator"),
        ),
      )
      .returning({ id: ask.id });

    if (approvedRows.length === 0) {
      return { ok: false, reason: "not_waiting", message: NOT_AVAILABLE };
    }

    if (publishable.length > 0) {
      await tx
        .update(slot)
        .set({
          status: "open",
          approvedBy: actor.personId,
          approvedAt: now,
        })
        .where(
          and(
            inArray(
              slot.id,
              publishable.map((draft) => draft.id),
            ),
            eq(slot.churchId, actor.churchId),
            eq(slot.status, "draft"),
          ),
        );
    }

    await tx.insert(auditEvent).values([
      {
        churchId: actor.churchId,
        actorType: "human" as const,
        actorId: actor.personId,
        action: "ask_approved",
        entity: "ask",
        entityId: askId,
        detail: {
          publishedCount: publishable.length,
          heldCount: held.length,
          publishedSlotIds: publishable.map((draft) => draft.id),
          heldSlotIds: held.map((draft) => draft.id),
        },
      },
      ...publishable.map((draft) => ({
        churchId: actor.churchId,
        actorType: "human" as const,
        actorId: actor.personId,
        action: "slot_published",
        entity: "slot",
        entityId: draft.id,
        detail: {
          askId,
          kind: draft.kind,
          label: draft.label,
          via: "ask_approved",
        },
      })),
    ]);

    return {
      ok: true,
      askId,
      publishedCount: publishable.length,
      heldCount: held.length,
      message: publicationSummary(publishable.length, held.length),
    };
  });
}

// ---------------------------------------------------------------------------
// Send back
// ---------------------------------------------------------------------------

export type SendBackOutcome =
  | { ok: true; askId: string; note: string; message: string }
  | { ok: false; reason: "not_found" | "not_waiting" | "invalid_note"; message: string };

/**
 * Send the ask back with a human note. Nothing is published: every draft stays
 * a draft, and the held ones keep their reasons. The note is stored exactly as
 * typed so the caregiver reads the same words the coordinator wrote.
 */
export async function sendBackAsk(
  actor: Actor,
  input: { askId: string; note: unknown },
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<SendBackOutcome> {
  requireRoleSession(actor, DESK_ROLES);

  const validated = validateSendBackNote(input.note);
  if (!validated.ok) {
    return { ok: false, reason: "invalid_note", message: validated.message };
  }

  return database.transaction(async (tx): Promise<SendBackOutcome> => {
    const [lockedAsk] = await tx
      .select({ id: ask.id, status: ask.status })
      .from(ask)
      .where(and(eq(ask.id, input.askId), eq(ask.churchId, actor.churchId)))
      .limit(1)
      .for("update");

    if (!lockedAsk) {
      return { ok: false, reason: "not_found", message: NOT_AVAILABLE };
    }

    const guard = canSendBackAsk(lockedAsk.status);
    if (!guard.ok) {
      return { ok: false, reason: "not_waiting", message: guard.message };
    }

    const updated = await tx
      .update(ask)
      .set({
        status: "sent_back",
        sendBackNote: validated.note,
        sentBackBy: actor.personId,
        sentBackAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(ask.id, input.askId),
          eq(ask.churchId, actor.churchId),
          eq(ask.status, "waiting_coordinator"),
        ),
      )
      .returning({ id: ask.id });

    if (updated.length === 0) {
      return { ok: false, reason: "not_waiting", message: NOT_AVAILABLE };
    }

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: "ask_sent_back",
      entity: "ask",
      entityId: input.askId,
      detail: {
        noteLength: validated.note.length,
        // The words live on the ask row; the audit keeps only a digest so it
        // can prove what was sent without becoming a second copy of the note.
        noteDigest: sha256Hex(validated.note),
        publishedCount: 0,
      },
    });

    return {
      ok: true,
      askId: input.askId,
      note: validated.note,
      message: SEND_BACK_SUCCESS_MESSAGE,
    };
  });
}

// ---------------------------------------------------------------------------
// A held draft, after the ask has been approved
// ---------------------------------------------------------------------------

export type PublishHeldOutcome =
  | { ok: true; askId: string; slotId: string; message: string }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_approved"
        | "not_held"
        | "not_draft"
        | "session_full"
        | "session_unavailable";
      message: string;
    };

/**
 * Resolve a held draft's hold and publish it, one deliberate action.
 *
 * This is the only path that can publish a time after its ask was approved.
 * It goes through `canPublishDraft` in its hold-resolved form, which requires
 * the slot to still be a draft and to actually carry a hold reason; the ask must
 * already be `approved`, so an unapproved ask can never leak an open slot. The
 * resolved reason is kept in the audit log.
 */
export async function resolveHeldDraftAndPublish(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<PublishHeldOutcome> {
  requireRoleSession(actor, DESK_ROLES);

  return database.transaction(async (tx): Promise<PublishHeldOutcome> => {
    const [target] = await tx
      .select({
        id: slot.id,
        askId: slot.askId,
        kind: slot.kind,
        label: slot.label,
        status: slot.status,
        holdReason: slot.holdReason,
        sessionId: slot.sessionId,
        askStatus: ask.status,
        timeZone: church.timezone,
      })
      .from(slot)
      .innerJoin(ask, eq(ask.id, slot.askId))
      .innerJoin(church, eq(church.id, ask.churchId))
      .where(
        and(
          eq(slot.id, slotId),
          eq(slot.churchId, actor.churchId),
          eq(ask.churchId, actor.churchId),
        ),
      )
      .limit(1)
      .for("update");

    if (!target) {
      return { ok: false, reason: "not_found", message: "That time is not available." };
    }

    if (target.askStatus !== "approved") {
      return {
        ok: false,
        reason: "not_approved",
        message:
          "The ask must be approved before a single held time can be published.",
      };
    }

    // The same publication guard as an ordinary approval, stating in one place
    // that this visit resolves the hold. A non-draft or an unheld draft is
    // refused with the desk's own sentence.
    const publishGuard = canPublishDraft(target, { holdResolved: true });
    if (!publishGuard.ok) {
      return {
        ok: false,
        reason:
          publishGuard.reason === "not_held" ? "not_held" : "not_draft",
        message:
          publishGuard.reason === "not_held"
            ? "That draft is not held, so there is nothing to resolve."
            : "That time is already published.",
      };
    }

    if (target.kind === "companion") {
      if (!target.sessionId) {
        return {
          ok: false,
          reason: "session_unavailable",
          message:
            "That companion place has no Respite Morning on the calendar. Link it to a Tuesday before publishing. Nothing was published.",
        };
      }

      const [sessionRow] = await tx
        .select({
          id: session.id,
          startsAt: session.startsAt,
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
        .where(
          and(
            eq(session.id, target.sessionId),
            eq(session.churchId, actor.churchId),
          ),
        )
        .limit(1)
        .for("update");

      if (!sessionRow) {
        return {
          ok: false,
          reason: "session_unavailable",
          message:
            "That companion place is linked to a Respite Morning that is no longer on the calendar. Nothing was published.",
        };
      }

      const label = formatSessionDate(sessionRow.startsAt, target.timeZone);

      if (sessionRow.status !== "scheduled") {
        return {
          ok: false,
          reason: "session_unavailable",
          message: `${label} is not a scheduled Respite Morning. Nothing was published.`,
        };
      }

      if (Number(sessionRow.usedCompanionPlaces) > sessionRow.capacity) {
        return {
          ok: false,
          reason: "session_full",
          message: `${label} is full (${sessionRow.capacity} of ${sessionRow.capacity} places taken). A full morning cannot accept another companion place. Nothing was published.`,
        };
      }
    }

    const updated = await tx
      .update(slot)
      .set({
        status: "open",
        approvedBy: actor.personId,
        approvedAt: now,
        holdReason: null,
        heldAt: null,
        heldBy: null,
      })
      .where(
        and(
          eq(slot.id, slotId),
          eq(slot.churchId, actor.churchId),
          eq(slot.status, "draft"),
        ),
      )
      .returning({ id: slot.id });

    if (updated.length === 0) {
      return {
        ok: false,
        reason: "not_draft",
        message: "That time changed while you were looking. Nothing was published.",
      };
    }

    await tx.insert(auditEvent).values([
      {
        churchId: actor.churchId,
        actorType: "human" as const,
        actorId: actor.personId,
        action: "draft_slot_hold_resolved",
        entity: "slot",
        entityId: slotId,
        detail: {
          askId: target.askId,
          resolvedReason: target.holdReason,
          afterApproval: true,
        },
      },
      {
        churchId: actor.churchId,
        actorType: "human" as const,
        actorId: actor.personId,
        action: "slot_published",
        entity: "slot",
        entityId: slotId,
        detail: {
          askId: target.askId,
          kind: target.kind,
          label: target.label,
          via: "hold_resolved",
        },
      },
    ]);

    return {
      ok: true,
      askId: target.askId,
      slotId,
      message: "Published. It is open on the congregation board.",
    };
  });
}

/**
 * The visible line a desk screen and the board share comes from
 * `formatApprovalLine` in `src/server/domain/ask-review.ts`, so the two
 * surfaces cannot format the same audit fact differently.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as appDb } from "@/db/client";
import {
  ask,
  askRevision,
  auditEvent,
  decision,
  person,
  policy,
} from "@/db/schema";
import { DESK_ROLES, requireRoleSession, type Actor } from "@/server/auth/policy";
import {
  canCloseHeldAsk,
  canOverrideHold,
  CLOSE_NOT_HELD_REFUSAL,
  CLOSE_NOTE_MAX_LENGTH,
  CLOSE_SUCCESS_MESSAGE,
  HOLD_STATUSES,
  holdCardFor,
  OVERRIDE_NOT_HELD_REFUSAL,
  OVERRIDE_REASON_MAX_LENGTH,
  OVERRIDE_SUCCESS_MESSAGE,
  PERSONAL_CARE_OVERRIDE_REFUSAL,
  personalCareFlagged,
  validateCloseNote,
  validateOverride,
  type HoldActionField,
  type HoldAnswer,
  type HoldCard,
  type HoldStatus,
} from "@/server/domain/holds";
import { sha256Hex } from "@/server/services/decision-contract";
import type { AppDatabase } from "./coordinator";

/**
 * The coordinator's read and writes for the two human-only routes.
 *
 * A safety or personal-care ask never becomes a volunteer time: slot
 * construction refuses the held status, the answers are re-checked, and
 * the manual add path is refused here too. A safety hold may be converted only
 * by an explicit, reasoned action that writes its actor to the append-only
 * audit log; a personal-care hold never converts. The close keeps the
 * coordinator's own words on the ask and creates no message of any kind.
 */

export type HeldAskCard = {
  askId: string;
  status: HoldStatus;
  card: HoldCard;
  caregiverFirstName: string;
  closeNote: string | null;
  closedAt: Date | null;
  closedByName: string | null;
  overrideAt: Date | null;
  overrideByName: string | null;
  overrideReason: string | null;
};

const HOLD_STATUS_LIST = [...HOLD_STATUSES];

/**
 * Everything a held ask's card needs, and nothing else: no verbatim words, no
 * other family's rows, no volunteer facts. Desk roles only, church-scoped.
 */
export async function getHeldAskCard(
  actor: Actor,
  askId: string,
  database: AppDatabase = appDb,
): Promise<HeldAskCard | null> {
  requireRoleSession(actor, DESK_ROLES);

  const closer = alias(person, "hold_closer");
  const overrider = alias(person, "hold_overrider");
  const caregiverPerson = alias(person, "hold_caregiver");

  const rows = await database
    .select({
      id: ask.id,
      status: ask.status,
      caregiverFirstName: caregiverPerson.firstName,
      closeNote: ask.closeNote,
      closedAt: ask.closedAt,
      closedByName: closer.firstName,
      overrideAt: ask.safetyOverrideAt,
      overrideByName: overrider.firstName,
      overrideReason: ask.safetyOverrideReason,
      crisisScript: policy.crisisScript,
      localCrisisLine: policy.localCrisisLine,
      referralResources: policy.referralResources,
    })
    .from(ask)
    .innerJoin(caregiverPerson, eq(caregiverPerson.id, ask.caregiverId))
    .innerJoin(policy, eq(policy.id, ask.policyVersionId))
    .leftJoin(closer, eq(closer.id, ask.closedBy))
    .leftJoin(overrider, eq(overrider.id, ask.safetyOverrideBy))
    .where(
      and(
        eq(ask.id, askId),
        eq(ask.churchId, actor.churchId),
        inArray(ask.status, HOLD_STATUS_LIST),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const card = holdCardFor(row.status, {
    crisisScript: row.crisisScript,
    localCrisisLine: row.localCrisisLine,
    referralResources: row.referralResources,
  });
  if (!card) return null;

  return {
    askId: row.id,
    status: row.status as HoldStatus,
    card,
    caregiverFirstName: row.caregiverFirstName,
    closeNote: row.closeNote,
    closedAt: row.closedAt,
    closedByName: row.closedByName,
    overrideAt: row.overrideAt,
    overrideByName: row.overrideByName,
    overrideReason: row.overrideReason,
  };
}

/**
 * The latest revision's answers. Slot construction and the manual add
 * path both read this so a personal-care flag is enforced from the words the
 * family is reading today, not from an earlier revision.
 */
export async function readLatestTypedAnswers(
  database: AppDatabase,
  askId: string,
): Promise<HoldAnswer[]> {
  const revisions = await database
    .select({ id: askRevision.id })
    .from(askRevision)
    .where(eq(askRevision.askId, askId))
    .orderBy(asc(askRevision.createdAt), asc(askRevision.id))
    .limit(1_000);

  const latest = revisions.at(-1);
  if (!latest) return [];

  return database
    .select({
      questionId: decision.questionId,
      answer: decision.answer,
      abstained: decision.abstained,
    })
    .from(decision)
    .where(
      and(
        eq(decision.askId, askId),
        eq(decision.askRevisionId, latest.id),
      ),
    )
    .orderBy(asc(decision.questionId));
}

export type HoldWriteOutcome =
  | { ok: true; askId: string; message: string }
  | {
      ok: false;
      code:
        | "not_found"
        | "not_held"
        | "personal_care"
        | "invalid_note"
        | "invalid_confirmation"
        | "invalid_reason";
      message: string;
      field?: HoldActionField;
    };

const NOT_FOUND = "That ask is not available.";

/**
 * Close a held ask with the coordinator's own words. The family reads the note
 * exactly as written. No notification row, template, or model output is
 * created: a close is a person speaking.
 */
export async function closeHeldAsk(
  actor: Actor,
  input: { askId: string; note: unknown },
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<HoldWriteOutcome> {
  requireRoleSession(actor, DESK_ROLES);

  const validated = validateCloseNote(input.note);
  if (!validated.ok) {
    return {
      ok: false,
      code: "invalid_note",
      field: "note",
      message: validated.message,
    };
  }

  return database.transaction(async (tx): Promise<HoldWriteOutcome> => {
    const [locked] = await tx
      .select({ id: ask.id, status: ask.status })
      .from(ask)
      .where(and(eq(ask.id, input.askId), eq(ask.churchId, actor.churchId)))
      .limit(1)
      .for("update");

    if (!locked) {
      return { ok: false, code: "not_found", message: NOT_FOUND };
    }

    if (!canCloseHeldAsk(locked.status)) {
      return {
        ok: false,
        code: "not_held",
        message: CLOSE_NOT_HELD_REFUSAL,
      };
    }

    const updated = await tx
      .update(ask)
      .set({
        status: "closed",
        closeNote: validated.note,
        closedBy: actor.personId,
        closedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(ask.id, input.askId),
          eq(ask.churchId, actor.churchId),
          inArray(ask.status, HOLD_STATUS_LIST),
        ),
      )
      .returning({ id: ask.id });

    if (updated.length === 0) {
      return {
        ok: false,
        code: "not_held",
        message: CLOSE_NOT_HELD_REFUSAL,
      };
    }

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: "held_ask_closed",
      entity: "ask",
      entityId: input.askId,
      detail: {
        fromStatus: locked.status,
        noteLength: validated.note.length,
        // The words live on the ask row; the audit keeps a digest so it can
        // prove what was closed without becoming a second copy.
        noteDigest: sha256Hex(validated.note),
        notificationsCreated: 0,
        maxLength: CLOSE_NOTE_MAX_LENGTH,
      },
    });

    return {
      ok: true,
      askId: input.askId,
      message: CLOSE_SUCCESS_MESSAGE,
    };
  });
}

/**
 * Convert a *safety* hold back into the ordinary queue.
 *
 * Two human acts are required: the explicit confirmation that the call
 * happened, and the reason in the coordinator's own words. Both are recorded;
 * the reason and the actor go into the append-only audit log. Personal care is
 * refused outright, including a safety hold whose answers also name
 * personal care. No slot is created by the conversion — plain code still has
 * to propose one, and the Q9 gate still refuses.
 */
export async function overrideSafetyHold(
  actor: Actor,
  input: { askId: string; confirmation: unknown; reason: unknown },
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<HoldWriteOutcome> {
  requireRoleSession(actor, DESK_ROLES);

  const validated = validateOverride({
    confirmation: input.confirmation,
    reason: input.reason,
  });
  if (!validated.ok) {
    return {
      ok: false,
      code:
        validated.field === "confirm"
          ? "invalid_confirmation"
          : "invalid_reason",
      field: validated.field,
      message: validated.message,
    };
  }

  return database.transaction(async (tx): Promise<HoldWriteOutcome> => {
    const [locked] = await tx
      .select({ id: ask.id, status: ask.status })
      .from(ask)
      .where(and(eq(ask.id, input.askId), eq(ask.churchId, actor.churchId)))
      .limit(1)
      .for("update");

    if (!locked) {
      return { ok: false, code: "not_found", message: NOT_FOUND };
    }

    if (locked.status === "care_hold") {
      return {
        ok: false,
        code: "personal_care",
        message: PERSONAL_CARE_OVERRIDE_REFUSAL,
      };
    }

    if (!canOverrideHold(locked.status)) {
      return {
        ok: false,
        code: "not_held",
        message: OVERRIDE_NOT_HELD_REFUSAL,
      };
    }

    // Re-read the latest revision's Q9 inside the lock. A revision written
    // while the coordinator was on the phone must not slip personal care past
    // this conversion.
    const [latestRevision] = await tx
      .select({ id: askRevision.id })
      .from(askRevision)
      .where(eq(askRevision.askId, input.askId))
      .orderBy(desc(askRevision.createdAt), desc(askRevision.id))
      .limit(1);

    const q9Rows = latestRevision
      ? await tx
          .select({
            questionId: decision.questionId,
            answer: decision.answer,
            abstained: decision.abstained,
          })
          .from(decision)
          .where(
            and(
              eq(decision.askId, input.askId),
              eq(decision.askRevisionId, latestRevision.id),
            ),
          )
      : [];

    if (personalCareFlagged(q9Rows)) {
      return {
        ok: false,
        code: "personal_care",
        message: PERSONAL_CARE_OVERRIDE_REFUSAL,
      };
    }

    const updated = await tx
      .update(ask)
      .set({
        status: "waiting_coordinator",
        safetyOverrideAt: now,
        safetyOverrideBy: actor.personId,
        safetyOverrideReason: validated.reason,
        updatedAt: now,
      })
      .where(
        and(
          eq(ask.id, input.askId),
          eq(ask.churchId, actor.churchId),
          eq(ask.status, "safety_hold"),
        ),
      )
      .returning({ id: ask.id });

    if (updated.length === 0) {
      return {
        ok: false,
        code: "not_held",
        message: OVERRIDE_NOT_HELD_REFUSAL,
      };
    }

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: "safety_hold_overridden",
      entity: "ask",
      entityId: input.askId,
      detail: {
        fromStatus: "safety_hold",
        // Explicitly not automatic: a person pressed the confirmation and
        // wrote the reason. The tests pin both facts.
        automatic: false,
        reason: validated.reason,
        reasonLength: validated.reason.length,
        maxLength: OVERRIDE_REASON_MAX_LENGTH,
        revisionId: latestRevision?.id ?? null,
      },
    });

    return {
      ok: true,
      askId: input.askId,
      message: OVERRIDE_SUCCESS_MESSAGE,
    };
  });
}

import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import {
  ask,
  askStatusEnum,
  auditEvent,
  careRecipient,
  church,
  decision,
  policy,
  session,
  slot,
  slotCandidate,
} from "@/db/schema";
import {
  DESK_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import {
  buildManualDraft,
  constructionBlockedForStatus,
  isSlotKind,
  skippedMessage,
  validateHoldReason,
  type SessionOption,
  type SkippedProposal,
  type SlotKind,
  type SlotTier,
  type ValidatedDraftSlot,
} from "@/server/domain/slots";
import type { AppDatabase } from "./coordinator";
import { evaluateCandidatesForSlots } from "@/server/services/candidate-evaluation";

/**
 * Coordinator draft-slot reads and writes.
 *
 * Every function takes the resolved session and re-checks the desk role. Reads
 * and writes are church-scoped, and every write joins through `ask` so a draft
 * can only be changed while its ask is still `waiting_coordinator`. A published
 * or held-ask slot returns zero rows and the caller shows a calm refusal.
 *
 * Draft slots are invisible to every other role: there is no volunteer or
 * caregiver read here, and the congregation board filters
 * `status IN ('open','claimed','covered')`.
 */

export type AskStatus = (typeof askStatusEnum.enumValues)[number];

export type DraftSlotRow = {
  id: string;
  askId: string;
  kind: SlotKind;
  tier: SlotTier;
  label: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  gated: boolean;
  orientationNote: string | null;
  ruleRef: string;
  holdReason: string | null;
  heldAt: Date | null;
  status: "draft";
  sessionId: string | null;
  createdAt: Date;
};

export type DraftEditorContext = {
  askId: string;
  askStatus: AskStatus;
  slotsConstructedAt: Date | null;
  timeZone: string;
  transportEnabled: boolean;
  recipientFirstName: string;
  slots: DraftSlotRow[];
  skipped: SkippedProposal[];
  /** How many drafts the recorded construction run wrote; null if it never ran. */
  proposedCount: number | null;
  hasDecisions: boolean;
};

export type DraftSlotActionContext = {
  slotId: string;
  askId: string;
  askStatus: AskStatus;
  timeZone: string;
  transportEnabled: boolean;
};

const DRAFT_COLUMNS = {
  id: slot.id,
  askId: slot.askId,
  kind: slot.kind,
  tier: slot.tier,
  label: slot.label,
  windowStart: slot.windowStart,
  windowEnd: slot.windowEnd,
  gated: slot.gated,
  orientationNote: slot.orientationNote,
  ruleRef: slot.ruleRef,
  holdReason: slot.holdReason,
  heldAt: slot.heldAt,
  status: slot.status,
  sessionId: slot.sessionId,
  createdAt: slot.createdAt,
} as const;

/**
 * The coordinator may only change a draft while its ask is still waiting.
 * Expressed as a correlated predicate so it can run inside a transaction
 * without a second query builder.
 */
function draftIsEditable(actor: Actor) {
  return sql`EXISTS (
    SELECT 1
      FROM ask AS scoped_ask
     WHERE scoped_ask.id = ${slot.askId}
       AND scoped_ask.church_id = ${actor.churchId}
       AND scoped_ask.status = 'waiting_coordinator'
  )`;
}

/** Sessions a proposal or a manual companion place may draw on. */
export async function listSessionOptions(
  churchId: string,
  database: AppDatabase = appDb,
  from: Date = new Date(),
): Promise<SessionOption[]> {
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
         WHERE used.session_id = ${session.id}
           AND used.kind = 'companion'
           AND used.status IN ('draft','open','claimed','covered','done')
      )`,
    })
    .from(session)
    .where(and(eq(session.churchId, churchId), gt(session.startsAt, from)))
    .orderBy(asc(session.startsAt))
    .limit(12);

  return rows.map((row) => ({
    id: row.id,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    capacity: row.capacity,
    usedCompanionPlaces: Number(row.usedCompanionPlaces ?? 0),
    status: row.status,
  }));
}

type ConstructionDetail = {
  count?: unknown;
  skipped?: unknown;
};

function readSkipped(detail: unknown): SkippedProposal[] {
  if (!detail || typeof detail !== "object") return [];
  const raw = (detail as ConstructionDetail).skipped;
  if (!Array.isArray(raw)) return [];

  const skipped: SkippedProposal[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const kind = (entry as { kind?: unknown }).kind;
    const reason = (entry as { reason?: unknown }).reason;
    if (!isSlotKind(kind)) continue;
    if (reason !== "no_session_capacity" && reason !== "no_driver_policy") {
      continue;
    }
    skipped.push({ kind, reason, message: skippedMessage(reason) });
  }
  return skipped;
}

/**
 * Everything the draft editor needs, in one scoped read. Four round trips
 * (ask + policy + church, drafts, the recorded construction run, and whether
 * the nine answers exist) rather than one query per draft.
 */
export async function getDraftEditorContext(
  actor: Actor,
  askId: string,
  database: AppDatabase = appDb,
): Promise<DraftEditorContext | null> {
  requireRoleSession(actor, DESK_ROLES);

  const askRows = await database
    .select({
      id: ask.id,
      status: ask.status,
      slotsConstructedAt: ask.slotsConstructedAt,
      timeZone: church.timezone,
      transportEnabled: policy.transportEnabled,
      recipientFirstName: careRecipient.firstName,
    })
    .from(ask)
    .innerJoin(church, eq(church.id, ask.churchId))
    .innerJoin(policy, eq(policy.id, ask.policyVersionId))
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .where(and(eq(ask.id, askId), eq(ask.churchId, actor.churchId)))
    .limit(1);

  const askRow = askRows[0];
  if (!askRow) return null;

  const [slotRows, constructionRows, decisionCounts] = await Promise.all([
    database
      .select(DRAFT_COLUMNS)
      .from(slot)
      .where(
        and(
          eq(slot.askId, askRow.id),
          eq(slot.churchId, actor.churchId),
          eq(slot.status, "draft"),
        ),
      )
      .orderBy(asc(slot.createdAt), asc(slot.id)),
    database
      .select({ detail: auditEvent.detail })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.churchId, actor.churchId),
          eq(auditEvent.entity, "ask"),
          eq(auditEvent.entityId, askRow.id),
          eq(auditEvent.action, "slots_proposed"),
        ),
      )
      .orderBy(desc(auditEvent.createdAt))
      .limit(1),
    database
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(decision)
      .where(eq(decision.askId, askRow.id)),
  ]);

  const detail = constructionRows[0]?.detail ?? null;
  const count =
    detail && typeof detail === "object" && "count" in detail
      ? Number((detail as ConstructionDetail).count)
      : null;

  return {
    askId: askRow.id,
    askStatus: askRow.status,
    slotsConstructedAt: askRow.slotsConstructedAt,
    timeZone: askRow.timeZone,
    transportEnabled: askRow.transportEnabled,
    recipientFirstName: askRow.recipientFirstName,
    slots: slotRows
      .filter((row) => isSlotKind(row.kind))
      .map((row) => ({
        ...row,
        kind: row.kind as SlotKind,
        tier: row.tier as SlotTier,
        status: "draft" as const,
      })),
    skipped: readSkipped(detail),
    proposedCount: Number.isFinite(count) ? count : null,
    hasDecisions: Number(decisionCounts[0]?.count ?? 0) > 0,
  };
}

/** The context an edit, hold, release, or remove action needs for one slot. */
export async function getDraftSlotActionContext(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
): Promise<DraftSlotActionContext | null> {
  requireRoleSession(actor, DESK_ROLES);

  const rows = await database
    .select({
      slotId: slot.id,
      askId: ask.id,
      askStatus: ask.status,
      timeZone: church.timezone,
      transportEnabled: policy.transportEnabled,
    })
    .from(slot)
    .innerJoin(ask, eq(ask.id, slot.askId))
    .innerJoin(church, eq(church.id, ask.churchId))
    .innerJoin(policy, eq(policy.id, ask.policyVersionId))
    .where(
      and(
        eq(slot.id, slotId),
        eq(slot.churchId, actor.churchId),
        eq(ask.churchId, actor.churchId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export type DraftWriteResult =
  | { ok: true; askId: string; slotId: string; message: string }
  | { ok: false; message: string };

const NOT_EDITABLE_SENTENCE =
  "This time can no longer be changed here. Only drafts on an ask that is still waiting for a coordinator can be edited.";

const DRIVE_POLICY_SENTENCE =
  "A drive can only be offered after the church signs its volunteer-driver policy. No change was saved.";

/** A drive needs the signed driver policy, on every write path. */
async function transportAllowed(
  actor: Actor,
  slotId: string,
  database: AppDatabase,
): Promise<boolean> {
  const rows = await database
    .select({ enabled: policy.transportEnabled })
    .from(slot)
    .innerJoin(ask, eq(ask.id, slot.askId))
    .innerJoin(policy, eq(policy.id, ask.policyVersionId))
    .where(
      and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)),
    )
    .limit(1);

  return rows[0]?.enabled === true;
}

/**
 * Save kind, label, window, gated flag, and orientation note for one draft.
 * The conditional UPDATE re-checks the draft status and the ask's status, so a
 * slot published in another tab cannot be edited afterwards.
 */
export async function updateDraftSlot(
  actor: Actor,
  input: { slotId: string } & ValidatedDraftSlot,
  database: AppDatabase = appDb,
): Promise<DraftWriteResult> {
  requireRoleSession(actor, DESK_ROLES);

  if (
    input.kind === "drive" &&
    !(await transportAllowed(actor, input.slotId, database))
  ) {
    return { ok: false, message: DRIVE_POLICY_SENTENCE };
  }

  const result: DraftWriteResult = await database.transaction(async (tx) => {
    const rows = await tx
      .update(slot)
      .set({
        kind: input.kind,
        tier: input.tier,
        label: input.label,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        gated: input.gated,
        orientationNote: input.orientationNote,
      })
      .where(
        and(
          eq(slot.id, input.slotId),
          eq(slot.churchId, actor.churchId),
          eq(slot.status, "draft"),
          draftIsEditable(actor),
        ),
      )
      .returning({ id: slot.id, askId: slot.askId });

    const updated = rows[0];
    if (!updated) return { ok: false, message: NOT_EDITABLE_SENTENCE };

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: "draft_slot_edited",
      entity: "slot",
      entityId: updated.id,
      detail: {
        askId: updated.askId,
        kind: input.kind,
        tier: input.tier,
        gated: input.gated,
        hasWindow: input.windowStart !== null,
        hasOrientationNote: input.orientationNote !== null,
      },
    });

    return {
      ok: true,
      askId: updated.askId,
      slotId: updated.id,
      message: "Saved. It is still a draft — nobody can see it yet.",
    };
  });

  if (result.ok) {
    // The window, kind, or gated flag may have changed, so the recorded
    // explanation for every volunteer is refreshed in place.
    await evaluateCandidatesForSlots(database, {
      churchId: actor.churchId,
      slotIds: [result.slotId],
    });
  }

  return result;
}

/**
 * Hold a draft with a required human reason. A held draft still belongs to the
 * coordinator, but publication refuses until the hold is resolved.
 */
export async function holdDraftSlot(
  actor: Actor,
  input: { slotId: string; reason: unknown },
  database: AppDatabase = appDb,
): Promise<DraftWriteResult> {
  requireRoleSession(actor, DESK_ROLES);

  const validated = validateHoldReason(input.reason);
  if (!validated.ok) return { ok: false, message: validated.message };

  return database.transaction(async (tx) => {
    const rows = await tx
      .update(slot)
      .set({
        holdReason: validated.reason,
        heldAt: new Date(),
        heldBy: actor.personId,
      })
      .where(
        and(
          eq(slot.id, input.slotId),
          eq(slot.churchId, actor.churchId),
          eq(slot.status, "draft"),
          draftIsEditable(actor),
        ),
      )
      .returning({ id: slot.id, askId: slot.askId });

    const held = rows[0];
    if (!held) return { ok: false, message: NOT_EDITABLE_SENTENCE };

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: "draft_slot_held",
      entity: "slot",
      entityId: held.id,
      detail: { askId: held.askId, reason: validated.reason },
    });

    return {
      ok: true,
      askId: held.askId,
      slotId: held.id,
      message:
        "Held. This draft cannot be published until the hold is resolved.",
    };
  });
}

/** Resolve a hold. The audit log keeps the reason that was resolved. */
export async function releaseDraftSlot(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
): Promise<DraftWriteResult> {
  requireRoleSession(actor, DESK_ROLES);

  return database.transaction(async (tx) => {
    const rows = await tx
      .update(slot)
      .set({ holdReason: null, heldAt: null, heldBy: null })
      .where(
        and(
          eq(slot.id, slotId),
          eq(slot.churchId, actor.churchId),
          eq(slot.status, "draft"),
          draftIsEditable(actor),
        ),
      )
      .returning({
        id: slot.id,
        askId: slot.askId,
        holdReason: slot.holdReason,
      });

    const released = rows[0];
    if (!released) return { ok: false, message: NOT_EDITABLE_SENTENCE };

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: "draft_slot_hold_resolved",
      entity: "slot",
      entityId: released.id,
      detail: { askId: released.askId, resolvedReason: released.holdReason },
    });

    return {
      ok: true,
      askId: released.askId,
      slotId: released.id,
      message: "Hold resolved. This draft can be published again.",
    };
  });
}

/**
 * Remove a draft. Only a draft on a waiting ask can be deleted; the audit row
 * records the kind and label so the removal is not silent.
 */
export async function removeDraftSlot(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
): Promise<DraftWriteResult> {
  requireRoleSession(actor, DESK_ROLES);

  return database.transaction(async (tx) => {
    const [target] = await tx
      .select({
        id: slot.id,
        askId: slot.askId,
        kind: slot.kind,
        label: slot.label,
        ruleRef: slot.ruleRef,
        holdReason: slot.holdReason,
      })
      .from(slot)
      .where(
        and(
          eq(slot.id, slotId),
          eq(slot.churchId, actor.churchId),
          eq(slot.status, "draft"),
          draftIsEditable(actor),
        ),
      )
      .limit(1)
      .for("update");

    if (!target) return { ok: false, message: NOT_EDITABLE_SENTENCE };

    // A later exclusion panel writes candidate rows per volunteer per slot.
    // Removing a draft must not trip that foreign key; the candidates go with
    // the draft they were considered for. The row is locked above, so a
    // concurrent publish cannot slip between these two statements.
    await tx.delete(slotCandidate).where(eq(slotCandidate.slotId, target.id));

    const rows = await tx
      .delete(slot)
      .where(
        and(
          eq(slot.id, target.id),
          eq(slot.churchId, actor.churchId),
          eq(slot.status, "draft"),
          draftIsEditable(actor),
        ),
      )
      .returning({ id: slot.id });

    const removed = rows[0];
    if (!removed) return { ok: false, message: NOT_EDITABLE_SENTENCE };

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: "draft_slot_removed",
      entity: "slot",
      entityId: target.id,
      detail: {
        askId: target.askId,
        kind: target.kind,
        label: target.label,
        ruleRef: target.ruleRef,
        wasHeld: target.holdReason !== null,
      },
    });

    return {
      ok: true,
      askId: target.askId,
      slotId: target.id,
      message: "Draft removed. Nothing was ever published from it.",
    };
  });
}

/**
 * Add a coordinator-authored draft. Personal care and safety asks are refused
 * before any insert: there is no branch that turns a held ask into a slot.
 */
export async function addDraftSlot(
  actor: Actor,
  input: { askId: string; kind: unknown },
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<DraftWriteResult> {
  requireRoleSession(actor, DESK_ROLES);

  if (!isSlotKind(input.kind)) {
    return { ok: false, message: "Choose companion, home, drive, or meal." };
  }

  const rows = await database
    .select({
      id: ask.id,
      status: ask.status,
      timeZone: church.timezone,
      transportEnabled: policy.transportEnabled,
      recipientFirstName: careRecipient.firstName,
    })
    .from(ask)
    .innerJoin(church, eq(church.id, ask.churchId))
    .innerJoin(policy, eq(policy.id, ask.policyVersionId))
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .where(and(eq(ask.id, input.askId), eq(ask.churchId, actor.churchId)))
    .limit(1);

  const askRow = rows[0];
  if (!askRow) {
    return { ok: false, message: "That ask is not available." };
  }

  const blocked = constructionBlockedForStatus(askRow.status);
  if (blocked) {
    return { ok: false, message: blocked.message };
  }

  const sessions = await listSessionOptions(actor.churchId, database, now);
  const manual = buildManualDraft({
    kind: input.kind,
    recipientFirstName: askRow.recipientFirstName,
    sessions,
    now,
    timeZone: askRow.timeZone,
    transportEnabled: askRow.transportEnabled,
  });
  if (!manual.ok) return { ok: false, message: manual.message };

  const proposal = manual.proposal;

  const result = await database.transaction(async (tx) => {
    const inserted = await tx
      .insert(slot)
      .values({
        askId: askRow.id,
        churchId: actor.churchId,
        sessionId: proposal.sessionId,
        kind: proposal.kind,
        tier: proposal.tier,
        label: proposal.label,
        windowStart: proposal.windowStart,
        windowEnd: proposal.windowEnd,
        gated: proposal.gated,
        orientationNote: proposal.orientationNote,
        ruleRef: "manual",
        status: "draft",
      })
      .returning({ id: slot.id });

    const slotId = inserted[0].id;

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: "draft_slot_added",
      entity: "slot",
      entityId: slotId,
      detail: {
        askId: askRow.id,
        kind: proposal.kind,
        tier: proposal.tier,
        ruleRef: "manual",
        label: proposal.label,
      },
    });

    return {
      ok: true as const,
      askId: askRow.id,
      slotId,
      message: "Added. It is a draft — nobody can see it yet.",
    };
  });

  await evaluateCandidatesForSlots(database, {
    churchId: actor.churchId,
    slotIds: [result.slotId],
    now,
  });

  return result;
}

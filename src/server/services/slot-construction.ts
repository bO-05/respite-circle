import { and, asc, eq, isNull } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import {
  ask,
  askRevision,
  auditEvent,
  careRecipient,
  church,
  decision,
  policy,
  slot,
} from "@/db/schema";
import {
  DESK_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import {
  buildDraftSlots,
  constructionBlockedForStatus,
  type ConstructionBlock,
  type SkippedProposal,
  type TypedAnswer,
} from "@/server/domain/slots";
import { listSessionOptions } from "@/server/repositories/draft-slots";
import type { AppDatabase } from "@/server/repositories/coordinator";

/**
 * Turn the nine typed answers into draft slots, once per ask.
 *
 * This is plain code: it reads only closed decision values and writes only
 * draft rows. The model is never called, and the caregiver's words are never
 * read. `ask.slots_constructed_at` is claimed in the same transaction as the
 * inserts, so:
 *   - a retry cannot duplicate drafts;
 *   - a coordinator who removes every draft does not see them reappear;
 *   - two concurrent runs produce one winner.
 *
 * A held ask, or an abstention on a need question, writes nothing. The caller
 * is `submitAsk` (right after the decisions persist) or a coordinator's
 * explicit "Propose times" action.
 */

export type ConstructDraftSlotsInput = {
  askId: string;
  churchId: string;
  database?: AppDatabase;
  now?: Date;
};

export type ConstructionOutcomeReason =
  | "created"
  | "already_constructed"
  | "not_reviewable"
  | "no_answers"
  | "blocked"
  | "not_found";

export type ConstructDraftSlotsResult = {
  created: boolean;
  reason: ConstructionOutcomeReason;
  proposals: number;
  skipped: SkippedProposal[];
  blocked: ConstructionBlock | null;
};

function outcome(
  reason: ConstructionOutcomeReason,
  result: Partial<ConstructDraftSlotsResult> = {},
): ConstructDraftSlotsResult {
  return {
    created: false,
    reason,
    proposals: 0,
    skipped: [],
    blocked: null,
    ...result,
  };
}

export async function constructDraftSlots(
  input: ConstructDraftSlotsInput,
): Promise<ConstructDraftSlotsResult> {
  const database = input.database ?? appDb;
  const now = input.now ?? new Date();

  const askRows = await database
    .select({
      id: ask.id,
      status: ask.status,
      slotsConstructedAt: ask.slotsConstructedAt,
      policyVersionId: ask.policyVersionId,
      timeZone: church.timezone,
      transportEnabled: policy.transportEnabled,
      recipientFirstName: careRecipient.firstName,
    })
    .from(ask)
    .innerJoin(church, eq(church.id, ask.churchId))
    .innerJoin(policy, eq(policy.id, ask.policyVersionId))
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .where(and(eq(ask.id, input.askId), eq(ask.churchId, input.churchId)))
    .limit(1);

  const askRow = askRows[0];
  if (!askRow) return outcome("not_found");

  const blocked = constructionBlockedForStatus(askRow.status);
  if (blocked) {
    // A hold is never turned into a slot, and it is never logged as a proposal.
    return outcome("blocked", { blocked });
  }

  if (askRow.slotsConstructedAt) {
    return outcome("already_constructed");
  }

  const revisions = await database
    .select({ id: askRevision.id })
    .from(askRevision)
    .where(eq(askRevision.askId, askRow.id))
    .orderBy(asc(askRevision.createdAt), asc(askRevision.id))
    .limit(1_000);

  const latestRevision = revisions.at(-1);
  if (!latestRevision) {
    return outcome("no_answers", {
      blocked: {
        reason: "not_reviewable",
        message:
          "No words or typed answers are recorded for this ask yet, so plain code has nothing to read.",
      },
    });
  }

  const answerRows = await database
    .select({
      questionId: decision.questionId,
      answer: decision.answer,
      abstained: decision.abstained,
    })
    .from(decision)
    .where(
      and(
        eq(decision.askId, askRow.id),
        eq(decision.askRevisionId, latestRevision.id),
      ),
    )
    .orderBy(asc(decision.questionId));

  if (answerRows.length === 0) {
    return outcome("no_answers", {
      blocked: {
        reason: "not_reviewable",
        message:
          "The nine typed answers are not recorded yet, so plain code has nothing to read. A person will read the words first.",
      },
    });
  }

  const answers: TypedAnswer[] = answerRows.map((row) => ({
    questionId: row.questionId,
    answer: row.answer,
    abstained: row.abstained,
  }));

  const sessions = await listSessionOptions(
    input.churchId,
    database,
    now,
  );

  const plan = buildDraftSlots({
    answers,
    sessions,
    recipientFirstName: askRow.recipientFirstName,
    policy: { transportEnabled: askRow.transportEnabled },
    now,
    timeZone: askRow.timeZone,
  });

  if (plan.blocked) {
    await database.insert(auditEvent).values({
      churchId: input.churchId,
      actorType: "system",
      actorId: null,
      action: "slot_construction_blocked",
      entity: "ask",
      entityId: askRow.id,
      detail: {
        reason: plan.blocked.reason,
        questionIds: plan.blocked.questionIds ?? [],
      },
    });

    return outcome("blocked", { blocked: plan.blocked });
  }

  const recorded = await database.transaction(async (tx) => {
    // Claim the one-time construction marker before writing anything. A second
    // run (or a concurrent one) matches no row and writes nothing.
    const marked = await tx
      .update(ask)
      .set({ slotsConstructedAt: now })
      .where(
        and(
          eq(ask.id, askRow.id),
          eq(ask.churchId, input.churchId),
          eq(ask.status, "waiting_coordinator"),
          isNull(ask.slotsConstructedAt),
        ),
      )
      .returning({ id: ask.id });

    if (!marked[0]) return { won: false, slotIds: [] as string[] };

    let slotIds: string[] = [];
    if (plan.proposals.length > 0) {
      const inserted = await tx
        .insert(slot)
        .values(
          plan.proposals.map((proposal) => ({
            askId: askRow.id,
            churchId: input.churchId,
            sessionId: proposal.sessionId,
            kind: proposal.kind,
            tier: proposal.tier,
            label: proposal.label,
            windowStart: proposal.windowStart,
            windowEnd: proposal.windowEnd,
            gated: proposal.gated,
            orientationNote: proposal.orientationNote,
            ruleRef: proposal.ruleRef,
            status: "draft" as const,
          })),
        )
        .returning({ id: slot.id });

      slotIds = inserted.map((row) => row.id);
    }

    await tx.insert(auditEvent).values({
      churchId: input.churchId,
      actorType: "system",
      actorId: null,
      action: "slots_proposed",
      entity: "ask",
      entityId: askRow.id,
      detail: {
        count: plan.proposals.length,
        kinds: plan.proposals.map((proposal) => proposal.kind),
        ruleRefs: plan.proposals.map((proposal) => proposal.ruleRef),
        skipped: plan.skipped.map((entry) => ({
          kind: entry.kind,
          reason: entry.reason,
        })),
        noNeed: plan.proposals.length === 0 && plan.skipped.length === 0,
        policyVersionId: askRow.policyVersionId,
        revisionId: latestRevision.id,
      },
    });

    return { won: true, slotIds };
  });

  if (!recorded.won) return outcome("already_constructed");

  return {
    created: true,
    reason: "created",
    proposals: recorded.slotIds.length,
    skipped: plan.skipped,
    blocked: null,
  };
}

/**
 * The coordinator's explicit retry. Only a desk role can ask, and the service
 * still refuses any ask that is not waiting or speaks personal care.
 */
export async function proposeDraftsForAsk(
  actor: Actor,
  askId: string,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<ConstructDraftSlotsResult> {
  requireRoleSession(actor, DESK_ROLES);

  return constructDraftSlots({
    askId,
    churchId: actor.churchId,
    database,
    now,
  });
}

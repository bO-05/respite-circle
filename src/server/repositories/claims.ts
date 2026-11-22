import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import { auditEvent, church, slot } from "@/db/schema";
import type { Actor } from "@/server/auth/policy";
import {
  claimCopy,
  isUuid,
  type ClaimOutcomeCode,
} from "@/server/domain/claim";
import type { RuleCode } from "@/server/domain/gating";
import type { AppDatabase } from "./coordinator";
import { claimGatePredicate } from "./claim-gate";
import {
  readGatingRow,
  readViewerFacts,
  verdictFor,
} from "./gating-facts";

/**
 * The only claim write path.
 *
 * Success is a single conditional `UPDATE` whose `WHERE` clause carries the
 * status, the empty claim column, the publication instant, and the whole gate.
 * The claim audit row commits in the same transaction as the update: a claim
 * that cannot be audited cannot happen.
 *
 * A zero-row update is not an error and never a 500. The route re-reads the row
 * and the same `canClaim` facts to answer with a closed code and one human
 * sentence. Every refusal is audited too, with the reason and, when a rule
 * applies, its code — never SQL text and never another person's identity.
 */

export type ClaimOutcome =
  | {
      ok: true;
      code: "claimed";
      slotId: string;
      status: "claimed";
      message: string;
    }
  | {
      ok: false;
      code: Exclude<ClaimOutcomeCode, "claimed">;
      /** The slot the request named, when it was a well-formed id. */
      slotId: string | null;
      ruleCode: RuleCode | null;
      message: string;
    };

export const CLAIM_AUDIT_ACTIONS = {
  claimed: "slot_claimed",
  refused: "claim_refused",
} as const;

type RefusalDetail = {
  reason: Exclude<ClaimOutcomeCode, "claimed">;
  ruleCode?: RuleCode | null;
  slotStatus?: string | null;
};

async function recordRefusal(
  database: AppDatabase,
  actor: Actor,
  slotId: string | null,
  detail: RefusalDetail,
): Promise<void> {
  await database.insert(auditEvent).values({
    churchId: actor.churchId,
    actorType: "human",
    actorId: actor.personId,
    action: CLAIM_AUDIT_ACTIONS.refused,
    entity: "slot",
    entityId: slotId,
    detail,
  });
}

function refusal(
  code: Exclude<ClaimOutcomeCode, "claimed">,
  slotId: string | null,
  ruleCode: RuleCode | null = null,
): ClaimOutcome {
  return {
    ok: false,
    code,
    slotId,
    ruleCode,
    message: claimCopy(code, { ruleCode }),
  };
}

export async function claimSlot(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<ClaimOutcome> {
  // The route admits any signed-in person so this branch can be audited; a
  // desk role or a caregiver can never take a place from the board.
  if (actor.role !== "volunteer") {
    const id = isUuid(slotId) ? slotId : null;
    await recordRefusal(database, actor, id, { reason: "not_volunteer" });
    return refusal("not_volunteer", id);
  }

  if (!isUuid(slotId)) {
    await recordRefusal(database, actor, null, { reason: "not_found" });
    return refusal("not_found", null);
  }

  const wonId = await database.transaction(async (tx) => {
    const rows = await tx
      .update(slot)
      .set({
        claimedBy: actor.personId,
        claimedAt: now,
        status: "claimed",
      })
      .where(
        and(
          eq(slot.id, slotId),
          eq(slot.churchId, actor.churchId),
          eq(slot.status, "open"),
          isNull(slot.claimedBy),
          // Published by a person, not merely marked open.
          isNotNull(slot.approvedAt),
          claimGatePredicate({
            personId: actor.personId,
            churchId: actor.churchId,
            now,
          }),
        ),
      )
      .returning({ id: slot.id });

    const row = rows[0];
    if (!row) return null;

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: CLAIM_AUDIT_ACTIONS.claimed,
      entity: "slot",
      entityId: row.id,
      detail: { previousStatus: "open", claimedAt: now.toISOString() },
    });

    return row.id;
  });

  if (wonId) {
    return {
      ok: true,
      code: "claimed",
      slotId: wonId,
      status: "claimed",
      message: claimCopy("claimed"),
    };
  }

  // The update matched no row. Explain it with the same facts the board uses;
  // this read is advisory only and never the enforcement.
  const stateRows = await database
    .select({
      status: slot.status,
      claimedBy: slot.claimedBy,
      approvedAt: slot.approvedAt,
      timeZone: church.timezone,
    })
    .from(slot)
    .innerJoin(church, eq(church.id, slot.churchId))
    .where(and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)))
    .limit(1);

  const state = stateRows[0];
  if (!state) {
    await recordRefusal(database, actor, slotId, { reason: "not_found" });
    return refusal("not_found", slotId);
  }

  if (state.status === "draft" || state.approvedAt === null) {
    await recordRefusal(database, actor, slotId, {
      reason: "not_found",
      slotStatus: state.status,
    });
    return refusal("not_found", slotId);
  }

  if (state.claimedBy === actor.personId) {
    await recordRefusal(database, actor, slotId, {
      reason: "already_yours",
      slotStatus: state.status,
    });
    return refusal("already_yours", slotId);
  }

  if (
    state.claimedBy !== null ||
    state.status === "claimed" ||
    state.status === "covered"
  ) {
    await recordRefusal(database, actor, slotId, {
      reason: "taken",
      slotStatus: state.status,
    });
    return refusal("taken", slotId);
  }

  if (state.status !== "open") {
    await recordRefusal(database, actor, slotId, {
      reason: "not_open",
      slotStatus: state.status,
    });
    return refusal("not_open", slotId);
  }

  // Still open and unclaimed: the gate refused this volunteer. The pure
  // predicate names the rule; the statement already enforced it.
  const [viewer, gatingRow] = await Promise.all([
    readViewerFacts(database, actor),
    readGatingRow(database, actor.churchId, slotId),
  ]);

  const verdict = gatingRow
    ? verdictFor(viewer, gatingRow, state.timeZone, now)
    : null;
  const ruleCode = verdict && !verdict.eligible ? verdict.ruleCode : null;

  await recordRefusal(database, actor, slotId, {
    reason: "locked",
    ruleCode,
    slotStatus: state.status,
  });

  return refusal("locked", slotId, ruleCode);
}

import { and, asc, eq } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import { ask, decision, policy, slot } from "@/db/schema";
import {
  CAREGIVER_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import type { AppDatabase } from "./coordinator";

/**
 * The caregiver's read of the decision trail.
 *
 * It returns only the nine rows booked against the exact revision the receipt
 * is showing. Earlier revisions keep their answers in the append-only table,
 * but a page can never mix them into the current trail: a superseded answer is
 * not readable here at all. Every query joins the ask and re-checks the
 * caregiver and church, so an id from another family returns null.
 */

export type DecisionTrailRow = {
  questionId: string;
  questionText: string;
  answerType: "yesno" | "pick";
  answer: boolean | string;
  confidence: number;
  abstained: boolean;
  samples: number | null;
  provider: string;
  model: string;
  latencyMs: number | null;
  digest: string;
};

export type DecisionRunMetadata = {
  provider: string;
  model: string;
  latencyMs: number | null;
};

export type DecisionTrailView = {
  askId: string;
  revisionId: string;
  policyVersion: number | null;
  decisions: DecisionTrailRow[];
  run: DecisionRunMetadata | null;
  /** Kinds plain code has proposed but the coordinator has not published. */
  draftKinds: string[];
  /** Slots the congregation can already see (open, claimed, covered, done). */
  publishedCount: number;
};

const PUBLISHED_SLOT_STATUSES = new Set([
  "open",
  "claimed",
  "covered",
  "done",
]);

export async function getDecisionTrailForRevision(
  actor: Actor,
  input: { askId: string; revisionId: string },
  database: AppDatabase = appDb,
): Promise<DecisionTrailView | null> {
  requireRoleSession(actor, CAREGIVER_ROLES);

  const ownedWhere = and(
    eq(ask.id, input.askId),
    eq(ask.churchId, actor.churchId),
    eq(ask.caregiverId, actor.personId),
  );

  const [ownedRows, decisionRows, slotRows] = await Promise.all([
    database
      .select({ id: ask.id })
      .from(ask)
      .where(ownedWhere)
      .limit(1),
    database
      .select({
        questionId: decision.questionId,
        questionText: decision.questionText,
        answerType: decision.answerType,
        answer: decision.answer,
        confidence: decision.confidence,
        abstained: decision.abstained,
        samples: decision.samples,
        provider: decision.provider,
        model: decision.model,
        latencyMs: decision.latencyMs,
        digest: decision.digest,
        policyVersion: policy.version,
      })
      .from(decision)
      .innerJoin(ask, eq(ask.id, decision.askId))
      .innerJoin(policy, eq(policy.id, decision.policyVersionId))
      .where(
        and(
          eq(decision.askId, input.askId),
          eq(decision.askRevisionId, input.revisionId),
          eq(ask.churchId, actor.churchId),
          eq(ask.caregiverId, actor.personId),
        ),
      )
      .orderBy(asc(decision.questionId)),
    database
      .select({ status: slot.status, kind: slot.kind })
      .from(slot)
      .innerJoin(ask, eq(ask.id, slot.askId))
      .where(
        and(
          eq(slot.askId, input.askId),
          eq(ask.churchId, actor.churchId),
          eq(ask.caregiverId, actor.personId),
        ),
      ),
  ]);

  if (!ownedRows[0]) return null;

  const first = decisionRows[0];
  const draftKinds = slotRows
    .filter((row) => row.status === "draft")
    .map((row) => row.kind);

  return {
    askId: input.askId,
    revisionId: input.revisionId,
    policyVersion: first?.policyVersion ?? null,
    decisions: decisionRows.map((row) => ({
      questionId: row.questionId,
      questionText: row.questionText,
      answerType: row.answerType,
      answer: row.answer,
      confidence: row.confidence,
      abstained: row.abstained,
      samples: row.samples,
      provider: row.provider,
      model: row.model,
      latencyMs: row.latencyMs,
      digest: row.digest,
    })),
    run: first
      ? {
          provider: first.provider,
          model: first.model,
          latencyMs: first.latencyMs,
        }
      : null,
    draftKinds,
    publishedCount: slotRows.filter((row) =>
      PUBLISHED_SLOT_STATUSES.has(row.status),
    ).length,
  };
}

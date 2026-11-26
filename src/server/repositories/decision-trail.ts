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
  /**
   * `rule` when the app's fixed Q5/Q9 screen produced this answer rather than
   * the model. The receipt must say so and must not show it as model
   * confidence.
   */
  signalSource: "model" | "rule" | null;
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
  /** The language router's finding, persisted on the ask. */
  language: string;
  bilingualNeeded: boolean;
  /** Kinds plain code has proposed but the coordinator has not published. */
  draftKinds: string[];
  /** Slots the congregation can already see (open, claimed, covered, done). */
  publishedCount: number;
  /**
   * Slots a neighbour took and a coordinator confirmed (covered or done).
   * The receipt's last lifecycle stage may only be reached on this count.
   */
  coveredCount: number;
};

const PUBLISHED_SLOT_STATUSES = new Set([
  "open",
  "claimed",
  "covered",
  "done",
]);

const COVERED_SLOT_STATUSES = new Set(["covered", "done"]);

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
      .select({
        id: ask.id,
        language: ask.language,
        bilingualNeeded: ask.bilingualNeeded,
      })
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
        signalSource: decision.signalSource,
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
    language: ownedRows[0].language,
    bilingualNeeded: ownedRows[0].bilingualNeeded,
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
      signalSource:
        row.signalSource === "rule" || row.signalSource === "model"
          ? row.signalSource
          : null,
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
    coveredCount: slotRows.filter((row) =>
      COVERED_SLOT_STATUSES.has(row.status),
    ).length,
  };
}

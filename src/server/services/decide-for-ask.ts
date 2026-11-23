import { and, eq, inArray } from "drizzle-orm";
import type { PolicyQuestion } from "@/db/schema";
import { db as appDb } from "@/db/client";
import { ask, auditEvent, decision } from "@/db/schema";
import type { AppDatabase } from "@/server/repositories/coordinator";
import { decide, type DecideResult } from "./decide";
import { computeDecisionDigest } from "./decision-contract";
import type { DecisionProvider, EnvLike } from "./providers";

/**
 * Decide one ask and record what happened.
 *
 * One transaction writes one decision row per question and exactly one audit
 * event. The audit detail carries the input digest, provider, model, latency,
 * policy version, and routing — never the caregiver's words. The ask moves to
 * the coordinator queue or a hold, and a hold is sticky: a later run can never
 * move an ask out of `safety_hold` or `care_hold`.
 */

export type DecideForAskInput = {
  askId: string;
  /**
   * The exact `ask_revision` these answers are about. A revision re-runs the
   * nine questions and books the new row here, so the trail can filter to the
   * wording it actually answered.
   */
  revisionId: string;
  churchId: string;
  askText: string;
  policy: {
    id: string;
    questionSet: readonly PolicyQuestion[];
  };
  provider?: DecisionProvider;
  timeoutMs?: number;
  language?: string | null;
  actorId?: string | null;
  database?: AppDatabase;
  env?: EnvLike;
};

export type DecideForAskResult = DecideResult & {
  persisted: boolean;
  persistenceFailed: boolean;
  decisionIds: string[];
  auditEventId: string | null;
};

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code).slice(0, 40);
  }
  return "unknown";
}

export async function decideForAsk(
  input: DecideForAskInput,
): Promise<DecideForAskResult> {
  const database = input.database ?? appDb;

  const run = await decide({
    askText: input.askText,
    questions: input.policy.questionSet,
    policyVersion: input.policy.id,
    language: input.language ?? null,
    provider: input.provider,
    timeoutMs: input.timeoutMs,
    env: input.env,
  });

  try {
    const recorded = await database.transaction(async (tx) => {
      const decisionIds: string[] = [];

      for (const outcome of run.decisions) {
        const digest = computeDecisionDigest({
          askId: input.askId,
          policyVersionId: input.policy.id,
          questionId: outcome.questionId,
          questionText: outcome.questionText,
          answerType: outcome.answerType,
          answer: outcome.answer,
          confidence: outcome.confidence,
          abstained: outcome.abstained,
          samples: outcome.samples,
          provider: run.provider,
          model: run.model,
          latencyMs: run.latencyMs,
          inputDigest: run.digest,
        });

        const [row] = await tx
          .insert(decision)
          .values({
            askId: input.askId,
            askRevisionId: input.revisionId,
            policyVersionId: input.policy.id,
            questionId: outcome.questionId,
            questionText: outcome.questionText,
            answerType: outcome.answerType,
            answer: outcome.answer,
            confidence: outcome.confidence,
            abstained: outcome.abstained,
            samples: outcome.samples,
            model: run.model,
            provider: run.provider,
            latencyMs: run.latencyMs,
            digest,
          })
          .returning({ id: decision.id });

        decisionIds.push(row.id);
      }

      const [audit] = await tx
        .insert(auditEvent)
        .values({
          churchId: input.churchId,
          actorType: "ai",
          actorId: input.actorId ?? null,
          action: "ai_decision",
          entity: "ask",
          entityId: input.askId,
          detail: {
            inputDigest: run.digest,
            revisionId: input.revisionId,
            provider: run.provider,
            model: run.model,
            engine: run.engine,
            latencyMs: run.latencyMs,
            policyVersionId: input.policy.id,
            questionCount: run.decisions.length,
            abstainedCount: run.decisions.filter(
              (outcome) => outcome.abstained,
            ).length,
            degraded: run.degraded,
            routingStatus: run.routing.status,
            bilingualNeeded: run.routing.bilingualNeeded,
            slotConstructionAllowed: run.routing.slotConstructionAllowed,
            language: run.language.code,
            attempts: run.attempts,
            samplesIncomplete: run.samplesIncomplete,
          },
        })
        .returning({ id: auditEvent.id });

      // A hold is sticky. Only a draft or an ask already in the coordinator
      // queue may move; an approved, closed, withdrawn, or held ask is left to
      // the humans who own it.
      await tx
        .update(ask)
        .set({
          status: run.routing.status,
          language: run.language.code,
          // The bilingual handoff is a fact about this ask, not a value a
          // reader may recompute differently later. Persist it beside the
          // language so the desk and the trail can name the reason.
          bilingualNeeded: run.routing.bilingualNeeded,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ask.id, input.askId),
            eq(ask.churchId, input.churchId),
            inArray(ask.status, ["draft", "waiting_coordinator"]),
          ),
        );

      return { decisionIds, auditEventId: audit.id };
    });

    return {
      ...run,
      persisted: true,
      persistenceFailed: false,
      decisionIds: recorded.decisionIds,
      auditEventId: recorded.auditEventId,
    };
  } catch (error) {
    // Never surface a database failure as a 500 to the caregiver. The typed
    // result is still returned; the caller shows the calm "a person will read
    // this" state. Log only a code — never an error string that could carry a
    // query parameter.
    console.error(
      `decision persistence failed (${safeErrorCode(error)})`,
    );
    return {
      ...run,
      persisted: false,
      persistenceFailed: true,
      decisionIds: [],
      auditEventId: null,
    };
  }
}

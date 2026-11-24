import { and, eq, inArray } from "drizzle-orm";
import type { PolicyQuestion } from "@/db/schema";
import { ask, auditEvent, decision } from "@/db/schema";
import type { AppDatabase } from "@/server/repositories/coordinator";
import type { DecideResult } from "./decide";
import { computeDecisionDigest } from "./decision-contract";

/**
 * Persist one completed decision run.
 *
 * This is the single write path for the nine typed answers: the caregiver
 * intake calls it through `decideForAsk`, and the demo reset calls it after
 * its own provider run so a seeded ask and a submitted ask are written the
 * same way. One transaction writes one `decision` row per question and exactly
 * one audit event. The audit detail carries the input digest, provider, model,
 * latency, policy version, and routing — never the caregiver's words.
 *
 * The database is a required argument on purpose: importing `@/db/client`
 * here would open the app connection at module load, which breaks a CLI that
 * loads `.env.local` after its imports.
 */

export type PersistDecisionRunInput = {
  askId: string;
  revisionId: string;
  churchId: string;
  policy: {
    id: string;
    questionSet: readonly PolicyQuestion[];
  };
  actorId?: string | null;
  database: AppDatabase;
};

export type PersistDecisionRunResult = {
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

export async function persistDecisionRun(
  run: DecideResult,
  input: PersistDecisionRunInput,
): Promise<PersistDecisionRunResult> {
  try {
    const recorded = await input.database.transaction(async (tx) => {
      // One insert for the nine rows: Neon round trips are the cost here, and
      // the digest is computed locally. Postgres returns the generated ids in
      // the order of the VALUES list.
      const rows = run.decisions.map((outcome) => ({
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
        digest: computeDecisionDigest({
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
        }),
      }));

      const inserted = await tx
        .insert(decision)
        .values(rows)
        .returning({ id: decision.id });
      const decisionIds = inserted.map((row) => row.id);

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
    console.error(`decision persistence failed (${safeErrorCode(error)})`);
    return {
      persisted: false,
      persistenceFailed: true,
      decisionIds: [],
      auditEventId: null,
    };
  }
}

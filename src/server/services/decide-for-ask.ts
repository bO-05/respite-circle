import { db as appDb } from "@/db/client";
import type { PolicyQuestion } from "@/db/schema";
import type { AppDatabase } from "@/server/repositories/coordinator";
import { decide, type DecideResult } from "./decide";
import { persistDecisionRun } from "./decision-persistence";
import type { DecisionProvider, EnvLike } from "./providers";

/**
 * Decide one ask and record what happened.
 *
 * A thin wrapper over the two shared pieces: `decide()` produces the nine
 * answers, `persistDecisionRun()` writes them in one transaction with an
 * audit event and the conservative ask status. Keeping the write path separate
 * lets the demo reset replay a seeded ask through the same code without a
 * second, divergent insert.
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

  const recorded = await persistDecisionRun(run, {
    askId: input.askId,
    revisionId: input.revisionId,
    churchId: input.churchId,
    policy: input.policy,
    actorId: input.actorId,
    database,
  });

  return { ...run, ...recorded };
}

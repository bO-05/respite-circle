import { db as appDb } from "@/db/client";
import type { PolicyQuestion } from "@/db/schema";
import {
  CAREGIVER_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import { validateAskSubmission } from "@/server/domain/ask-intake";
import {
  appendAskRevision,
  AskIntakeError,
  createAskWithRevision,
  type AskStatus,
  type AskWriteErrorCode,
} from "@/server/repositories/asks";
import type { AppDatabase } from "@/server/repositories/coordinator";
import { getPolicyInForce } from "@/server/repositories/policy";
import { decideForAsk } from "./decide-for-ask";
import type { DecisionProvider, EnvLike } from "./providers";

/**
 * One submission path for the Ask screen and `POST /api/asks`.
 *
 * Order matters for the promise made on the receipt:
 * 1. validate the words and the consent line;
 * 2. create the ask in `waiting_coordinator` and its first revision *before*
 *    any model call, so a slow or failed provider can never lose the request;
 * 3. run the nine typed decisions, which may move the ask to a hold but can
 *    never move it out of one;
 * 4. answer the caregiver with what the database actually holds.
 *
 * A revision (`revisionOf`) appends a new `ask_revision` row and does not
 * rewrite the ask. It does not re-run decisions in this feature; the desk reads
 * the latest words.
 */

export type SubmitAskFailureCode = AskWriteErrorCode | "no_policy";

export type SubmitAskSuccess = {
  ok: true;
  askId: string;
  revisionId: string;
  status: AskStatus;
  decisionsRan: boolean;
  decisionsPersisted: boolean;
};

export type SubmitAskFailure = {
  ok: false;
  code: SubmitAskFailureCode;
  message: string;
  httpStatus: 400 | 404 | 409 | 503;
};

export type SubmitAskResult = SubmitAskSuccess | SubmitAskFailure;

export type SubmitAskInput = {
  actor: Actor;
  text: unknown;
  consent: unknown;
  revisionOf?: unknown;
  database?: AppDatabase;
  provider?: DecisionProvider;
  timeoutMs?: number;
  env?: EnvLike;
};

function failure(
  code: SubmitAskFailureCode,
  message: string,
  httpStatus: SubmitAskFailure["httpStatus"],
): SubmitAskFailure {
  return { ok: false, code, message, httpStatus };
}

function failureFromError(error: AskIntakeError): SubmitAskFailure {
  if (error.code === "not_found") {
    return failure("not_found", "That ask is not available.", 404);
  }
  if (error.code === "no_recipient") {
    return failure("no_recipient", error.message, 409);
  }
  return failure(error.code, error.message, 400);
}

/** Ask ids are UUIDs. A hand-edited id is refused before a query can error. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function submitAsk(
  input: SubmitAskInput,
): Promise<SubmitAskResult> {
  requireRoleSession(input.actor, CAREGIVER_ROLES);

  const validation = validateAskSubmission({
    text: input.text,
    consent: input.consent,
  });
  if (!validation.ok) {
    return failure(validation.code, validation.message, 400);
  }

  const database = input.database ?? appDb;
  const revisionOf =
    typeof input.revisionOf === "string" ? input.revisionOf.trim() : "";

  if (revisionOf.length > 0) {
    if (!UUID_PATTERN.test(revisionOf)) {
      return failure("not_found", "That ask is not available.", 404);
    }
    try {
      const revised = await appendAskRevision(
        input.actor,
        { askId: revisionOf, text: validation.text },
        database,
      );
      return {
        ok: true,
        askId: revisionOf,
        revisionId: revised.revisionId,
        status: revised.status,
        decisionsRan: false,
        decisionsPersisted: false,
      };
    } catch (error) {
      if (error instanceof AskIntakeError) return failureFromError(error);
      throw error;
    }
  }

  const policy = await getPolicyInForce(input.actor.churchId, database);
  if (!policy) {
    return failure(
      "no_policy",
      "The church's promises are not signed yet, so a person will take this down by hand. Please call the church office.",
      503,
    );
  }

  let created;
  try {
    created = await createAskWithRevision(
      input.actor,
      { text: validation.text, policyVersionId: policy.id },
      database,
    );
  } catch (error) {
    if (error instanceof AskIntakeError) return failureFromError(error);
    throw error;
  }

  const policyForRun: { id: string; questionSet: readonly PolicyQuestion[] } =
    {
      id: policy.id,
      questionSet: policy.questionSet,
    };

  try {
    const run = await decideForAsk({
      askId: created.askId,
      churchId: input.actor.churchId,
      askText: validation.text,
      policy: policyForRun,
      provider: input.provider,
      timeoutMs: input.timeoutMs,
      actorId: input.actor.personId,
      database,
      env: input.env,
    });

    return {
      ok: true,
      askId: created.askId,
      revisionId: created.revisionId,
      // The ask was created in waiting_coordinator. Persisted routing may move
      // it to a hold; a failed write leaves it where a person will find it.
      status: run.persisted ? run.routing.status : "waiting_coordinator",
      decisionsRan: true,
      decisionsPersisted: run.persisted,
    };
  } catch {
    // `decide()` is total, so this is a last line of defence: the ask is still
    // in the coordinator queue and the caregiver still gets a calm receipt.
    return {
      ok: true,
      askId: created.askId,
      revisionId: created.revisionId,
      status: "waiting_coordinator",
      decisionsRan: false,
      decisionsPersisted: false,
    };
  }
}

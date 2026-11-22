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
import { constructDraftSlots } from "./slot-construction";
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
 * rewrite the ask. It is new wording, so the nine typed questions are run
 * again against it; every decision row records the revision it answered, and
 * the trail reads only the latest one.
 */

export type SubmitAskFailureCode = AskWriteErrorCode | "no_policy";

export type SubmitAskSuccess = {
  ok: true;
  askId: string;
  revisionId: string;
  status: AskStatus;
  decisionsRan: boolean;
  decisionsPersisted: boolean;
  /** True when this submission wrote the ask's draft times for the first time. */
  draftsProposed?: boolean;
  draftCount?: number;
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

/**
 * Draft construction is plain code and never blocks the caregiver's receipt.
 * A failure here leaves the ask in the coordinator queue, where a person can
 * propose times by hand.
 */
async function proposeDrafts(
  askId: string,
  churchId: string,
  database: AppDatabase,
): Promise<{ draftsProposed: boolean; draftCount: number }> {
  try {
    const construction = await constructDraftSlots({
      askId,
      churchId,
      database,
    });
    return {
      draftsProposed: construction.created,
      draftCount: construction.proposals,
    };
  } catch {
    return { draftsProposed: false, draftCount: 0 };
  }
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

  if (revisionOf.length > 0 && !UUID_PATTERN.test(revisionOf)) {
    return failure("not_found", "That ask is not available.", 404);
  }

  const policy = await getPolicyInForce(input.actor.churchId, database);
  if (!policy) {
    return failure(
      "no_policy",
      "The church's promises are not signed yet, so a person will take this down by hand. Please call the church office.",
      503,
    );
  }

  const policyForRun: { id: string; questionSet: readonly PolicyQuestion[] } =
    {
      id: policy.id,
      questionSet: policy.questionSet,
    };

  if (revisionOf.length > 0) {
    let revised;
    try {
      revised = await appendAskRevision(
        input.actor,
        { askId: revisionOf, text: validation.text },
        database,
      );
    } catch (error) {
      if (error instanceof AskIntakeError) return failureFromError(error);
      throw error;
    }

    // A revision is new wording, so every typed answer must be produced again.
    // The old rows stay append-only; this run is booked against the new
    // revision and is the only trail the caregiver's page may show.
    let run;
    try {
      run = await decideForAsk({
        askId: revisionOf,
        revisionId: revised.revisionId,
        churchId: input.actor.churchId,
        askText: validation.text,
        policy: policyForRun,
        provider: input.provider,
        timeoutMs: input.timeoutMs,
        actorId: input.actor.personId,
        database,
        env: input.env,
      });
    } catch {
      return {
        ok: true,
        askId: revisionOf,
        revisionId: revised.revisionId,
        status: revised.status,
        decisionsRan: false,
        decisionsPersisted: false,
      };
    }

    // `decideForAsk` only moves an ask that is still in the queue. An approved,
    // closed, or held ask keeps its human-owned status while the new answers
    // are recorded for the coordinator to read.
    const canMove = revised.status === "draft" || revised.status === "waiting_coordinator";
    const nextStatus =
      canMove && run.persisted ? run.routing.status : revised.status;

    // New wording gets new answers; a draft set is built from the first set
    // only. Anything the coordinator has already edited is never regenerated.
    const drafts = run.persisted
      ? await proposeDrafts(revisionOf, input.actor.churchId, database)
      : { draftsProposed: false, draftCount: 0 };

    return {
      ok: true,
      askId: revisionOf,
      revisionId: revised.revisionId,
      status: nextStatus,
      decisionsRan: true,
      decisionsPersisted: run.persisted,
      ...drafts,
    };
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

  try {
    const run = await decideForAsk({
      askId: created.askId,
      revisionId: created.revisionId,
      churchId: input.actor.churchId,
      askText: validation.text,
      policy: policyForRun,
      provider: input.provider,
      timeoutMs: input.timeoutMs,
      actorId: input.actor.personId,
      database,
      env: input.env,
    });

    const drafts = run.persisted
      ? await proposeDrafts(created.askId, input.actor.churchId, database)
      : { draftsProposed: false, draftCount: 0 };

    return {
      ok: true,
      askId: created.askId,
      revisionId: created.revisionId,
      // The ask was created in waiting_coordinator. Persisted routing may move
      // it to a hold; a failed write leaves it where a person will find it.
      status: run.persisted ? run.routing.status : "waiting_coordinator",
      decisionsRan: true,
      decisionsPersisted: run.persisted,
      ...drafts,
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

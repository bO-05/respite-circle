import { and, asc, eq, sql } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import {
  ask,
  askRevision,
  askStatusEnum,
  auditEvent,
  careRecipient,
  person,
  policy,
} from "@/db/schema";
import {
  CAREGIVER_ROLES,
  DESK_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import {
  validateAskSubmission,
  type AskIntakeErrorCode,
} from "@/server/domain/ask-intake";
import { sha256Hex } from "@/server/services/decision-contract";
import type { AppDatabase } from "./coordinator";

/**
 * Ask intake reads and writes.
 *
 * Two independent copies of a caregiver's words exist by design:
 * - `ask.verbatim_text` is the original and a database trigger rejects every
 *   change to it (and every delete of the row);
 * - `ask_revision` holds the original as well as each later edit, append-only
 *   through `reject_mutation()`. An edit inserts a new revision that supersedes
 *   the previous one; the ask row is never rewritten.
 *
 * Every function takes the resolved session. Caregiver reads filter on
 * `caregiver_id = actor.personId`; desk reads require a desk role and filter on
 * `church_id`. An id from another family or church behaves like a missing row.
 */

export type AskStatus = (typeof askStatusEnum.enumValues)[number];

export type AskWriteErrorCode = AskIntakeErrorCode | "not_found" | "no_recipient";

export class AskIntakeError extends Error {
  readonly code: AskWriteErrorCode;

  constructor(code: AskWriteErrorCode, message: string) {
    super(message);
    this.name = "AskIntakeError";
    this.code = code;
  }
}

export type CreatedAsk = {
  askId: string;
  revisionId: string;
};

export type CaregiverAskView = {
  id: string;
  status: AskStatus;
  createdAt: Date;
  /** The most recent revision: what the caregiver can read back today. */
  text: string;
  /** The wording the decision trail must answer for. */
  latestRevisionId: string | null;
  latestRevisionDigest: string | null;
  revisionCount: number;
  careRecipientFirstName: string;
  coordinatorFirstName: string | null;
  /** The church's policy in force when the ask was first submitted. */
  policyVersion: number;
};

export type DeskAskWords = {
  id: string;
  status: AskStatus;
  createdAt: Date;
  /** The most recent revision: the words the coordinator must read. */
  text: string;
  revisionCount: number;
  caregiverFirstName: string;
  careRecipientFirstName: string;
};

/**
 * The one place a blank or oversized ask is refused at the data boundary, so
 * no future caller can bypass the form and write an empty row.
 */
function assertStorableText(text: unknown): string {
  const validation = validateAskSubmission({ text, consent: true });
  if (!validation.ok) {
    throw new AskIntakeError(validation.code, validation.message);
  }
  return validation.text;
}

async function findCareRecipientId(
  actor: Actor,
  database: AppDatabase,
): Promise<string> {
  const rows = await database
    .select({ id: careRecipient.id })
    .from(careRecipient)
    .where(
      and(
        eq(careRecipient.churchId, actor.churchId),
        eq(careRecipient.createdByCaregiverId, actor.personId),
      ),
    )
    .orderBy(asc(careRecipient.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new AskIntakeError(
      "no_recipient",
      "Your coordinator has not added the person you care for yet. Please call the church office and a person will help.",
    );
  }

  return row.id;
}

/**
 * The named human the receipt promises. Churches are small; the first active
 * coordinator is the person whose name a family already knows from the invite.
 */
export async function findCoordinatorFirstName(
  churchId: string,
  database: AppDatabase = appDb,
): Promise<string | null> {
  const rows = await database
    .select({ firstName: person.firstName })
    .from(person)
    .where(
      and(
        eq(person.churchId, churchId),
        eq(person.active, true),
        sql`${person.roles} @> ${JSON.stringify(["coordinator"])}::jsonb`,
      ),
    )
    .orderBy(asc(person.createdAt))
    .limit(1);

  return rows[0]?.firstName ?? null;
}

/**
 * Create the ask (already in the coordinator queue so a slow model can never
 * lose it) and its first revision in one transaction, then append the audit
 * event. The digest is stored; the words are not copied into the audit log.
 */
export async function createAskWithRevision(
  actor: Actor,
  input: { text: string; policyVersionId: string },
  database: AppDatabase = appDb,
): Promise<CreatedAsk> {
  requireRoleSession(actor, CAREGIVER_ROLES);
  const text = assertStorableText(input.text);
  const careRecipientId = await findCareRecipientId(actor, database);
  const digest = sha256Hex(text);

  return database.transaction(async (tx) => {
    const [askRow] = await tx
      .insert(ask)
      .values({
        churchId: actor.churchId,
        caregiverId: actor.personId,
        careRecipientId,
        verbatimText: text,
        status: "waiting_coordinator",
        policyVersionId: input.policyVersionId,
      })
      .returning({ id: ask.id });

    const [revision] = await tx
      .insert(askRevision)
      .values({
        askId: askRow.id,
        verbatimText: text,
        digest,
        supersedesId: null,
      })
      .returning({ id: askRevision.id });

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: "ask_submitted",
      entity: "ask",
      entityId: askRow.id,
      detail: {
        revisionId: revision.id,
        digest,
        policyVersionId: input.policyVersionId,
        characterCount: text.length,
      },
    });

    return { askId: askRow.id, revisionId: revision.id };
  });
}

export type AppendedRevision = {
  revisionId: string;
  supersedesId: string | null;
  status: AskStatus;
};

/**
 * A caregiver edit creates a new revision. The original `ask.verbatim_text` is
 * never part of the UPDATE list — the column trigger would reject it, and the
 * product promise is that her first words remain exactly as she wrote them.
 */
export async function appendAskRevision(
  actor: Actor,
  input: { askId: string; text: string },
  database: AppDatabase = appDb,
): Promise<AppendedRevision> {
  requireRoleSession(actor, CAREGIVER_ROLES);
  const text = assertStorableText(input.text);
  const digest = sha256Hex(text);

  return database.transaction(async (tx) => {
    const rows = await tx
      .select({ id: ask.id, status: ask.status })
      .from(ask)
      .where(
        and(
          eq(ask.id, input.askId),
          eq(ask.churchId, actor.churchId),
          eq(ask.caregiverId, actor.personId),
        ),
      )
      .limit(1);

    const owned = rows[0];
    if (!owned) {
      // Same answer for "no such ask" and "someone else's ask": the caregiver
      // learns nothing about another family's row.
      throw new AskIntakeError("not_found", "That ask is not available.");
    }

    const previous = await tx
      .select({ id: askRevision.id })
      .from(askRevision)
      .where(eq(askRevision.askId, owned.id))
      .orderBy(asc(askRevision.createdAt))
      .limit(1_000);

    const supersedesId = previous.at(-1)?.id ?? null;

    const [revision] = await tx
      .insert(askRevision)
      .values({
        askId: owned.id,
        verbatimText: text,
        digest,
        supersedesId,
      })
      .returning({ id: askRevision.id });

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: "ask_revised",
      entity: "ask",
      entityId: owned.id,
      detail: {
        revisionId: revision.id,
        supersedesId,
        digest,
        characterCount: text.length,
      },
    });

    return {
      revisionId: revision.id,
      supersedesId,
      status: owned.status,
    };
  });
}

async function readRevisions(
  askId: string,
  database: AppDatabase,
): Promise<Array<{ id: string; verbatimText: string; digest: string }>> {
  return database
    .select({
      id: askRevision.id,
      verbatimText: askRevision.verbatimText,
      digest: askRevision.digest,
    })
    .from(askRevision)
    .where(eq(askRevision.askId, askId))
    .orderBy(asc(askRevision.createdAt), asc(askRevision.id));
}

/** The caregiver's own receipt: only the caregiver whose session it is. */
export async function getCaregiverAsk(
  actor: Actor,
  askId: string,
  database: AppDatabase = appDb,
): Promise<CaregiverAskView | null> {
  requireRoleSession(actor, CAREGIVER_ROLES);

  const rows = await database
    .select({
      id: ask.id,
      status: ask.status,
      createdAt: ask.createdAt,
      originalText: ask.verbatimText,
      careRecipientFirstName: careRecipient.firstName,
      policyVersion: policy.version,
    })
    .from(ask)
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .innerJoin(policy, eq(policy.id, ask.policyVersionId))
    .where(
      and(
        eq(ask.id, askId),
        eq(ask.churchId, actor.churchId),
        eq(ask.caregiverId, actor.personId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const [revisions, coordinatorFirstName] = await Promise.all([
    readRevisions(row.id, database),
    findCoordinatorFirstName(actor.churchId, database),
  ]);

  const latest = revisions.at(-1);

  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    text: latest?.verbatimText ?? row.originalText,
    latestRevisionId: latest?.id ?? null,
    latestRevisionDigest: latest?.digest ?? null,
    revisionCount: revisions.length,
    careRecipientFirstName: row.careRecipientFirstName,
    coordinatorFirstName,
    policyVersion: row.policyVersion,
  };
}

/**
 * The coordinator's read of the same words: latest revision, church-scoped,
 * and never a write control. The desk feature builds on this projection; it
 * must not widen it to `select()`.
 */
export async function getCoordinatorAskWords(
  actor: Actor,
  askId: string,
  database: AppDatabase = appDb,
): Promise<DeskAskWords | null> {
  requireRoleSession(actor, DESK_ROLES);

  const rows = await database
    .select({
      id: ask.id,
      status: ask.status,
      createdAt: ask.createdAt,
      originalText: ask.verbatimText,
      caregiverFirstName: person.firstName,
      careRecipientFirstName: careRecipient.firstName,
    })
    .from(ask)
    .innerJoin(person, eq(person.id, ask.caregiverId))
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .where(and(eq(ask.id, askId), eq(ask.churchId, actor.churchId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const revisions = await readRevisions(row.id, database);
  const latest = revisions.at(-1);

  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    text: latest?.verbatimText ?? row.originalText,
    revisionCount: revisions.length,
    caregiverFirstName: row.caregiverFirstName,
    careRecipientFirstName: row.careRecipientFirstName,
  };
}

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as appDb } from "@/db/client";
import {
  ask,
  askRevision,
  askStatusEnum,
  auditEvent,
  careRecipient,
  church,
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
  /**
   * The low-risk switch on that same policy version. The receipt uses it to
   * qualify the sentence about what a person approves; it never changes what
   * any neighbour can read.
   */
  autoPublishLowRisk: boolean;
  /**
   * A send-back note, exactly as the coordinator wrote it. Present only after
   * a send-back; the page renders it character-for-character and never trims
   * or rewraps it.
   */
  sendBackNote: string | null;
  sentBackAt: Date | null;
  sentBackByFirstName: string | null;
  /**
   * The human close of a held ask: a coordinator's own words, kept exactly as
   * written. Present only when a person closed a safety or personal-care hold.
   */
  closeNote: string | null;
  closedAt: Date | null;
  closedByFirstName: string | null;
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
  /** The language router's finding, shown plainly on the detail page. */
  language: string;
  bilingualNeeded: boolean;
  /**
   * The safety conversion record, if a coordinator made one. The desk shows
   * who converted the hold, when, and their reason, so the decision is never
   * invisible after the status moves.
   */
  safetyOverrideAt: Date | null;
  safetyOverrideByName: string | null;
  safetyOverrideReason: string | null;
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

/**
 * One row on the caregiver's own list: enough to name the ask and reach it,
 * and nothing else. The receipt reader is the only path to the words.
 */
export type CaregiverAskLink = {
  id: string;
  createdAt: Date;
  careRecipientFirstName: string;
  /** The church's own time zone for the civil date beside the link. */
  timeZone: string;
};

/**
 * The caregiver's own asks, newest first — the list behind the receipt links
 * on `/care` and `/ask`.
 *
 * This is an explicit allow-list, not a projection that happens to omit the
 * words: no text, no status, no decision values, and no slot data. Ownership
 * is the query filter (`caregiver_id = actor.personId` and the church), so the
 * link's presence is never the enforcement. It returns every ask for one
 * family, newest first: a cap would make an older receipt unreachable by
 * clicking, which is the defect this list exists to close.
 */
export async function listCaregiverAsks(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<CaregiverAskLink[]> {
  requireRoleSession(actor, CAREGIVER_ROLES);

  return database
    .select({
      id: ask.id,
      createdAt: ask.createdAt,
      careRecipientFirstName: careRecipient.firstName,
      timeZone: church.timezone,
    })
    .from(ask)
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .innerJoin(church, eq(church.id, ask.churchId))
    .where(
      and(
        eq(ask.churchId, actor.churchId),
        eq(ask.caregiverId, actor.personId),
      ),
    )
    .orderBy(desc(ask.createdAt), desc(ask.id));
}

/** The caregiver's own receipt: only the caregiver whose session it is. */
export async function getCaregiverAsk(
  actor: Actor,
  askId: string,
  database: AppDatabase = appDb,
): Promise<CaregiverAskView | null> {
  requireRoleSession(actor, CAREGIVER_ROLES);

  const sentBackBy = alias(person, "ask_sent_back_by");
  const closedBy = alias(person, "ask_closed_by");

  const rows = await database
    .select({
      id: ask.id,
      status: ask.status,
      createdAt: ask.createdAt,
      originalText: ask.verbatimText,
      careRecipientFirstName: careRecipient.firstName,
      policyVersion: policy.version,
      autoPublishLowRisk: policy.autoPublishLowRisk,
      sendBackNote: ask.sendBackNote,
      sentBackAt: ask.sentBackAt,
      sentBackByFirstName: sentBackBy.firstName,
      closeNote: ask.closeNote,
      closedAt: ask.closedAt,
      closedByFirstName: closedBy.firstName,
    })
    .from(ask)
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .innerJoin(policy, eq(policy.id, ask.policyVersionId))
    .leftJoin(sentBackBy, eq(sentBackBy.id, ask.sentBackBy))
    .leftJoin(closedBy, eq(closedBy.id, ask.closedBy))
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
    autoPublishLowRisk: row.autoPublishLowRisk,
    sendBackNote: row.sendBackNote,
    sentBackAt: row.sentBackAt,
    sentBackByFirstName: row.sentBackByFirstName,
    closeNote: row.closeNote,
    closedAt: row.closedAt,
    closedByFirstName: row.closedByFirstName,
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

  const overrider = alias(person, "ask_safety_overrider");

  const rows = await database
    .select({
      id: ask.id,
      status: ask.status,
      createdAt: ask.createdAt,
      originalText: ask.verbatimText,
      caregiverFirstName: person.firstName,
      careRecipientFirstName: careRecipient.firstName,
      language: ask.language,
      bilingualNeeded: ask.bilingualNeeded,
      safetyOverrideAt: ask.safetyOverrideAt,
      safetyOverrideByName: overrider.firstName,
      safetyOverrideReason: ask.safetyOverrideReason,
    })
    .from(ask)
    .innerJoin(person, eq(person.id, ask.caregiverId))
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .leftJoin(overrider, eq(overrider.id, ask.safetyOverrideBy))
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
    language: row.language,
    bilingualNeeded: row.bilingualNeeded,
    safetyOverrideAt: row.safetyOverrideAt,
    safetyOverrideByName: row.safetyOverrideByName,
    safetyOverrideReason: row.safetyOverrideReason,
  };
}

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as appDb } from "@/db/client";
import {
  auditEvent,
  careRecipient,
  caregiver,
  church,
  invite,
  person,
} from "@/db/schema";
import {
  CAREGIVER_ROLES,
  DESK_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import { isUuid } from "@/server/domain/claim";
import {
  INVITE_FAMILY_NOT_READY_MESSAGE,
  INVITE_TEMPLATE_CODE,
  INVITE_UNKNOWN_PERSON_MESSAGE,
  inviteSentMessage,
  matchesInviteTemplate,
  readInviteBody,
  type InviteFamilyOption,
} from "@/server/domain/invites";
import type { AppDatabase } from "./coordinator";

/**
 * The invitation composer's one write path and its two reads.
 *
 * An invitation is addressed to one named caregiver in the coordinator's own
 * church. The insert selects its row through `person JOIN caregiver` with
 * `person.church_id = actor.churchId` in the predicate, so a hand-edited id
 * from another church matches no row and writes nothing. The body, its author,
 * and the instant it was written are the row; `seen_at` is set the first time
 * the caregiver's own page renders it.
 *
 * No notification row is ever written here. This table is the in-app
 * invitation, not the caregiver outbox, and there is no email, SMS, or
 * broadcast path in the app.
 */

export const INVITE_AUDIT_ACTIONS = {
  sent: "invite_sent",
} as const;

export type InvitableFamily = InviteFamilyOption & {
  careRecipientId: string;
  careRecipientRelation: string;
};

export type SentInvite = {
  id: string;
  caregiverId: string;
  caregiverFirstName: string;
  caregiverLastName: string;
  careRecipientFirstName: string;
  body: string;
  createdAt: Date;
  authorFirstName: string;
  authorLastName: string;
};

export type CreateInviteCode =
  | "invalid_body"
  | "not_in_church"
  | "family_not_ready";

export type CreateInviteOutcome =
  | { ok: true; invite: SentInvite; message: string }
  | { ok: false; code: CreateInviteCode; message: string };

export type RecentInvite = {
  id: string;
  caregiverId: string;
  caregiverFirstName: string;
  caregiverLastName: string;
  careRecipientFirstName: string;
  body: string;
  createdAt: Date;
  seenAt: Date | null;
  authorFirstName: string;
  authorLastName: string;
  timeZone: string;
};

export type CaregiverInvite = {
  id: string;
  body: string;
  createdAt: Date;
  seenAt: Date | null;
  careRecipientFirstName: string;
  authorFirstName: string;
  authorLastName: string;
  timeZone: string;
};

function firstPer<T>(rows: readonly T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const row of rows) {
    const id = key(row);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(row);
  }

  return unique;
}

/**
 * The families a coordinator may invite: active caregivers in this church, with
 * the first care recipient recorded for them. Another church's people are not
 * selected at all, so the form cannot offer them.
 */
export async function listInvitableFamilies(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<InvitableFamily[]> {
  requireRoleSession(actor, DESK_ROLES);

  const rows = await database
    .select({
      caregiverId: person.id,
      caregiverFirstName: person.firstName,
      caregiverLastName: person.lastName,
      careRecipientId: careRecipient.id,
      careRecipientFirstName: careRecipient.firstName,
      careRecipientRelation: careRecipient.relation,
    })
    .from(person)
    .innerJoin(caregiver, eq(caregiver.personId, person.id))
    .innerJoin(
      careRecipient,
      eq(careRecipient.createdByCaregiverId, person.id),
    )
    .where(
      and(
        eq(person.churchId, actor.churchId),
        eq(person.active, true),
        eq(careRecipient.churchId, actor.churchId),
        sql`${person.roles} @> ${JSON.stringify(["caregiver"])}::jsonb`,
      ),
    )
    .orderBy(
      asc(person.firstName),
      asc(person.lastName),
      asc(careRecipient.createdAt),
    );

  return firstPer(rows, (row) => row.caregiverId);
}

/**
 * Write one invitation. The body is validated before anything is read, then the
 * insert itself is a church-scoped `INSERT … SELECT`: if the caregiver is not an
 * active caregiver in this church, no row is produced and nothing is stored.
 */
export async function createInvite(
  actor: Actor,
  input: { caregiverId: string; body: string },
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<CreateInviteOutcome> {
  requireRoleSession(actor, DESK_ROLES);

  const parsed = readInviteBody(input.body);
  if (!parsed.ok) {
    return { ok: false, code: "invalid_body", message: parsed.message };
  }

  const caregiverId =
    typeof input.caregiverId === "string" ? input.caregiverId.trim() : "";
  if (!isUuid(caregiverId)) {
    return {
      ok: false,
      code: "not_in_church",
      message: INVITE_UNKNOWN_PERSON_MESSAGE,
    };
  }

  return database.transaction(async (tx): Promise<CreateInviteOutcome> => {
    const familyRows = await tx
      .select({
        caregiverId: person.id,
        firstName: person.firstName,
        lastName: person.lastName,
        roles: person.roles,
      })
      .from(person)
      .innerJoin(caregiver, eq(caregiver.personId, person.id))
      .where(
        and(
          eq(person.id, caregiverId),
          eq(person.churchId, actor.churchId),
          eq(person.active, true),
        ),
      )
      .limit(1);

    const family = familyRows[0];
    if (!family || !family.roles.includes("caregiver")) {
      return {
        ok: false,
        code: "not_in_church",
        message: INVITE_UNKNOWN_PERSON_MESSAGE,
      };
    }

    const recipientRows = await tx
      .select({
        id: careRecipient.id,
        firstName: careRecipient.firstName,
      })
      .from(careRecipient)
      .where(
        and(
          eq(careRecipient.createdByCaregiverId, family.caregiverId),
          eq(careRecipient.churchId, actor.churchId),
        ),
      )
      .orderBy(asc(careRecipient.createdAt), asc(careRecipient.id))
      .limit(1);

    const recipient = recipientRows[0];
    if (!recipient) {
      return {
        ok: false,
        code: "family_not_ready",
        message: INVITE_FAMILY_NOT_READY_MESSAGE,
      };
    }

    const authorRows = await tx
      .select({ firstName: person.firstName, lastName: person.lastName })
      .from(person)
      .where(
        and(
          eq(person.id, actor.personId),
          eq(person.churchId, actor.churchId),
          eq(person.active, true),
        ),
      )
      .limit(1);

    const author = authorRows[0];
    if (!author) {
      // A session that names another church must not write through this one.
      return {
        ok: false,
        code: "not_in_church",
        message: INVITE_UNKNOWN_PERSON_MESSAGE,
      };
    }

    // One statement both writes and proves the scope. `person.church_id` and
    // the caregiver role are in the predicate, so no application check can be
    // skipped and no foreign person can be named. The raw `sql` template is
    // parameterised; dates are bound as ISO strings, never as a JS Date.
    const inserted = await tx.execute<{ id: string; created_at: Date }>(sql`
      INSERT INTO invite (church_id, caregiver_id, body, created_by, created_at)
      SELECT p.church_id, p.id, ${parsed.body}, ${actor.personId}::uuid,
             ${now.toISOString()}::timestamptz
        FROM person p
        INNER JOIN caregiver c ON c.person_id = p.id
       WHERE p.id = ${family.caregiverId}::uuid
         AND p.church_id = ${actor.churchId}::uuid
         AND p.active = true
         AND p.roles @> ${JSON.stringify(["caregiver"])}::jsonb
      RETURNING id, created_at
    `);

    const row = inserted[0];
    if (!row) {
      return {
        ok: false,
        code: "not_in_church",
        message: INVITE_UNKNOWN_PERSON_MESSAGE,
      };
    }

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: INVITE_AUDIT_ACTIONS.sent,
      entity: "invite",
      entityId: row.id,
      detail: {
        caregiverId: family.caregiverId,
        careRecipientFirstName: recipient.firstName,
        templateCode: INVITE_TEMPLATE_CODE,
        templateMatched: matchesInviteTemplate(parsed.body, {
          recipientFirstName: recipient.firstName,
          coordinatorFirstName: author.firstName,
        }),
        bodyLength: parsed.body.length,
        at: now.toISOString(),
      },
      createdAt: now,
    });

    return {
      ok: true,
      invite: {
        id: row.id,
        caregiverId: family.caregiverId,
        caregiverFirstName: family.firstName,
        caregiverLastName: family.lastName,
        careRecipientFirstName: recipient.firstName,
        body: parsed.body,
        createdAt: row.created_at,
        authorFirstName: author.firstName,
        authorLastName: author.lastName,
      },
      message: inviteSentMessage(family.firstName),
    };
  });
}

/**
 * The desk's own history: what this church sent, who wrote it, and whether the
 * family has opened it. Filtered by `invite.church_id`; another church's rows
 * are never selected.
 */
export async function listRecentInvites(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<RecentInvite[]> {
  requireRoleSession(actor, DESK_ROLES);

  const caregiverPerson = alias(person, "invite_caregiver");
  const authorPerson = alias(person, "invite_author");

  const rows = await database
    .select({
      id: invite.id,
      caregiverId: invite.caregiverId,
      caregiverFirstName: caregiverPerson.firstName,
      caregiverLastName: caregiverPerson.lastName,
      careRecipientFirstName: careRecipient.firstName,
      body: invite.body,
      createdAt: invite.createdAt,
      seenAt: invite.seenAt,
      authorFirstName: authorPerson.firstName,
      authorLastName: authorPerson.lastName,
      timeZone: church.timezone,
    })
    .from(invite)
    .innerJoin(caregiverPerson, eq(caregiverPerson.id, invite.caregiverId))
    .innerJoin(authorPerson, eq(authorPerson.id, invite.createdBy))
    .innerJoin(
      careRecipient,
      eq(careRecipient.createdByCaregiverId, invite.caregiverId),
    )
    .innerJoin(church, eq(church.id, invite.churchId))
    .where(
      and(
        eq(invite.churchId, actor.churchId),
        eq(careRecipient.churchId, actor.churchId),
      ),
    )
    .orderBy(
      desc(invite.createdAt),
      desc(invite.id),
      asc(careRecipient.createdAt),
    )
    .limit(20);

  return firstPer(rows, (row) => row.id);
}

/**
 * The caregiver's own invitations. The ownership predicate is
 * `invite.caregiver_id = actor.personId`; another family's rows are never
 * selected. The author's name is the one a family already knows.
 */
export async function listCaregiverInvites(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<CaregiverInvite[]> {
  requireRoleSession(actor, CAREGIVER_ROLES);

  const authorPerson = alias(person, "invite_author");

  const rows = await database
    .select({
      id: invite.id,
      body: invite.body,
      createdAt: invite.createdAt,
      seenAt: invite.seenAt,
      careRecipientFirstName: careRecipient.firstName,
      authorFirstName: authorPerson.firstName,
      authorLastName: authorPerson.lastName,
      timeZone: church.timezone,
    })
    .from(invite)
    .innerJoin(authorPerson, eq(authorPerson.id, invite.createdBy))
    .innerJoin(
      careRecipient,
      eq(careRecipient.createdByCaregiverId, invite.caregiverId),
    )
    .innerJoin(church, eq(church.id, invite.churchId))
    .where(
      and(
        eq(invite.churchId, actor.churchId),
        eq(invite.caregiverId, actor.personId),
        eq(careRecipient.churchId, actor.churchId),
      ),
    )
    .orderBy(
      desc(invite.createdAt),
      desc(invite.id),
      asc(careRecipient.createdAt),
    );

  return firstPer(rows, (row) => row.id);
}

/**
 * Record the first time the caregiver's page rendered their invitation. Only
 * their own unseen rows are updated; a second render is a calm no-op.
 */
export async function markCaregiverInvitesSeen(
  actor: Actor,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<number> {
  requireRoleSession(actor, CAREGIVER_ROLES);

  const updated = await database
    .update(invite)
    .set({ seenAt: now })
    .where(
      and(
        eq(invite.churchId, actor.churchId),
        eq(invite.caregiverId, actor.personId),
        isNull(invite.seenAt),
      ),
    )
    .returning({ id: invite.id });

  return updated.length;
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { seedIds } from "../../src/db/seed-data";
import {
  auditEvent,
  careRecipient,
  caregiver,
  church,
  invite,
  notification,
  person,
} from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import {
  createInvite,
  listCaregiverInvites,
  listInvitableFamilies,
  listRecentInvites,
  markCaregiverInvitesSeen,
} from "../../src/server/repositories/invites";
import { INVITE_TEMPLATE_CODE } from "../../src/server/domain/invites";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-POLICY-007 at the database boundary.
 *
 * The coordinator's invitation is one row: the body a person wrote, the person
 * who wrote it, and the instant it was written. It is addressed to one named
 * caregiver in the same church, so an id from another church matches no row and
 * writes nothing. No notification row is created — an invitation is not an
 * email, a text, or a broadcast. The caregiver reads only their own invitation,
 * and the first read records the instant they saw it.
 */

const NOW = new Date("2026-11-22T16:00:00.000Z");
const SEEN_AT = new Date("2026-11-22T17:30:00.000Z");

const GRACE: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: seedIds.church,
};

const DANIEL: Actor = {
  personId: seedIds.people.daniel,
  role: "deputy",
  churchId: seedIds.church,
};

const MARTA: Actor = {
  personId: seedIds.people.marta,
  role: "caregiver",
  churchId: seedIds.church,
};

const PRIYA: Actor = {
  personId: seedIds.people.priya,
  role: "caregiver",
  churchId: seedIds.church,
};

const RUTH: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: seedIds.church,
};

const FOREIGN = {
  churchId: "c8888888-8888-4888-8888-888888888888",
  coordinatorId: "a8888888-8888-4888-8888-888888888881",
  caregiverId: "a8888888-8888-4888-8888-888888888882",
  recipientId: "f8888888-8888-4888-8888-888888888881",
} as const;

const FOREIGN_COORDINATOR: Actor = {
  personId: FOREIGN.coordinatorId,
  role: "coordinator",
  churchId: FOREIGN.churchId,
};

const NOT_IN_THIS_CHURCH_ACTOR: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: FOREIGN.churchId,
};

const MARTA_BODY =
  "We've set up Respite Morning for Elena — would a Tuesday morning help? — Grace";

const EDITED_BODY = `${MARTA_BODY}\n\nParking is by the side door, and I will meet you at 9:40.`;

async function insertForeignChurch(t: TestDatabase): Promise<void> {
  await t.db.insert(church).values({
    id: FOREIGN.churchId,
    name: "Another Community Church",
    timezone: "America/New_York",
    demoMode: false,
  });

  await t.db.insert(person).values([
    {
      id: FOREIGN.coordinatorId,
      churchId: FOREIGN.churchId,
      firstName: "Rosa",
      lastName: "Coordinator",
      roles: ["coordinator"],
      accessToken: "foreign-coordinator-1a2b",
    },
    {
      id: FOREIGN.caregiverId,
      churchId: FOREIGN.churchId,
      firstName: "Ana",
      lastName: "Other",
      roles: ["caregiver"],
      accessToken: "foreign-caregiver-3c4d",
    },
  ]);

  await t.db.insert(caregiver).values({ personId: FOREIGN.caregiverId });
  await t.db.insert(careRecipient).values({
    id: FOREIGN.recipientId,
    churchId: FOREIGN.churchId,
    firstName: "Rosa",
    relation: "mother",
    createdByCaregiverId: FOREIGN.caregiverId,
  });
}

async function inviteRows(t: TestDatabase) {
  return t.db
    .select()
    .from(invite)
    .orderBy(asc(invite.createdAt), asc(invite.id));
}

async function notificationCount(t: TestDatabase): Promise<number> {
  const rows = await t.db.select({ id: notification.id }).from(notification);
  return rows.length;
}

async function inviteAuditRows(t: TestDatabase, inviteId: string) {
  return t.db
    .select({
      action: auditEvent.action,
      actorType: auditEvent.actorType,
      actorId: auditEvent.actorId,
      detail: auditEvent.detail,
    })
    .from(auditEvent)
    .where(
      and(eq(auditEvent.entity, "invite"), eq(auditEvent.entityId, inviteId)),
    );
}

describe("the invitation composer", () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await openTestDatabase();
  });

  afterAll(async () => {
    await t.client.end();
  });

  beforeEach(async () => {
    await truncateAll(t.db);
    await seedDatabase(t.db);
  });

  it("lists only the caregivers in the coordinator's own church, with their family", async () => {
    await insertForeignChurch(t);

    const families = await listInvitableFamilies(GRACE, t.db);

    expect(
      families.map((family) => [
        family.caregiverFirstName,
        family.careRecipientFirstName,
      ]),
    ).toEqual([
      ["David", "June"],
      ["Marta", "Elena"],
      ["Priya", "Mr. Rao"],
    ]);
    expect(families.every((family) => family.careRecipientRelation.length > 0)).toBe(
      true,
    );

    const deputyView = await listInvitableFamilies(DANIEL, t.db);
    expect(deputyView).toHaveLength(3);
  });

  it("stores the body a person wrote with its author and timestamp", async () => {
    const notificationsBefore = await notificationCount(t);

    const outcome = await createInvite(
      GRACE,
      { caregiverId: seedIds.people.marta, body: `  ${EDITED_BODY}\n` },
      t.db,
      NOW,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.invite.caregiverId).toBe(seedIds.people.marta);
    expect(outcome.invite.caregiverFirstName).toBe("Marta");
    expect(outcome.invite.careRecipientFirstName).toBe("Elena");
    expect(outcome.invite.authorFirstName).toBe("Grace");
    expect(outcome.invite.body).toBe(EDITED_BODY);

    const rows = await inviteRows(t);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.id).toBe(outcome.invite.id);
    expect(row.churchId).toBe(seedIds.church);
    expect(row.caregiverId).toBe(seedIds.people.marta);
    expect(row.body).toBe(EDITED_BODY);
    expect(row.createdBy).toBe(seedIds.people.grace);
    expect(row.createdAt.toISOString()).toBe(NOW.toISOString());
    expect(row.seenAt).toBeNull();

    // The invitation is in-app only: no outbox row, no email, no SMS, no
    // broadcast. The notification table is the app's only message outbox.
    expect(await notificationCount(t)).toBe(notificationsBefore);
    expect(await notificationCount(t)).toBe(0);

    const audits = await inviteAuditRows(t, row.id);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("invite_sent");
    expect(audits[0].actorType).toBe("human");
    expect(audits[0].actorId).toBe(seedIds.people.grace);
    expect(audits[0].detail.templateCode).toBe(INVITE_TEMPLATE_CODE);
    expect(audits[0].detail.templateMatched).toBe(false);
    expect(audits[0].detail.caregiverId).toBe(seedIds.people.marta);
    expect(audits[0].detail.at).toBe(NOW.toISOString());
  });

  it("records that an unchanged body is the church's template", async () => {
    const outcome = await createInvite(
      GRACE,
      { caregiverId: seedIds.people.marta, body: MARTA_BODY },
      t.db,
      NOW,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const audits = await inviteAuditRows(t, outcome.invite.id);
    expect(audits[0].detail.templateMatched).toBe(true);
  });

  it("refuses a caregiver outside this church and writes nothing", async () => {
    await insertForeignChurch(t);

    const outcome = await createInvite(
      GRACE,
      { caregiverId: FOREIGN.caregiverId, body: EDITED_BODY },
      t.db,
      NOW,
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("not_in_church");
      expect(outcome.message).toMatch(/isn't part of this church|not part of this church/i);
    }

    expect(await inviteRows(t)).toHaveLength(0);

    // A forged coordinator session naming another church cannot invite that
    // church's caregiver either: the row is filtered before anything is read
    // back, and the insert never happens.
    const forged = await createInvite(
      NOT_IN_THIS_CHURCH_ACTOR,
      { caregiverId: seedIds.people.marta, body: EDITED_BODY },
      t.db,
      NOW,
    );
    expect(forged.ok).toBe(false);
    expect(await inviteRows(t)).toHaveLength(0);
  });

  it("refuses a caregiver id that does not resolve, without writing", async () => {
    const outcome = await createInvite(
      GRACE,
      { caregiverId: "not-a-uuid", body: EDITED_BODY },
      t.db,
      NOW,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_in_church");
    expect(await inviteRows(t)).toHaveLength(0);
  });

  it("refuses an empty message and writes nothing", async () => {
    const outcome = await createInvite(
      GRACE,
      { caregiverId: seedIds.people.marta, body: "   \n  " },
      t.db,
      NOW,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("invalid_body");
    expect(await inviteRows(t)).toHaveLength(0);
  });

  it("refuses a caregiver, a volunteer, and a pastor's session", async () => {
    for (const actor of [MARTA, RUTH]) {
      await expect(
        createInvite(
          actor,
          { caregiverId: seedIds.people.marta, body: EDITED_BODY },
          t.db,
          NOW,
        ),
      ).rejects.toBeInstanceOf(AuthError);
      await expect(listInvitableFamilies(actor, t.db)).rejects.toBeInstanceOf(
        AuthError,
      );
      await expect(listRecentInvites(actor, t.db)).rejects.toBeInstanceOf(
        AuthError,
      );
    }
    expect(await inviteRows(t)).toHaveLength(0);
  });

  it("shows the desk who wrote each invitation and whether it was opened", async () => {
    await createInvite(
      GRACE,
      { caregiverId: seedIds.people.marta, body: MARTA_BODY },
      t.db,
      NOW,
    );
    await markCaregiverInvitesSeen(MARTA, t.db, SEEN_AT);

    const recent = await listRecentInvites(GRACE, t.db);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      caregiverId: seedIds.people.marta,
      caregiverFirstName: "Marta",
      careRecipientFirstName: "Elena",
      authorFirstName: "Grace",
      authorLastName: "Whitfield",
      body: MARTA_BODY,
      seenAt: SEEN_AT,
    });
    expect(recent[0].createdAt.toISOString()).toBe(NOW.toISOString());

    // A coordinator in another church cannot read this invitation.
    await insertForeignChurch(t);
    expect(await listRecentInvites(FOREIGN_COORDINATOR, t.db)).toHaveLength(0);
  });

  it("gives a caregiver only their own invitation, and records the first look", async () => {
    const forMarta = await createInvite(
      GRACE,
      { caregiverId: seedIds.people.marta, body: MARTA_BODY },
      t.db,
      NOW,
    );
    expect(forMarta.ok).toBe(true);

    const forPriya = await createInvite(
      GRACE,
      { caregiverId: seedIds.people.priya, body: "Priya's invitation" },
      t.db,
      NOW,
    );
    expect(forPriya.ok).toBe(true);

    const martaView = await listCaregiverInvites(MARTA, t.db);
    expect(martaView).toHaveLength(1);
    expect(martaView[0]).toMatchObject({
      body: MARTA_BODY,
      authorFirstName: "Grace",
      authorLastName: "Whitfield",
      seenAt: null,
    });

    const priyaView = await listCaregiverInvites(PRIYA, t.db);
    expect(priyaView).toHaveLength(1);
    expect(priyaView[0].body).toBe("Priya's invitation");

    const marked = await markCaregiverInvitesSeen(MARTA, t.db, SEEN_AT);
    expect(marked).toBe(1);

    const seen = await t.db
      .select({ seenAt: invite.seenAt })
      .from(invite)
      .where(eq(invite.caregiverId, seedIds.people.marta));
    expect(seen[0].seenAt?.toISOString()).toBe(SEEN_AT.toISOString());

    const priyaRow = await t.db
      .select({ seenAt: invite.seenAt })
      .from(invite)
      .where(eq(invite.caregiverId, seedIds.people.priya));
    expect(priyaRow[0].seenAt).toBeNull();

    // A second render is a calm no-op, not a new timestamp.
    expect(await markCaregiverInvitesSeen(MARTA, t.db, NOW)).toBe(0);

    const after = await listCaregiverInvites(MARTA, t.db);
    expect(after[0].seenAt?.toISOString()).toBe(SEEN_AT.toISOString());
  });

  it("keeps each church's invitations inside that church", async () => {
    await insertForeignChurch(t);

    const foreignSent = await createInvite(
      FOREIGN_COORDINATOR,
      { caregiverId: FOREIGN.caregiverId, body: "From Rosa, for Rosa." },
      t.db,
      NOW,
    );
    expect(foreignSent.ok).toBe(true);

    const ownSent = await createInvite(
      GRACE,
      { caregiverId: seedIds.people.marta, body: MARTA_BODY },
      t.db,
      NOW,
    );
    expect(ownSent.ok).toBe(true);

    expect(await listRecentInvites(GRACE, t.db)).toHaveLength(1);
    expect(await listRecentInvites(FOREIGN_COORDINATOR, t.db)).toHaveLength(1);
    expect((await listCaregiverInvites(MARTA, t.db))[0].body).toBe(MARTA_BODY);
  });
});

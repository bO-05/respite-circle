import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { seedAccessTokens, seedIds } from "../../src/db/seed-data";
import {
  careRecipient,
  caregiver,
  church,
  person,
} from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import { listChurchAccessLinks } from "../../src/server/repositories/access-links";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-AUDITFIX-014 and VAL-R2PROM-007 at the database boundary.
 *
 * The invite screen lists one sign-in link for each family the desk may invite:
 * the active caregivers of the viewer's own church, read from the token column
 * the entry route already uses. Nothing is minted, rotated, or stored twice.
 *
 * The scope is the point of VAL-R2PROM-007. The desk's own link (the
 * coordinator's and the deputy's) is never listed, and neither is a person
 * outside the viewer's role: a volunteer belongs to the board and their own
 * claims, and the read-only pastor is not invited by anyone. Another church's
 * people are never selected at all, and a caregiver, volunteer, or pastor
 * session is refused before any row is read.
 */

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

const RUTH: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: seedIds.church,
};

const PASTOR: Actor = {
  personId: seedIds.people.grace,
  role: "pastor",
  churchId: seedIds.church,
};

const FOREIGN = {
  churchId: "c7777777-7777-4777-8777-777777777771",
  coordinatorId: "a7777777-7777-4777-8777-777777777771",
  caregiverId: "a7777777-7777-4777-8777-777777777772",
  recipientId: "f7777777-7777-4777-8777-777777777771",
  coordinatorToken: "outside-coordinator-7a1b",
  caregiverToken: "outside-caregiver-7c3d",
} as const;

const FOREIGN_COORDINATOR: Actor = {
  personId: FOREIGN.coordinatorId,
  role: "coordinator",
  churchId: FOREIGN.churchId,
};

async function insertForeignChurch(t: TestDatabase): Promise<void> {
  await t.db.insert(church).values({
    id: FOREIGN.churchId,
    name: "Outside Community Church",
    timezone: "America/New_York",
    demoMode: false,
  });

  await t.db.insert(person).values([
    {
      id: FOREIGN.coordinatorId,
      churchId: FOREIGN.churchId,
      firstName: "Rosa",
      lastName: "Outside",
      roles: ["coordinator"],
      accessToken: FOREIGN.coordinatorToken,
    },
    {
      id: FOREIGN.caregiverId,
      churchId: FOREIGN.churchId,
      firstName: "Ana",
      lastName: "Outside",
      roles: ["caregiver"],
      accessToken: FOREIGN.caregiverToken,
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

async function expectForbidden(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).status).toBe(403);
    return;
  }

  throw new Error("Expected the read to be refused for this role.");
}

describe("the invite screen's sign-in links", () => {
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

  it("lists only the families the desk may invite, each with the token they already hold", async () => {
    const links = await listChurchAccessLinks(GRACE, t.db);

    expect(links.map((link) => [link.firstName, link.role])).toEqual([
      ["David", "caregiver"],
      ["Marta", "caregiver"],
      ["Priya", "caregiver"],
    ]);

    expect(links.map((link) => link.accessToken)).toEqual([
      seedAccessTokens.david,
      seedAccessTokens.marta,
      seedAccessTokens.priya,
    ]);

    expect(new Set(links.map((link) => link.accessToken)).size).toBe(
      links.length,
    );
  });

  it("never lists the desk's own link or a role the desk does not invite", async () => {
    const links = await listChurchAccessLinks(GRACE, t.db);
    const tokens = links.map((link) => link.accessToken);
    const ids = links.map((link) => link.personId);

    for (const deskToken of [seedAccessTokens.grace, seedAccessTokens.daniel]) {
      expect(tokens).not.toContain(deskToken);
    }
    for (const otherRoleToken of [
      seedAccessTokens.ruth,
      seedAccessTokens.sara,
      seedAccessTokens.tom,
      seedAccessTokens.ben,
    ]) {
      expect(tokens).not.toContain(otherRoleToken);
    }
    for (const otherPersonId of [
      seedIds.people.grace,
      seedIds.people.daniel,
      seedIds.people.ruth,
      seedIds.people.sara,
      seedIds.people.tom,
      seedIds.people.ben,
    ]) {
      expect(ids).not.toContain(otherPersonId);
    }

    // The deputy runs the same desk and reads the same scope: the desk pair's
    // own links and the volunteers belong to nobody on this page.
    const deputyView = await listChurchAccessLinks(DANIEL, t.db);
    expect(deputyView.map((link) => link.accessToken)).toEqual(tokens);
  });

  it("leaves out a person with the caregiver role but no family record", async () => {
    await t.db.insert(person).values({
      id: "a0000000-0000-4000-8000-0000000000aa",
      churchId: seedIds.church,
      firstName: "Nora",
      lastName: "NoRecord",
      roles: ["caregiver"],
      accessToken: "no-family-record-0001",
    });

    const links = await listChurchAccessLinks(GRACE, t.db);

    expect(links.map((link) => link.personId)).not.toContain(
      "a0000000-0000-4000-8000-0000000000aa",
    );
    expect(links).toHaveLength(3);
  });

  it("gives the deputy the same scoped church list, not another church's", async () => {
    const coordinatorView = await listChurchAccessLinks(GRACE, t.db);
    const deputyView = await listChurchAccessLinks(DANIEL, t.db);

    expect(deputyView).toEqual(coordinatorView);
  });

  it("refuses a caregiver, a volunteer, and the read-only pastor", async () => {
    await expectForbidden(() => listChurchAccessLinks(MARTA, t.db));
    await expectForbidden(() => listChurchAccessLinks(RUTH, t.db));
    await expectForbidden(() => listChurchAccessLinks(PASTOR, t.db));
  });

  it("keeps each church's links inside that church", async () => {
    await insertForeignChurch(t);

    const graceView = await listChurchAccessLinks(GRACE, t.db);
    const outsideView = await listChurchAccessLinks(FOREIGN_COORDINATOR, t.db);

    expect(outsideView.map((link) => [link.firstName, link.role])).toEqual([
      ["Ana", "caregiver"],
    ]);
    expect(outsideView.map((link) => link.accessToken)).toEqual([
      FOREIGN.caregiverToken,
    ]);

    const outsideTokens = new Set(
      outsideView.map((link) => link.accessToken),
    );
    for (const link of graceView) {
      expect(outsideTokens.has(link.accessToken)).toBe(false);
    }
    expect(
      graceView.some((link) => link.personId === FOREIGN.caregiverId),
    ).toBe(false);
  });

  it("drops a family the church has marked inactive", async () => {
    await t.db
      .update(person)
      .set({ active: false })
      .where(eq(person.id, seedIds.people.marta));

    const links = await listChurchAccessLinks(GRACE, t.db);

    expect(links.some((link) => link.personId === seedIds.people.marta)).toBe(
      false,
    );
    expect(links).toHaveLength(2);
  });

  it("reads the same token the entry route signs in with", async () => {
    const links = await listChurchAccessLinks(GRACE, t.db);

    const martaRow = await t.db
      .select({ accessToken: person.accessToken })
      .from(person)
      .where(eq(person.id, seedIds.people.marta));

    expect(martaRow[0]?.accessToken).toBe(
      links.find((link) => link.personId === seedIds.people.marta)?.accessToken,
    );
  });
});

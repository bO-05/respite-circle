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
 * VAL-AUDITFIX-014 at the database boundary.
 *
 * A coordinator's invite screen lists the sign-in link each person in their own
 * church already holds. The rows are read from the same token column the entry
 * route uses; nothing is minted, rotated, or stored twice. Another church's
 * people are never selected, and a caregiver, a volunteer, or the read-only
 * pastor is refused before any row is read.
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

  it("lists every active person in the coordinator's church with the token they already hold", async () => {
    const links = await listChurchAccessLinks(GRACE, t.db);

    expect(links.map((link) => [link.firstName, link.role])).toEqual([
      ["Grace", "coordinator"],
      ["Daniel", "deputy"],
      ["David", "caregiver"],
      ["Marta", "caregiver"],
      ["Priya", "caregiver"],
      ["Ben", "volunteer"],
      ["Ruth", "volunteer"],
      ["Sara", "volunteer"],
      ["Tom", "volunteer"],
    ]);

    expect(links.map((link) => link.accessToken)).toEqual([
      seedAccessTokens.grace,
      seedAccessTokens.daniel,
      seedAccessTokens.david,
      seedAccessTokens.marta,
      seedAccessTokens.priya,
      seedAccessTokens.ben,
      seedAccessTokens.ruth,
      seedAccessTokens.sara,
      seedAccessTokens.tom,
    ]);

    expect(new Set(links.map((link) => link.accessToken)).size).toBe(
      links.length,
    );
  });

  it("gives the deputy the same church list, not another church's", async () => {
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

    expect(outsideView.map((link) => link.firstName)).toEqual(["Rosa", "Ana"]);
    expect(outsideView.map((link) => link.accessToken)).toEqual([
      FOREIGN.coordinatorToken,
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

  it("drops a person the church has marked inactive", async () => {
    await t.db
      .update(person)
      .set({ active: false })
      .where(eq(person.id, seedIds.people.marta));

    const links = await listChurchAccessLinks(GRACE, t.db);

    expect(links.some((link) => link.personId === seedIds.people.marta)).toBe(
      false,
    );
    expect(links).toHaveLength(8);
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

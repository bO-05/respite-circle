import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { seedIds } from "../../src/db/seed-data";
import * as schema from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import {
  getDeskAsk,
  getDeskSlot,
  listDeskAsks,
} from "../../src/server/repositories/coordinator";
import { listDemoLinks } from "../../src/server/repositories/demo";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

const OTHER_CHURCH = "c0000000-0000-4000-8000-000000000002";
const HIDDEN_CHURCH = "c0000000-0000-4000-8000-000000000003";
const OTHER_POLICY = "b0000000-0000-4000-8000-000000000002";
const OTHER_COORDINATOR = "a0000000-0000-4000-8000-000000000102";
const OTHER_CAREGIVER = "a0000000-0000-4000-8000-000000000103";
const HIDDEN_PERSON = "a0000000-0000-4000-8000-000000000104";
const OTHER_RECIPIENT = "f0000000-0000-4000-8000-000000000102";
const OWN_ASK = "90000000-0000-4000-8000-000000000001";
const OTHER_ASK = "90000000-0000-4000-8000-000000000002";
const OWN_SLOT = "80000000-0000-4000-8000-000000000001";
const OTHER_SLOT = "80000000-0000-4000-8000-000000000002";

const grace: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: seedIds.church,
};

const otherCoordinator: Actor = {
  personId: OTHER_COORDINATOR,
  role: "coordinator",
  churchId: OTHER_CHURCH,
};

function otherChurchFixtures() {
  return {
    churches: [
      {
        id: OTHER_CHURCH,
        name: "Second Fictional Church",
        timezone: "America/New_York",
        demoMode: true,
      },
      {
        id: HIDDEN_CHURCH,
        name: "Not A Demo Church",
        timezone: "America/New_York",
        demoMode: false,
      },
    ],
    people: [
      {
        id: OTHER_COORDINATOR,
        churchId: OTHER_CHURCH,
        firstName: "Noah",
        lastName: "Demo",
        roles: ["coordinator"],
        accessToken: "other-church-coordinator-token",
      },
      {
        id: OTHER_CAREGIVER,
        churchId: OTHER_CHURCH,
        firstName: "Nora",
        lastName: "Demo",
        roles: ["caregiver"],
        accessToken: "other-church-caregiver-token",
      },
      {
        id: HIDDEN_PERSON,
        churchId: HIDDEN_CHURCH,
        firstName: "Hidden",
        lastName: "Person",
        roles: ["coordinator"],
        accessToken: "hidden-church-coordinator-token",
      },
    ],
    recipient: {
      id: OTHER_RECIPIENT,
      churchId: OTHER_CHURCH,
      firstName: "Ada",
      relation: "sister",
      createdByCaregiverId: OTHER_CAREGIVER,
    },
    policy: {
      id: OTHER_POLICY,
      churchId: OTHER_CHURCH,
      version: 1,
      crisisScript: "A person will call today.",
      signedOffBy: "Noah Demo",
      signedOffAt: new Date("2026-11-15T15:00:00.000Z"),
    },
  };
}

describe("coordinator church scope", () => {
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

    const fixtures = otherChurchFixtures();

    await t.db.insert(schema.church).values(fixtures.churches);
    await t.db.insert(schema.person).values(fixtures.people);
    await t.db.insert(schema.caregiver).values([
      { personId: OTHER_CAREGIVER, phoneNote: "Fictional contact note." },
    ]);
    await t.db.insert(schema.careRecipient).values(fixtures.recipient);
    await t.db.insert(schema.policy).values(fixtures.policy);

    await t.db.insert(schema.ask).values([
      {
        id: OWN_ASK,
        churchId: seedIds.church,
        caregiverId: seedIds.people.marta,
        careRecipientId: seedIds.careRecipients.elena,
        verbatimText: "I am tired and need a Tuesday morning.",
        status: "waiting_coordinator",
        policyVersionId: seedIds.policyV1,
      },
      {
        id: OTHER_ASK,
        churchId: OTHER_CHURCH,
        caregiverId: OTHER_CAREGIVER,
        careRecipientId: OTHER_RECIPIENT,
        verbatimText: "Another church's private words.",
        status: "waiting_coordinator",
        policyVersionId: OTHER_POLICY,
      },
    ]);

    await t.db.insert(schema.slot).values([
      {
        id: OWN_SLOT,
        askId: OWN_ASK,
        churchId: seedIds.church,
        kind: "companion",
        tier: "public_event",
        label: "Tuesday companion place",
        status: "draft",
        orientationNote: "Grace's own orientation note.",
      },
      {
        id: OTHER_SLOT,
        askId: OTHER_ASK,
        churchId: OTHER_CHURCH,
        kind: "companion",
        tier: "public_event",
        label: "Other church Tuesday place",
        status: "draft",
        orientationNote: "Another church's orientation note.",
      },
    ]);
  });

  it("lists only the desk asks of the coordinator's own church", async () => {
    const own = await listDeskAsks(grace, t.db);
    const theirs = await listDeskAsks(otherCoordinator, t.db);

    expect(own).toHaveLength(1);
    expect(own[0].id).toBe(OWN_ASK);
    expect(own[0].caregiverFirstName).toBe("Marta");
    expect(theirs).toHaveLength(1);
    expect(theirs[0].id).toBe(OTHER_ASK);
    expect(theirs[0].caregiverFirstName).toBe("Nora");
  });

  it("returns nothing for another church's ask by direct id", async () => {
    expect(await getDeskAsk(grace, OTHER_ASK, t.db)).toBeNull();
    expect(await getDeskAsk(otherCoordinator, OWN_ASK, t.db)).toBeNull();

    const own = await getDeskAsk(grace, OWN_ASK, t.db);
    expect(own?.id).toBe(OWN_ASK);
    expect(own?.caregiverFirstName).toBe("Marta");
  });

  it("returns nothing for another church's slot by direct id", async () => {
    expect(await getDeskSlot(grace, OTHER_SLOT, t.db)).toBeNull();
    expect(await getDeskSlot(otherCoordinator, OWN_SLOT, t.db)).toBeNull();

    const own = await getDeskSlot(grace, OWN_SLOT, t.db);
    expect(own?.id).toBe(OWN_SLOT);
    expect(own?.label).toBe("Tuesday companion place");
  });

  it("does not project the caregiver's words or an orientation note", async () => {
    const ask = await getDeskAsk(grace, OWN_ASK, t.db);
    const slot = await getDeskSlot(grace, OWN_SLOT, t.db);

    expect(ask).not.toBeNull();
    expect(slot).not.toBeNull();
    expect(Object.keys(ask ?? {})).not.toContain("verbatimText");
    expect(Object.keys(slot ?? {})).not.toContain("orientationNote");
    expect(JSON.stringify({ ask, slot })).not.toContain("I am tired");
    expect(JSON.stringify({ ask, slot })).not.toContain("orientation note");
  });

  it("refuses a caregiver before any query runs", async () => {
    const marta: Actor = {
      personId: seedIds.people.marta,
      role: "caregiver",
      churchId: seedIds.church,
    };

    await expect(listDeskAsks(marta, t.db)).rejects.toBeInstanceOf(AuthError);
    await expect(getDeskAsk(marta, OWN_ASK, t.db)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(getDeskSlot(marta, OWN_SLOT, t.db)).rejects.toBeInstanceOf(
      AuthError,
    );
  });
});

describe("demo link listing", () => {
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

    const fixtures = otherChurchFixtures();
    await t.db.insert(schema.church).values(fixtures.churches);
    await t.db.insert(schema.person).values(fixtures.people);
  });

  it("lists active people from demo churches only", async () => {
    const links = await listDemoLinks(t.db);
    const names = links.map((link) => link.firstName);

    expect(names).toContain("Marta");
    expect(names).toContain("Grace");
    expect(names).toContain("Ruth");
    expect(names).toContain("Noah");
    expect(names).not.toContain("Hidden");
    expect(links.every((link) => link.accessToken.length > 0)).toBe(true);
    expect(links.every((link) => link.role !== null)).toBe(true);
  });
});

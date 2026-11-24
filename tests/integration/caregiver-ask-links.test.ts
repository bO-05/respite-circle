import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_IDS, DEMO_TEXT, seedDemoState } from "../../src/db/demo-state";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { seedIds } from "../../src/db/seed-data";
import { listCaregiverAsks } from "../../src/server/repositories/asks";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-AUDITFIX-013 — the list behind the caregiver's receipt links.
 *
 * `/care` and `/ask` must reach the nine-answer receipt by clicking, and the
 * list that powers those links is deliberately narrower than the receipt
 * reader: the caregiver's own asks, newest first, with no words, no status and
 * no decision values. Ownership is the filter, never the link's presence.
 */

const MARTA = {
  personId: seedIds.people.marta,
  role: "caregiver" as const,
  churchId: seedIds.church,
};
const DAVID = {
  personId: seedIds.people.david,
  role: "caregiver" as const,
  churchId: seedIds.church,
};
const PRIYA = {
  personId: seedIds.people.priya,
  role: "caregiver" as const,
  churchId: seedIds.church,
};
const GRACE = {
  personId: seedIds.people.grace,
  role: "coordinator" as const,
  churchId: seedIds.church,
};
const OUTSIDE_CHURCH = {
  personId: "c9999999-9999-4999-8999-999999999901",
  role: "caregiver" as const,
  churchId: "c9999999-9999-4999-8999-999999999999",
};

describe("the caregiver's ask links", () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await openTestDatabase();
    await truncateAll(t.db);
    await seedDatabase(t.db);
    // The plain seed writes the cast and no asks. The demo-ready asks are what
    // a judge meets on `/care`, so the list is tested against that same state.
    await seedDemoState(t.db, { now: new Date() });
  });

  afterAll(async () => {
    await t.client.end();
  });

  it("lists only the caregiver's own asks, newest first, with an allow-list projection", async () => {
    const marta = await listCaregiverAsks(MARTA, t.db);

    expect(marta).toHaveLength(1);
    expect(marta[0]!.id).toBe(DEMO_IDS.askHero);
    expect(Object.keys(marta[0]!).sort()).toEqual([
      "careRecipientFirstName",
      "createdAt",
      "id",
      "timeZone",
    ]);
    expect(marta[0]!.careRecipientFirstName).toBe("Elena");
    expect(marta[0]!.timeZone).toBe("America/New_York");

    // David has two seeded asks; the newer one comes first.
    const david = await listCaregiverAsks(DAVID, t.db);
    expect(david.map((row) => row.id)).toEqual([
      DEMO_IDS.askFailure,
      DEMO_IDS.askWaiting,
    ]);

    // The link row is not the receipt: no words, no status, no decision data.
    const payload = JSON.stringify([...marta, ...david]);
    expect(payload).not.toContain(DEMO_TEXT.hero.slice(0, 40));
    expect(payload).not.toContain(DEMO_TEXT.waiting.slice(0, 40));
    expect(payload).not.toContain("waiting_coordinator");
    expect(payload).not.toContain(DEMO_TEXT.failure.slice(0, 40));
  });

  it("never lists another caregiver's ask, and a caregiver from another church sees nothing", async () => {
    const marta = await listCaregiverAsks(MARTA, t.db);
    const martaIds = marta.map((row) => row.id);
    expect(martaIds).not.toContain(DEMO_IDS.askWaiting);
    expect(martaIds).not.toContain(DEMO_IDS.askSafetyHold);

    const priya = await listCaregiverAsks(PRIYA, t.db);
    expect(priya.map((row) => row.id)).toEqual([DEMO_IDS.askSafetyHold]);

    const david = await listCaregiverAsks(DAVID, t.db);
    expect(david.map((row) => row.id)).not.toContain(DEMO_IDS.askHero);

    expect(await listCaregiverAsks(OUTSIDE_CHURCH, t.db)).toEqual([]);
  });

  it("refuses a role that is not a caregiver", async () => {
    await expect(listCaregiverAsks(GRACE, t.db)).rejects.toMatchObject({
      failure: "forbidden",
    });
  });
});

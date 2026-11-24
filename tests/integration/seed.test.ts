import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { truncateAll } from "../../src/db/reset";
import {
  formatSeedCounts,
  readSeedCounts,
  seedDatabase,
} from "../../src/db/seed";
import {
  buildSeedSessions,
  expectedSeedCounts,
  SEED_REFERENCE_DATE,
  seedChurch,
  seedCrisisScript,
  seedIds,
  seedLocalCrisisLine,
  seedPeople,
  seedQuestionSet,
  seedReferralResources,
  seedSafeguardingPromises,
} from "../../src/db/seed-data";
import type { Actor } from "../../src/server/auth/policy";
import { createPolicyVersion } from "../../src/server/repositories/policy";
import { verifySeed } from "../../scripts/verify-seed";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

describe("deterministic seed", () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await openTestDatabase();
  });

  afterAll(async () => {
    await t.client.end();
  });

  beforeEach(async () => {
    await truncateAll(t.db);
  });

  it("seeds the full fictional cast, one policy version, and four sessions", async () => {
    const counts = await seedDatabase(t.db, { now: SEED_REFERENCE_DATE });

    expect(counts).toMatchObject(expectedSeedCounts);
    expect(counts.ask).toBe(0);
    expect(counts.slot).toBe(0);
    expect(counts.notification).toBe(0);

    const [church] = await t.client<{ name: string }[]>`
      SELECT name FROM church WHERE id = ${seedChurch.id}
    `;
    expect(church.name).toBe("Grace Community Church");

    const people = await t.client<{ first_name: string; last_name: string }[]>`
      SELECT first_name, last_name FROM person
    `;
    for (const expected of seedPeople) {
      expect(
        people.some(
          (row) =>
            row.first_name === expected.firstName &&
            row.last_name === expected.lastName,
        ),
        `${expected.firstName} ${expected.lastName} must be seeded`,
      ).toBe(true);
    }

    const versions = await t.client<{ version: number }[]>`
      SELECT version FROM policy ORDER BY version
    `;
    expect(versions.map((row) => row.version)).toEqual([1]);

    const sessions = await t.client`
      SELECT id FROM session ORDER BY starts_at
    `;
    expect(sessions).toHaveLength(4);
  });

  it("is idempotent: a second run leaves every count and every date unchanged", async () => {
    const now = SEED_REFERENCE_DATE;
    const first = await seedDatabase(t.db, { now });
    const dates = async () =>
      (
        await t.client<{ id: string; starts_at: Date }[]>`
          SELECT id, starts_at FROM session ORDER BY id
        `
      ).map((row) => [row.id, new Date(row.starts_at).toISOString()] as const);

    const before = await dates();
    const second = await seedDatabase(t.db, { now });

    expect(second).toEqual(first);
    expect(formatSeedCounts(second)).toBe(formatSeedCounts(first));
    expect(await readSeedCounts(t.db)).toEqual(first);
    expect(await dates()).toEqual(before);
  });

  it("puts four future Tuesday sessions at 10:00–14:00 church time, named by the clock", async () => {
    const now = SEED_REFERENCE_DATE;
    await seedDatabase(t.db, { now });

    const sessions = await t.client<
      {
        id: string;
        starts_at: Date;
        iso_dow: number;
        local_start: string;
        local_end: string;
      }[]
    >`
      SELECT id,
             starts_at,
             EXTRACT(ISODOW FROM starts_at AT TIME ZONE 'America/New_York')::int AS iso_dow,
             to_char(starts_at AT TIME ZONE 'America/New_York', 'HH24:MI') AS local_start,
             to_char(ends_at AT TIME ZONE 'America/New_York', 'HH24:MI') AS local_end
        FROM session
       ORDER BY starts_at
    `;

    const expected = buildSeedSessions(now);
    expect(sessions).toHaveLength(4);
    expect(sessions.map((row) => row.id)).toEqual(expected.map((s) => s.id));

    for (const [index, row] of sessions.entries()) {
      expect(row.iso_dow, `${row.id} must fall on a Tuesday`).toBe(2);
      expect(row.local_start).toBe("10:00");
      expect(row.local_end).toBe("14:00");
      expect(new Date(row.starts_at).getTime()).toBe(
        expected[index]!.startsAt.getTime(),
      );
      expect(new Date(row.starts_at).getTime()).toBeGreaterThan(now.getTime());
    }

    expect(new Date(sessions[3]!.starts_at).getTime()).toBeGreaterThan(
      new Date(sessions[2]!.starts_at).getTime(),
    );
  });

  it("rolls the four sessions onto the next four Tuesdays from a later clock", async () => {
    // Tuesday 5 January 2027, 09:00 in New York. The first Tuesday after it is
    // that same morning, so the four seeded ids land on 5, 12, 19, and 26 Jan.
    const later = new Date("2027-01-05T14:00:00.000Z");
    await seedDatabase(t.db, { now: later });

    const sessions = await t.client<{ id: string; starts_at: Date }[]>`
      SELECT id, starts_at FROM session ORDER BY starts_at
    `;

    const expected = buildSeedSessions(later);
    expect(expected.map((s) => s.startsAt.toISOString())).toEqual([
      "2027-01-05T15:00:00.000Z",
      "2027-01-12T15:00:00.000Z",
      "2027-01-19T15:00:00.000Z",
      "2027-01-26T15:00:00.000Z",
    ]);
    expect(sessions.map((row) => row.id)).toEqual(expected.map((s) => s.id));
    expect(sessions.map((row) => new Date(row.starts_at).toISOString())).toEqual(
      expected.map((s) => s.startsAt.toISOString()),
    );
  });

  it("honours RC_FAKE_NOW when no clock is passed", async () => {
    const previous = process.env.RC_FAKE_NOW;
    process.env.RC_FAKE_NOW = "2027-01-05T14:00:00.000Z";
    try {
      await seedDatabase(t.db);
    } finally {
      if (previous === undefined) delete process.env.RC_FAKE_NOW;
      else process.env.RC_FAKE_NOW = previous;
    }

    const [first] = await t.client<{ starts_at: Date }[]>`
      SELECT starts_at FROM session ORDER BY starts_at LIMIT 1
    `;
    expect(new Date(first!.starts_at).toISOString()).toBe(
      "2027-01-05T15:00:00.000Z",
    );
  });

  it("tolerates a later policy version while still requiring version 1's exact content", async () => {
    await seedDatabase(t.db);

    const grace: Actor = {
      personId: seedIds.people.grace,
      role: "coordinator",
      churchId: seedIds.church,
    };

    const second = await createPolicyVersion(
      grace,
      {
        safeguardingPromises: [
          ...seedSafeguardingPromises,
          "A promise added after the first signing.",
        ],
        questionSet: seedQuestionSet.map((question) => ({ ...question })),
        crisisScript: seedCrisisScript,
        localCrisisLine: seedLocalCrisisLine,
        referralResources: seedReferralResources.map((resource) => ({
          ...resource,
        })),
        reminderWindowHours: 24,
        callThresholdHours: 48,
        callAfterOpenHours: 24,
        signedOffBy: "Grace Whitfield",
      },
      t.db,
    );

    expect(second.version).toBe(2);

    const [count] = await t.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM policy
    `;
    expect(count.count).toBe(2);

    const verified = await verifySeed(t.db);
    expect(verified.failures).toEqual([]);
    expect(verified.ok).toBe(true);
    expect(verified.counts.policy).toBe(2);
  });

  it("fails verification with a clear message when rows are missing", async () => {
    const empty = await verifySeed(t.db);

    expect(empty.ok).toBe(false);
    expect(empty.failures.join("\n")).toMatch(/missing church: Grace Community Church/);
    expect(empty.failures.join("\n")).toMatch(/person: expected 9/);
    expect(empty.failures.join("\n")).toMatch(/session: expected 4/);

    await seedDatabase(t.db);

    const seeded = await verifySeed(t.db);
    expect(seeded.failures).toEqual([]);
    expect(seeded.ok).toBe(true);
  });
});

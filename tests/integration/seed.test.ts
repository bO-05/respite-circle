import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { truncateAll } from "../../src/db/reset";
import {
  formatSeedCounts,
  readSeedCounts,
  seedDatabase,
} from "../../src/db/seed";
import {
  expectedSeedCounts,
  SEED_REFERENCE_DATE,
  seedChurch,
  seedPeople,
  seedSessions,
} from "../../src/db/seed-data";
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
    const counts = await seedDatabase(t.db);

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

  it("is idempotent: a second run leaves every count unchanged", async () => {
    const first = await seedDatabase(t.db);
    const second = await seedDatabase(t.db);

    expect(second).toEqual(first);
    expect(formatSeedCounts(second)).toBe(formatSeedCounts(first));
    expect(await readSeedCounts(t.db)).toEqual(first);
  });

  it("puts four future Tuesday sessions at 10:00–14:00 church time", async () => {
    await seedDatabase(t.db);

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

    expect(sessions).toHaveLength(4);
    expect(sessions.map((row) => row.id)).toEqual([...seedSessions.map((s) => s.id)]);

    for (const row of sessions) {
      expect(row.iso_dow, `${row.id} must fall on a Tuesday`).toBe(2);
      expect(row.local_start).toBe("10:00");
      expect(row.local_end).toBe("14:00");
    }

    const reference = SEED_REFERENCE_DATE.getTime();
    expect(new Date(sessions[0].starts_at).getTime()).toBeGreaterThan(reference);
    expect(new Date(sessions[3].starts_at).getTime()).toBeGreaterThan(
      new Date(sessions[2].starts_at).getTime(),
    );
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

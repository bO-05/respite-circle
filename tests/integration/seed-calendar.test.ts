import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { seedIds } from "../../src/db/seed-data";
import { slot } from "../../src/db/schema";
import { resolveNow } from "../../src/lib/clock";
import type { Actor } from "../../src/server/auth/policy";
import { readCalendarGuard } from "../../src/server/repositories/sessions";
import { submitAsk } from "../../src/server/services/ask-intake";
import { createDeterministicProvider } from "../../src/server/services/providers";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * The seeded calendar follows the clock the construction guard reads.
 *
 * This is the regression suite for the pinned-fixture bug: the seed used to
 * place its four Respite Mornings on fixed November 2026 dates, so from
 * 2026-11-25 the guard's fourth Tuesday (22 December) had no row and every
 * companion proposal was skipped with `calendar_incomplete`. These cases seed
 * at the wall clock and at a simulated later clock, then read the guard and the
 * real intake path — no explicit `now` is passed, so the default clock is the
 * one under test.
 */

const MARTA: Actor = {
  personId: seedIds.people.marta,
  role: "caregiver",
  churchId: seedIds.church,
};

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

/** Run `work` with `RC_FAKE_NOW` set, restoring the previous value afterwards. */
async function withFakeNow<T>(instant: string, work: () => Promise<T>): Promise<T> {
  const previous = process.env.RC_FAKE_NOW;
  process.env.RC_FAKE_NOW = instant;
  try {
    return await work();
  } finally {
    if (previous === undefined) delete process.env.RC_FAKE_NOW;
    else process.env.RC_FAKE_NOW = previous;
  }
}

describe("the seeded calendar rolls with the clock", () => {
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

  it("plans the next four Tuesdays from the wall clock, so the guard is complete today", async () => {
    await seedDatabase(t.db);

    const guard = await readCalendarGuard(seedIds.church, t.db);
    expect(guard.incomplete).toBe(false);
    expect(guard.message).toBe("");

    const rows = await t.client<{ starts_at: Date; iso_dow: number }[]>`
      SELECT starts_at,
             EXTRACT(ISODOW FROM starts_at AT TIME ZONE 'America/New_York')::int AS iso_dow
        FROM session
       ORDER BY starts_at
    `;
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.iso_dow === 2)).toBe(true);

    const now = resolveNow().getTime();
    expect(rows.every((row) => new Date(row.starts_at).getTime() > now)).toBe(
      true,
    );
  });

  it("still yields four sessions and both draft proposals at a simulated later clock", async () => {
    // Tuesday 5 January 2027, 09:00 in New York.
    await withFakeNow("2027-01-05T14:00:00.000Z", async () => {
      await seedDatabase(t.db);

      const sessions = await t.client<{ starts_at: Date }[]>`
        SELECT starts_at FROM session ORDER BY starts_at
      `;
      expect(sessions.map((row) => new Date(row.starts_at).toISOString())).toEqual(
        [
          "2027-01-05T15:00:00.000Z",
          "2027-01-12T15:00:00.000Z",
          "2027-01-19T15:00:00.000Z",
          "2027-01-26T15:00:00.000Z",
        ],
      );

      const guard = await readCalendarGuard(seedIds.church, t.db);
      expect(guard.incomplete).toBe(false);

      // The real caregiver entry point: intake, then plain-code construction
      // with no explicit clock. Both must see the simulated date.
      const created = await submitAsk({
        actor: MARTA,
        text: HERO_ASK,
        consent: true,
        database: t.db,
        provider: createDeterministicProvider(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.draftsProposed).toBe(true);
      expect(created.draftCount).toBe(2);

      const drafts = await t.db
        .select({
          kind: slot.kind,
          status: slot.status,
          sessionId: slot.sessionId,
        })
        .from(slot)
        .where(eq(slot.askId, created.askId));

      expect(drafts).toHaveLength(2);
      expect(drafts.every((row) => row.status === "draft")).toBe(true);
      expect(drafts.map((row) => row.kind).sort()).toEqual([
        "companion",
        "home",
      ]);
      expect(drafts.find((row) => row.kind === "companion")?.sessionId).toBe(
        seedIds.sessions[0],
      );
    });
  });

  it("keeps the seeded ids when the clock rolls the four dates", async () => {
    await withFakeNow("2027-01-05T14:00:00.000Z", async () => {
      await seedDatabase(t.db);
    });

    const ids = await t.client<{ id: string }[]>`
      SELECT id FROM session ORDER BY starts_at
    `;
    expect(ids.map((row) => row.id)).toEqual([...seedIds.sessions]);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema";
import { auditEvent, slot } from "../../src/db/schema";
import { DEMO_IDS, seedDemoState } from "../../src/db/demo-state";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase, type SeedDb } from "../../src/db/seed";
import { SEED_REFERENCE_DATE, seedIds } from "../../src/db/seed-data";
import type { Actor } from "../../src/server/auth/policy";
import { claimSlot } from "../../src/server/repositories/claims";
import { approveClaim } from "../../src/server/repositories/claim-review";
import { cancelSessionForCoordinator } from "../../src/server/repositories/sessions";
import { runDemoReset } from "../../src/server/services/demo-reset";
import {
  expectRejection,
  openTestDatabase,
  type TestDatabase,
} from "./helpers/db";

/**
 * VAL-AUDITFIX-004 — the claim is write-once in the database.
 *
 * The claim is one conditional UPDATE in the repository, but the desk's revoke
 * path is a second writer that clears the claim, and nothing below the
 * repository protected the row. Migration 0014 adds a status/claim coherence
 * CHECK and a BEFORE UPDATE trigger: the two refusals are proved here with
 * direct SQL, so they hold even for a statement that never goes through
 * `claimSlot`. The deliberate exemptions are proved too — a cancelled morning
 * keeps the name of the volunteer who said yes, and the ordinary claim race
 * still yields exactly one winner.
 */

const NOW = SEED_REFERENCE_DATE; // Tuesday 17 November 2026, 10:00 in New York
const CONFIRMED_AT = new Date("2026-11-18T15:00:00.000Z");

const GRACE: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: seedIds.church,
};

const RUTH: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: seedIds.church,
};

const SARA: Actor = {
  personId: seedIds.people.sara,
  role: "volunteer",
  churchId: seedIds.church,
};

/** The base seed plus the demo-ready board: open times with no claim on them. */
async function seedDemoBoard(t: TestDatabase): Promise<void> {
  await truncateAll(t.db);
  await seedDatabase(t.db, { now: NOW });
  await seedDemoState(t.db, { now: NOW });
}

async function claimAndConfirm(t: TestDatabase, slotId: string): Promise<void> {
  const claimed = await claimSlot(RUTH, slotId, t.db, NOW);
  if (!claimed.ok) throw new Error(claimed.message);

  const confirmed = await approveClaim(GRACE, slotId, t.db, CONFIRMED_AT);
  if (!confirmed.ok) throw new Error(confirmed.message);
}

async function slotRow(t: TestDatabase, slotId: string) {
  const [row] = await t.db
    .select()
    .from(slot)
    .where(eq(slot.id, slotId))
    .limit(1);
  return row;
}

describe("the claim is write-once in the database", () => {
  let t: TestDatabase;
  let second: { client: ReturnType<typeof postgres>; db: SeedDb };

  beforeAll(async () => {
    t = await openTestDatabase();
    const client = postgres(t.url, {
      max: 2,
      prepare: false,
      ssl: "require",
      onnotice: () => undefined,
    });
    second = {
      client,
      db: drizzle(client, { schema }) as SeedDb,
    };
  });

  afterAll(async () => {
    await second.client.end();
    await t.client.end();
  });

  beforeEach(async () => {
    await seedDemoBoard(t);
  });

  it("installs the coherence CHECK and the write-once trigger", async () => {
    const checks = await t.client<{ conname: string }[]>`
      SELECT conname
        FROM pg_constraint
       WHERE conrelid = 'slot'::regclass
         AND contype = 'c'
         AND conname = 'slot_claim_state_coherent'
    `;
    expect(checks.map((row) => row.conname)).toEqual([
      "slot_claim_state_coherent",
    ]);

    const triggers = await t.client<{ tgname: string }[]>`
      SELECT tgname
        FROM pg_trigger
       WHERE tgrelid = 'slot'::regclass
         AND NOT tgisinternal
         AND tgname = 'slot_claim_identity_write_once'
    `;
    expect(triggers.map((row) => row.tgname)).toEqual([
      "slot_claim_identity_write_once",
    ]);
  });

  it("refuses a direct SQL reassignment of the claimed place", async () => {
    const claimed = await claimSlot(RUTH, DEMO_IDS.slotCompanion, t.db, NOW);
    expect(claimed.ok).toBe(true);

    const before = await slotRow(t, DEMO_IDS.slotCompanion);
    expect(before.status).toBe("claimed");
    expect(before.claimedBy).toBe(seedIds.people.ruth);

    // A bare UPDATE that never passes through the repository's gate.
    await expectRejection(
      () =>
        t.client`
          UPDATE slot
             SET claimed_by = ${seedIds.people.sara}
           WHERE id = ${DEMO_IDS.slotCompanion}
        `,
      /write-once/i,
    );

    const after = await slotRow(t, DEMO_IDS.slotCompanion);
    expect(after.claimedBy).toBe(seedIds.people.ruth);
    expect(after.status).toBe("claimed");

    // Revoking the claim is still allowed: clearing is not reassigning.
    await t.client`
      UPDATE slot
         SET status = 'open', claimed_by = NULL, claimed_at = NULL
       WHERE id = ${DEMO_IDS.slotCompanion}
    `;
    const revoked = await slotRow(t, DEMO_IDS.slotCompanion);
    expect(revoked.status).toBe("open");
    expect(revoked.claimedBy).toBeNull();
  });

  it("refuses any rewrite of claim_confirmed_at after confirmation", async () => {
    await claimAndConfirm(t, DEMO_IDS.slotCompanion);

    const confirmed = await slotRow(t, DEMO_IDS.slotCompanion);
    expect(confirmed.status).toBe("covered");
    expect(confirmed.claimedBy).toBe(seedIds.people.ruth);
    expect(confirmed.claimConfirmedAt).not.toBeNull();

    await expectRejection(
      () =>
        t.client`
          UPDATE slot
             SET claim_confirmed_at = now()
           WHERE id = ${DEMO_IDS.slotCompanion}
        `,
      /write-once/i,
    );

    // Clearing the confirmation is a rewrite too: the family was told.
    await expectRejection(
      () =>
        t.client`
          UPDATE slot
             SET claim_confirmed_at = NULL
           WHERE id = ${DEMO_IDS.slotCompanion}
        `,
      /write-once/i,
    );

    // The claimant is still write-once after confirmation.
    await expectRejection(
      () =>
        t.client`
          UPDATE slot
             SET claimed_by = ${seedIds.people.sara}
           WHERE id = ${DEMO_IDS.slotCompanion}
        `,
      /write-once/i,
    );

    const after = await slotRow(t, DEMO_IDS.slotCompanion);
    expect(after.status).toBe("covered");
    expect(after.claimedBy).toBe(seedIds.people.ruth);
    expect(after.claimConfirmedAt).toEqual(confirmed.claimConfirmedAt);
    expect(after.claimConfirmedBy).toBe(seedIds.people.grace);
  });

  it("refuses every incoherent status and claim combination, and exempts cancelled", async () => {
    const id = DEMO_IDS.slotCompanion;

    // open implies every claim column is null.
    await expectRejection(
      () =>
        t.client`UPDATE slot SET claimed_by = ${seedIds.people.ruth} WHERE id = ${id}`,
      /slot_claim_state_coherent/,
    );

    // claimed implies a claimant and an instant, with no confirmation yet.
    await expectRejection(
      () => t.client`UPDATE slot SET status = 'claimed' WHERE id = ${id}`,
      /slot_claim_state_coherent/,
    );

    // covered and done imply a claimant and a confirmation instant.
    await expectRejection(
      () => t.client`UPDATE slot SET status = 'covered' WHERE id = ${id}`,
      /slot_claim_state_coherent/,
    );
    await expectRejection(
      () => t.client`UPDATE slot SET status = 'done' WHERE id = ${id}`,
      /slot_claim_state_coherent/,
    );

    // draft and expired_unclaimed imply every claim column is null.
    await expectRejection(
      () =>
        t.client`UPDATE slot SET status = 'draft', claimed_at = now() WHERE id = ${id}`,
      /slot_claim_state_coherent/,
    );
    await expectRejection(
      () =>
        t.client`UPDATE slot SET status = 'expired_unclaimed', claim_confirmed_at = now() WHERE id = ${id}`,
      /slot_claim_state_coherent/,
    );

    // cancelled is deliberately unconstrained: a cancelled morning keeps the
    // volunteer who said yes.
    await t.client`
      UPDATE slot
         SET status = 'cancelled', claimed_by = ${seedIds.people.ruth}, claimed_at = now()
       WHERE id = ${id}
    `;
    const cancelled = await slotRow(t, id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.claimedBy).toBe(seedIds.people.ruth);

    // The identity guard still refuses a swap on that cancelled row.
    await expectRejection(
      () =>
        t.client`UPDATE slot SET claimed_by = ${seedIds.people.sara} WHERE id = ${id}`,
      /write-once/i,
    );
  });

  it("cancels a Respite Morning that has a confirmed volunteer", async () => {
    await claimAndConfirm(t, DEMO_IDS.slotCompanion);

    const before = await slotRow(t, DEMO_IDS.slotCompanion);
    expect(before.status).toBe("covered");
    expect(before.sessionId).not.toBeNull();
    const sessionId = before.sessionId as string;

    const outcome = await cancelSessionForCoordinator(
      GRACE,
      sessionId,
      t.db,
      NOW,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.cancelledSlotCount).toBeGreaterThanOrEqual(1);

    const after = await slotRow(t, DEMO_IDS.slotCompanion);
    expect(after.status).toBe("cancelled");
    expect(after.claimedBy).toBe(seedIds.people.ruth);
    expect(after.claimedAt).toEqual(before.claimedAt);
    expect(after.claimConfirmedBy).toBe(seedIds.people.grace);
    expect(after.claimConfirmedAt).toEqual(before.claimConfirmedAt);

    const [sessionRow] = await t.client<{ status: string }[]>`
      SELECT status FROM session WHERE id = ${sessionId}
    `;
    expect(sessionRow.status).toBe("cancelled");
  });

  it("still gives exactly one of two concurrent claims the place", async () => {
    const results = await Promise.all([
      claimSlot(RUTH, DEMO_IDS.slotCompanion, t.db, NOW),
      claimSlot(SARA, DEMO_IDS.slotCompanion, second.db, NOW),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const loser = results.find((result) => !result.ok);
    if (!loser) throw new Error("expected a loser");
    expect(loser.code).toBe("taken");

    const row = await slotRow(t, DEMO_IDS.slotCompanion);
    expect(row.status).toBe("claimed");
    expect([seedIds.people.ruth, seedIds.people.sara]).toContain(row.claimedBy);
    expect(row.claimedAt).not.toBeNull();
    expect(row.claimConfirmedAt).toBeNull();

    const wins = await t.db
      .select({ id: auditEvent.id })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.action, "slot_claimed"),
          eq(auditEvent.entity, "slot"),
          eq(auditEvent.entityId, DEMO_IDS.slotCompanion),
        ),
      );
    expect(wins).toHaveLength(1);
  });

  it("applies the seed and the demo reset cleanly under the constraint", async () => {
    const result = await runDemoReset(t.db, { now: NOW, decisionMode: "rules" });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.assertions.failed).toEqual([]);
    expect(result.assertions.passed).toBe(result.assertions.total);

    const [violations] = await t.client<{ n: number }[]>`
      SELECT count(*)::int AS n
        FROM slot
       WHERE (status IN ('open', 'draft', 'expired_unclaimed')
              AND (claimed_by IS NOT NULL OR claimed_at IS NOT NULL
                   OR claim_confirmed_by IS NOT NULL OR claim_confirmed_at IS NOT NULL))
          OR (status = 'claimed'
              AND (claimed_by IS NULL OR claimed_at IS NULL
                   OR claim_confirmed_at IS NOT NULL))
          OR (status IN ('covered', 'done')
              AND (claimed_by IS NULL OR claim_confirmed_at IS NULL))
    `;
    expect(violations.n).toBe(0);

    const [openPublished] = await t.client<{ n: number }[]>`
      SELECT count(*)::int AS n
        FROM slot
       WHERE status = 'open' AND approved_at IS NOT NULL
    `;
    expect(openPublished.n).toBeGreaterThanOrEqual(1);
  });
});

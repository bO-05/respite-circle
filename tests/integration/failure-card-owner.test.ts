import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { SEED_REFERENCE_DATE, seedIds } from "../../src/db/seed-data";
import { ask, person, slot } from "../../src/db/schema";
import type { Actor } from "../../src/server/auth/policy";
import { coverageCallLeadLine } from "../../src/server/domain/coverage";
import {
  getDeskSlotCoverage,
  listCoverageWatch,
} from "../../src/server/repositories/coverage";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-R2PROM-006 — a failure card names who is responsible, not who is
 * looking.
 *
 * The card used to render the signed-in desk person's name, so the deputy saw
 * "Daniel Okafor calls David" on a case Grace had approved. The responsible
 * coordinator is now read from the case itself: the person who approved the
 * family's ask, or — for a time published before that approval — the person
 * who published the time. A time the signed policy published by itself has no
 * human assignment, and the card says so instead of naming whoever renders it.
 *
 * The viewers here are the seeded lead (Grace), the seeded deputy (Daniel) and
 * a second coordinator (Nora) inserted by this fixture. Rendering the same
 * case for all three must produce one name: Grace's.
 */

const NOW = SEED_REFERENCE_DATE; // Tuesday 17 November 2026, 10:00 in New York

const NORA_ID = "a9000000-0000-4000-8000-000000000001";
const ASK_ID = "d9000000-0000-4000-8000-000000000001";
const SLOT_ID = "d9000000-0000-4000-8000-000000000002";

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

const NORA: Actor = {
  personId: NORA_ID,
  role: "coordinator",
  churchId: seedIds.church,
};

const VIEWERS = [
  { label: "the lead coordinator", actor: GRACE, ownName: "Grace" },
  { label: "the deputy", actor: DANIEL, ownName: "Daniel" },
  { label: "a second coordinator", actor: NORA, ownName: "Nora" },
] as const;

/**
 * One published time that is due in the coverage watch: its window opens in
 * twelve hours, inside the church's 48-hour call threshold.
 *
 * `askApprovedBy` is the family-level assignment; `slotApprovedBy` is the
 * publication decision for this specific time. Both null plus
 * `publishedVia: "auto_low_risk"` is the reachable case where no human took
 * responsibility: a meal the signed low-risk policy published at intake.
 */
async function insertOpenTime(
  t: TestDatabase,
  input: {
    askApprovedBy: string | null;
    slotApprovedBy: string | null;
    publishedVia: "coordinator" | "auto_low_risk";
  },
): Promise<void> {
  const windowStart = new Date(NOW.getTime() + 12 * 3_600_000);
  const windowEnd = new Date(windowStart.getTime() + 2 * 3_600_000);

  await t.db.insert(ask).values({
    id: ASK_ID,
    churchId: seedIds.church,
    caregiverId: seedIds.people.marta,
    careRecipientId: seedIds.careRecipients.elena,
    verbatimText:
      "Could someone bring a hot dinner one evening this week? I am worn out.",
    status: input.askApprovedBy ? "approved" : "waiting_coordinator",
    policyVersionId: seedIds.policyV1,
    approvedBy: input.askApprovedBy,
    approvedAt: input.askApprovedBy ? NOW : null,
  });

  await t.db.insert(slot).values({
    id: SLOT_ID,
    askId: ASK_ID,
    churchId: seedIds.church,
    sessionId: null,
    kind: "meal",
    tier: "doorstep",
    label: "A hot dinner",
    windowStart,
    windowEnd,
    gated: false,
    orientationNote: null,
    ruleRef: "q3_meal",
    status: "open",
    publishedVia: input.publishedVia,
    approvedBy: input.slotApprovedBy,
    approvedAt: NOW,
  });
}

async function watchFor(
  t: TestDatabase,
  viewer: Actor,
): Promise<{
  name: string | null;
  line: string;
  caregiverFirstName: string;
  kind: string;
  windowStart: Date | null;
}> {
  const items = await listCoverageWatch(viewer, t.db, NOW);
  expect(items).toHaveLength(1);
  const item = items[0];
  return {
    name: item.responsibleCoordinatorName,
    line: coverageCallLeadLine({
      responsibleCoordinatorName: item.responsibleCoordinatorName,
      caregiverFirstName: item.caregiverFirstName,
    }),
    caregiverFirstName: item.caregiverFirstName,
    kind: item.kind,
    windowStart: item.windowStart,
  };
}

let database: TestDatabase;

describe("the failure card's responsible coordinator", () => {
  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(async () => {
    await database.client.end();
  });

  beforeEach(async () => {
    await truncateAll(database.db);
    await seedDatabase(database.db, { now: NOW });

    // A second coordinator in the same church. The card must not follow this
    // session either; the point is that any desk face renders the same name.
    await database.db.insert(person).values({
      id: NORA_ID,
      churchId: seedIds.church,
      firstName: "Nora",
      lastName: "Bennett",
      roles: ["coordinator"],
      accessToken: "nora-second-coordinator-7d2a",
    });
  });

  it("VAL-R2PROM-006 — renders one case the same for the lead, the deputy and a second coordinator", async () => {
    await insertOpenTime(database, {
      askApprovedBy: seedIds.people.grace,
      slotApprovedBy: seedIds.people.grace,
      publishedVia: "coordinator",
    });

    const rendered = [];
    for (const viewer of VIEWERS) {
      rendered.push({ viewer, card: await watchFor(database, viewer.actor) });
    }

    // One name, three viewers: the lead, the deputy and the second
    // coordinator all read Grace, who approved this family's ask.
    expect(rendered.map((entry) => entry.card.name)).toEqual([
      "Grace Whitfield",
      "Grace Whitfield",
      "Grace Whitfield",
    ]);

    const expected =
      "Grace Whitfield calls Marta; the app sends nothing.";
    for (const { card } of rendered) {
      expect(card.line).toBe(expected);
    }
    // The viewers who are not responsible never see themselves substituted in.
    // Grace is the responsible coordinator, so her name is the correct one.
    expect(rendered[0].card.line).toContain("Grace");
    expect(rendered[1].card.line).not.toContain("Daniel");
    expect(rendered[2].card.line).not.toContain("Nora");

    // Nothing else on the card moves with the session either.
    const shapes = new Set(
      rendered.map(
        ({ card }) =>
          `${card.caregiverFirstName}|${card.kind}|${card.windowStart?.toISOString()}`,
      ),
    );
    expect(shapes.size).toBe(1);
  });

  it("VAL-R2PROM-006 — the slot review reads the same name as the watch", async () => {
    await insertOpenTime(database, {
      askApprovedBy: seedIds.people.grace,
      slotApprovedBy: seedIds.people.grace,
      publishedVia: "coordinator",
    });

    const watch = await watchFor(database, DANIEL);
    const card = await getDeskSlotCoverage(DANIEL, SLOT_ID, database.db, NOW);
    expect(card).not.toBeNull();
    expect(card?.responsibleCoordinatorName).toBe("Grace Whitfield");
    expect(
      coverageCallLeadLine({
        responsibleCoordinatorName: card?.responsibleCoordinatorName ?? null,
        caregiverFirstName: card?.caregiverFirstName ?? "",
      }),
    ).toBe(watch.line);
  });

  it("VAL-R2PROM-006 — a time published before the ask was approved names its publisher", async () => {
    // A held draft resolved before the ask was approved: the ask has no
    // approver yet, so the publication decision is the only assignment.
    await insertOpenTime(database, {
      askApprovedBy: null,
      slotApprovedBy: seedIds.people.grace,
      publishedVia: "coordinator",
    });

    for (const viewer of VIEWERS) {
      const card = await watchFor(database, viewer.actor);
      expect(card.name).toBe("Grace Whitfield");
      expect(card.line).toBe(
        "Grace Whitfield calls Marta; the app sends nothing.",
      );
    }
  });

  it("VAL-R2PROM-006 — with no assignment the card says so and names nobody", async () => {
    // The signed low-risk policy published this meal at intake. No person
    // approved the ask or the time, so there is no responsible coordinator —
    // and the card may not fall back to the session looking at it.
    await insertOpenTime(database, {
      askApprovedBy: null,
      slotApprovedBy: null,
      publishedVia: "auto_low_risk",
    });

    for (const viewer of VIEWERS) {
      const card = await watchFor(database, viewer.actor);
      expect(card.name).toBeNull();
      expect(card.line).toBe(
        "No coordinator is assigned to this family yet; the app sends nothing.",
      );
      expect(card.line).not.toContain(viewer.ownName);
      expect(card.line).not.toMatch(/Grace|Whitfield|Daniel|Okafor|Marta/);
    }
  });
});

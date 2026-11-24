import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import {
  SEED_REFERENCE_DATE,
  seedIds,
  seedPolicy,
} from "../../src/db/seed-data";
import {
  ask,
  askRevision,
  auditEvent,
  decision,
  person,
  policy,
  slot,
  slotCandidate,
  volunteer,
} from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import {
  RULE_CODE_COPY,
  type RuleCode,
} from "../../src/server/domain/gating";
import type { TypedAnswer } from "../../src/server/domain/slots";
import { constructDraftSlots } from "../../src/server/services/slot-construction";
import {
  evaluateCandidatesForSlots,
  reevaluateExclusions,
} from "../../src/server/services/candidate-evaluation";
import { getExclusionPanel } from "../../src/server/repositories/exclusions";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * The "why not proposed" data layer, against the isolated `respite_circle_e2e`
 * database.
 *
 * VAL-DESK-008: every active volunteer is evaluated for every draft slot, one
 * `slot_candidate` row each, carrying the eligible flag, rule code, fix hint,
 * and owner. A changed volunteer file changes the explanation on the next
 * evaluation, without duplicating rows. The panel is coordinator-only and the
 * rows are never reachable from a caregiver, volunteer, or another church.
 */

const NOW = SEED_REFERENCE_DATE; // Tuesday 17 November 2026, 10:00 in New York

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

const RUTH: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: seedIds.church,
};

const MARTA: Actor = {
  personId: seedIds.people.marta,
  role: "caregiver",
  churchId: seedIds.church,
};

const OTHER_CHURCH = "c9999999-9999-4999-8999-999999999999";
const OTHER_COORDINATOR: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: OTHER_CHURCH,
};

const TRANSPORT_POLICY_ID = "b0000000-0000-4000-8000-000000000002";

function answer(
  questionId: string,
  value: unknown,
  abstained = false,
): TypedAnswer {
  return { questionId, answer: value, abstained };
}

const HERO_ANSWERS: TypedAnswer[] = [
  answer("Q1", true),
  answer("Q2", false),
  answer("Q3", false),
  answer("Q4", "saturday"),
  answer("Q5", false),
  answer("Q6", true),
  answer("Q7", "unknown"),
  answer("Q8", false),
  answer("Q9", false),
];

const DRIVE_ANSWERS: TypedAnswer[] = [
  answer("Q1", false),
  answer("Q2", true),
  answer("Q3", false),
  answer("Q4", "saturday"),
  answer("Q5", false),
  answer("Q6", false),
  answer("Q7", "unknown"),
  answer("Q8", false),
  answer("Q9", false),
];

function isPick(questionId: string): boolean {
  return questionId === "Q4" || questionId === "Q7";
}

async function insertAskWithAnswers(
  t: TestDatabase,
  options: {
    status?: string;
    answers?: TypedAnswer[];
    policyVersionId?: string;
  } = {},
): Promise<{ askId: string; revisionId: string }> {
  const askId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const answers = options.answers ?? HERO_ANSWERS;
  const policyVersionId = options.policyVersionId ?? seedIds.policyV1;
  const text =
    "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.";

  await t.db.insert(ask).values({
    id: askId,
    churchId: seedIds.church,
    caregiverId: seedIds.people.marta,
    careRecipientId: seedIds.careRecipients.elena,
    verbatimText: text,
    status: (options.status ?? "waiting_coordinator") as
      | "waiting_coordinator"
      | "draft"
      | "safety_hold"
      | "care_hold"
      | "approved"
      | "sent_back"
      | "closed"
      | "withdrawn",
    policyVersionId,
  });

  await t.db.insert(askRevision).values({
    id: revisionId,
    askId,
    verbatimText: text,
    digest: sha256Hex(text),
  });

  await t.db.insert(decision).values(
    answers.map((entry, index) => ({
      askId,
      askRevisionId: revisionId,
      policyVersionId,
      questionId: entry.questionId,
      questionText: `Question ${entry.questionId}`,
      answerType: isPick(entry.questionId)
        ? ("pick" as const)
        : ("yesno" as const),
      answer: entry.answer as boolean | string,
      confidence: 0.92,
      abstained: entry.abstained,
      samples: null,
      model: "fake-typed-v1",
      provider: "deterministic",
      latencyMs: 14,
      digest: sha256Hex(`${askId}:${entry.questionId}:${index}`),
    })),
  );

  return { askId, revisionId };
}

async function insertTransportPolicy(t: TestDatabase): Promise<void> {
  await t.db.insert(policy).values({
    id: TRANSPORT_POLICY_ID,
    churchId: seedIds.church,
    version: 2,
    safeguardingPromises: [...seedPolicy.safeguardingPromises],
    questionSet: seedPolicy.questionSet.map((question) => ({ ...question })),
    crisisScript: seedPolicy.crisisScript,
    localCrisisLine: seedPolicy.localCrisisLine,
    referralResources: seedPolicy.referralResources.map((resource) => ({
      ...resource,
    })),
    familiarFaceDefault: true,
    reminderWindowHours: 24,
    callThresholdHours: 48,
    transportEnabled: true,
    autoPublishLowRisk: false,
    signedOffBy: "Grace Whitfield",
    signedOffAt: new Date("2026-11-16T15:00:00.000Z"),
  });
}

async function constructHero(t: TestDatabase): Promise<{
  askId: string;
  slotIds: string[];
}> {
  const { askId } = await insertAskWithAnswers(t);
  const result = await constructDraftSlots({
    askId,
    churchId: seedIds.church,
    database: t.db,
    now: NOW,
  });
  expect(result.reason).toBe("created");
  const slots = await t.db
    .select({ id: slot.id, kind: slot.kind })
    .from(slot)
    .where(eq(slot.askId, askId));
  return { askId, slotIds: slots.map((row) => row.id) };
}

/** A commitment the volunteer already holds, on a given UTC window. */
async function insertCommitment(
  t: TestDatabase,
  input: {
    askId: string;
    volunteerId: string;
    start: string;
    end: string;
    kind?: "companion" | "home" | "meal";
    status?: "claimed" | "covered" | "done";
  },
): Promise<string> {
  const [inserted] = await t.db
    .insert(slot)
    .values({
      askId: input.askId,
      churchId: seedIds.church,
      kind: input.kind ?? "companion",
      tier: input.kind === "home" ? "in_home" : "public_event",
      label: "Already-held place",
      windowStart: new Date(input.start),
      windowEnd: new Date(input.end),
      gated: false,
      status: input.status ?? "claimed",
      claimedBy: input.volunteerId,
      claimedAt: NOW,
      claimConfirmedBy:
        input.status === "covered" || input.status === "done"
          ? seedIds.people.grace
          : null,
      claimConfirmedAt:
        input.status === "covered" || input.status === "done" ? NOW : null,
    })
    .returning({ id: slot.id });
  return inserted.id;
}

function ruleFor(
  panel: NonNullable<Awaited<ReturnType<typeof getExclusionPanel>>>,
  slotId: string,
  volunteerId: string,
): RuleCode {
  const view = panel.slots.find((entry) => entry.slotId === slotId);
  expect(view, `slot ${slotId} is missing from the panel`).toBeDefined();
  const row = view?.rows.find((entry) => entry.volunteerId === volunteerId);
  expect(row, `volunteer ${volunteerId} is missing from slot ${slotId}`).toBeDefined();
  return row?.ruleCode as RuleCode;
}

describe("candidate exclusion evaluation", () => {
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

  it("records one row for every active volunteer on every draft slot", async () => {
    const { askId } = await constructHero(t);

    const [counts] = await t.client<{ rows: number; slots: number }[]>`
      SELECT COUNT(*)::int AS rows,
             COUNT(DISTINCT slot_id)::int AS slots
        FROM slot_candidate
       WHERE slot_id IN (SELECT id FROM slot WHERE ask_id = ${askId})
    `;
    expect(counts).toEqual({ rows: 8, slots: 2 });

    const panel = await getExclusionPanel(GRACE, askId, t.db);
    expect(panel).not.toBeNull();
    expect(panel?.slots).toHaveLength(2);
    expect(panel?.activeVolunteerCount).toBe(4);
    expect(panel?.staleSlotCount).toBe(0);
    expect(panel?.evaluatedAt).toBeInstanceOf(Date);

    for (const view of panel?.slots ?? []) {
      expect(view.rows).toHaveLength(4);
      expect(view.eligibleCount + view.ineligibleCount).toBe(4);
      expect(view.rows.map((row) => row.firstName)).toEqual([
        "Ben",
        "Ruth",
        "Sara",
        "Tom",
      ]);
    }

    const home = panel?.slots.find((entry) => entry.kind === "home");
    const companion = panel?.slots.find((entry) => entry.kind === "companion");
    expect(home?.gated).toBe(true);
    expect(companion?.gated).toBe(false);

    // Ruth is an attested familiar face for Elena; Sara and Ben have a current
    // checklist, two references, and current training and background.
    expect(ruleFor(panel!, home!.slotId, seedIds.people.ruth)).toBe("eligible");
    expect(ruleFor(panel!, home!.slotId, seedIds.people.sara)).toBe("eligible");
    expect(ruleFor(panel!, home!.slotId, seedIds.people.ben)).toBe("eligible");
    // Tom has never completed the safeguarding checklist.
    expect(ruleFor(panel!, home!.slotId, seedIds.people.tom)).toBe(
      "no_checklist",
    );

    for (const volunteerId of [
      seedIds.people.ruth,
      seedIds.people.sara,
      seedIds.people.tom,
      seedIds.people.ben,
    ]) {
      expect(ruleFor(panel!, companion!.slotId, volunteerId)).toBe("eligible");
    }

    const tomRow = home?.rows.find(
      (row) => row.volunteerId === seedIds.people.tom,
    );
    expect(tomRow?.eligible).toBe(false);
    expect(tomRow?.fixHint).toMatch(/checklist/i);
    expect(tomRow?.owner).toBe("coordinator");
    expect(tomRow?.ruleTitle).toBe(RULE_CODE_COPY.no_checklist.title);

    // Nothing scored, ranked, or counted against a person.
    const [rawRow] = await t.client<Record<string, unknown>[]>`
      SELECT * FROM slot_candidate WHERE slot_id = ${home!.slotId} LIMIT 1
    `;
    expect(Object.keys(rawRow).sort()).toEqual([
      "created_at",
      "eligible",
      "fix_hint",
      "id",
      "owner",
      "rule_code",
      "slot_id",
      "volunteer_id",
    ]);
  });

  it("changes the explanation on the next evaluation and never duplicates a row", async () => {
    const { askId } = await constructHero(t);
    const home = (await getExclusionPanel(GRACE, askId, t.db))?.slots.find(
      (entry) => entry.kind === "home",
    );
    expect(home).toBeDefined();
    expect(ruleFor(
      (await getExclusionPanel(GRACE, askId, t.db))!,
      home!.slotId,
      seedIds.people.tom,
    )).toBe("no_checklist");

    await t.db
      .update(volunteer)
      .set({
        checklistCompletedAt: new Date("2026-10-01T14:00:00.000Z"),
        referencesContacted: 2,
        trainingExpiresOn: "2027-09-30",
        backgroundRenewsOn: "2027-09-30",
      })
      .where(eq(volunteer.personId, seedIds.people.tom));

    const reevaluated = await reevaluateExclusions(GRACE, askId, t.db, NOW);
    expect(reevaluated.ok).toBe(true);
    expect(reevaluated.counts).toMatchObject({ volunteers: 4, slots: 2 });

    const panel = await getExclusionPanel(GRACE, askId, t.db);
    expect(ruleFor(panel!, home!.slotId, seedIds.people.tom)).toBe("eligible");

    const [after] = await t.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM slot_candidate
       WHERE slot_id = ${home!.slotId}
    `;
    expect(after.count).toBe(4);

    const [audit] = await t.db
      .select({ action: auditEvent.action, detail: auditEvent.detail })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.action, "candidates_evaluated"),
          eq(auditEvent.entityId, askId),
        ),
      )
      .limit(1);
    expect(audit).toBeDefined();
    expect(audit.detail).toMatchObject({
      volunteers: 4,
      slots: 2,
    });
  });

  it("drops a deactivated volunteer and picks up a newly active one", async () => {
    const { askId } = await constructHero(t);

    await t.db
      .update(person)
      .set({ active: false })
      .where(eq(person.id, seedIds.people.ben));
    await reevaluateExclusions(GRACE, askId, t.db, NOW);

    let panel = await getExclusionPanel(GRACE, askId, t.db);
    expect(panel?.activeVolunteerCount).toBe(3);
    expect(
      panel?.slots.every((view) =>
        view.rows.every((row) => row.volunteerId !== seedIds.people.ben),
      ),
    ).toBe(true);

    const newPersonId = crypto.randomUUID();
    await t.db.insert(person).values({
      id: newPersonId,
      churchId: seedIds.church,
      firstName: "Ada",
      lastName: "Mensah",
      roles: ["volunteer"],
      accessToken: "ada-volunteer-test-0001",
      active: true,
    });
    await t.db.insert(volunteer).values({
      personId: newPersonId,
      driverOk: false,
      checklistCompletedAt: new Date("2026-11-01T14:00:00.000Z"),
      checklistVersion: "safeguarding-2026.1",
      referencesContacted: 2,
      trainingExpiresOn: "2027-11-01",
      backgroundRenewsOn: "2027-11-01",
    });

    panel = await getExclusionPanel(GRACE, askId, t.db);
    expect(panel?.activeVolunteerCount).toBe(4);
    expect(panel?.staleSlotCount).toBe(2);

    await reevaluateExclusions(GRACE, askId, t.db, NOW);
    panel = await getExclusionPanel(GRACE, askId, t.db);
    expect(panel?.staleSlotCount).toBe(0);
    expect(
      panel?.slots.every((view) =>
        view.rows.some((row) => row.volunteerId === newPersonId),
      ),
    ).toBe(true);
  });

  it("records a direct time clash and a second place from real commitments", async () => {
    const { askId } = await constructHero(t);
    let panel = await getExclusionPanel(GRACE, askId, t.db);
    const home = panel?.slots.find((entry) => entry.kind === "home");
    expect(home).toBeDefined();
    const homeStart = home!.windowStart as Date;
    const homeEnd = home!.windowEnd as Date;

    // Ruth: one overlapping place, so the clash is the reason.
    await insertCommitment(t, {
      askId,
      volunteerId: seedIds.people.ruth,
      start: new Date(homeStart.getTime() + 30 * 60 * 1000).toISOString(),
      end: new Date(homeEnd.getTime() + 30 * 60 * 1000).toISOString(),
    });

    // Tom: two places the same local day, neither overlapping the home window.
    const dayStart = new Date(homeStart);
    dayStart.setUTCHours(12, 0, 0, 0);
    await insertCommitment(t, {
      askId,
      volunteerId: seedIds.people.tom,
      start: new Date(dayStart.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      end: new Date(dayStart.getTime() - 60 * 60 * 1000).toISOString(),
    });
    await insertCommitment(t, {
      askId,
      volunteerId: seedIds.people.tom,
      start: new Date(dayStart.getTime() + 5 * 60 * 60 * 1000).toISOString(),
      end: new Date(dayStart.getTime() + 6 * 60 * 60 * 1000).toISOString(),
    });

    await reevaluateExclusions(GRACE, askId, t.db, NOW);
    panel = await getExclusionPanel(GRACE, askId, t.db);
    expect(ruleFor(panel!, home!.slotId, seedIds.people.ruth)).toBe(
      "unavailable_window",
    );
    expect(ruleFor(panel!, home!.slotId, seedIds.people.tom)).toBe(
      "already_serving_twice",
    );
  });

  it("evaluates a drive against the ask's policy and each driver record", async () => {
    await insertTransportPolicy(t);
    const { askId } = await insertAskWithAnswers(t, {
      answers: DRIVE_ANSWERS,
      policyVersionId: TRANSPORT_POLICY_ID,
    });
    const built = await constructDraftSlots({
      askId,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(built.reason).toBe("created");
    expect(built.proposals).toBe(1);

    const [drive] = await t.db
      .select({ id: slot.id })
      .from(slot)
      .where(and(eq(slot.askId, askId), eq(slot.kind, "drive")));
    expect(drive).toBeDefined();

    let panel = await getExclusionPanel(GRACE, askId, t.db);
    expect(ruleFor(panel!, drive.id, seedIds.people.ruth)).toBe("eligible");
    expect(ruleFor(panel!, drive.id, seedIds.people.tom)).toBe("eligible");
    expect(ruleFor(panel!, drive.id, seedIds.people.sara)).toBe(
      "driver_not_ok",
    );
    expect(ruleFor(panel!, drive.id, seedIds.people.ben)).toBe(
      "driver_not_ok",
    );

    await t.db
      .update(volunteer)
      .set({ driverOk: true })
      .where(eq(volunteer.personId, seedIds.people.ben));
    await reevaluateExclusions(GRACE, askId, t.db, NOW);
    panel = await getExclusionPanel(GRACE, askId, t.db);
    expect(ruleFor(panel!, drive.id, seedIds.people.ben)).toBe("eligible");
  });

  it("blocks a whole drive while the driver policy is unsigned", async () => {
    const { askId } = await constructHero(t);
    const [inserted] = await t.db
      .insert(slot)
      .values({
        askId,
        churchId: seedIds.church,
        kind: "drive",
        tier: "transport",
        label: "Drive — Saturday",
        windowStart: new Date("2026-11-21T15:00:00.000Z"),
        windowEnd: new Date("2026-11-21T17:00:00.000Z"),
        gated: true,
        status: "draft",
        ruleRef: "manual",
      })
      .returning({ id: slot.id });

    await evaluateCandidatesForSlots(t.db, {
      churchId: seedIds.church,
      slotIds: [inserted.id],
      now: NOW,
    });
    const panel = await getExclusionPanel(GRACE, askId, t.db);
    for (const volunteerId of [
      seedIds.people.ruth,
      seedIds.people.sara,
      seedIds.people.tom,
      seedIds.people.ben,
    ]) {
      expect(ruleFor(panel!, inserted.id, volunteerId)).toBe(
        "no_driver_policy",
      );
    }
    const policyRow = panel?.slots
      .find((view) => view.slotId === inserted.id)
      ?.rows.find((row) => row.volunteerId === seedIds.people.ruth);
    expect(policyRow?.owner).toBe("church");
  });

  it("never proposes the family's own caregiver", async () => {
    await t.db
      .update(person)
      .set({ roles: ["caregiver", "volunteer"] })
      .where(eq(person.id, seedIds.people.marta));
    await t.db.insert(volunteer).values({
      personId: seedIds.people.marta,
      driverOk: true,
      checklistCompletedAt: null,
      referencesContacted: 0,
    });

    const { askId } = await constructHero(t);
    await reevaluateExclusions(GRACE, askId, t.db, NOW);
    const panel = await getExclusionPanel(GRACE, askId, t.db);
    const home = panel?.slots.find((entry) => entry.kind === "home");
    expect(ruleFor(panel!, home!.slotId, seedIds.people.marta)).toBe(
      "recipient_not_eligible",
    );
  });

  it("is coordinator-only, church-scoped, and idempotent", async () => {
    const { askId, slotIds } = await constructHero(t);

    // The deputy holds the same desk authority.
    await expect(getExclusionPanel(DANIEL, askId, t.db)).resolves.not.toBeNull();
    await expect(reevaluateExclusions(DANIEL, askId, t.db, NOW)).resolves.toMatchObject(
      { ok: true },
    );

    await expect(getExclusionPanel(RUTH, askId, t.db)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(getExclusionPanel(MARTA, askId, t.db)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(
      reevaluateExclusions(RUTH, askId, t.db, NOW),
    ).rejects.toBeInstanceOf(AuthError);

    expect(await getExclusionPanel(OTHER_COORDINATOR, askId, t.db)).toBeNull();
    await expect(
      reevaluateExclusions(OTHER_COORDINATOR, askId, t.db, NOW),
    ).resolves.toMatchObject({ ok: false });

    const before = await t.db
      .select()
      .from(slotCandidate)
      .where(eq(slotCandidate.slotId, slotIds[0]));
    await reevaluateExclusions(GRACE, askId, t.db, NOW);
    await reevaluateExclusions(GRACE, askId, t.db, NOW);
    const after = await t.db
      .select()
      .from(slotCandidate)
      .where(eq(slotCandidate.slotId, slotIds[0]));
    expect(before).toHaveLength(4);
    expect(after).toHaveLength(4);
    expect(after.map((row) => row.volunteerId).sort()).toEqual(
      before.map((row) => row.volunteerId).sort(),
    );
  });

  it("refuses to evaluate an ask that is no longer waiting", async () => {
    const { askId } = await insertAskWithAnswers(t, { status: "approved" });
    const result = await reevaluateExclusions(GRACE, askId, t.db, NOW);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/waiting|draft|publish/i);
  });

  it("reports an empty panel, not an error, when no draft time exists", async () => {
    const { askId } = await insertAskWithAnswers(t);
    const panel = await getExclusionPanel(GRACE, askId, t.db);
    expect(panel).not.toBeNull();
    expect(panel?.slots).toEqual([]);
    expect(panel?.activeVolunteerCount).toBe(4);
  });
});

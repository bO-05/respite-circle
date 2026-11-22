import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import {
  seedCrisisScript,
  seedIds,
  seedLocalCrisisLine,
  seedQuestionSet,
  seedReferralResources,
  seedPolicy,
  seedSafeguardingPromises,
} from "../../src/db/seed-data";
import { ask, askRevision, decision } from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import {
  createPolicyVersion,
  getPolicyForCoordinator,
  getPolicyInForce,
  getVolunteerPolicyView,
  type PolicyVersionInput,
} from "../../src/server/repositories/policy";
import {
  expectRejection,
  openTestDatabase,
  type TestDatabase,
} from "./helpers/db";

type SeedPolicyRow = {
  id: string;
  version: number;
  safeguarding_promises: string[];
  question_set: Array<{
    id: string;
    key: string;
    text: string;
    answerType: string;
    options?: string[];
    samples?: number;
  }>;
  crisis_script: string;
  local_crisis_line: string | null;
  referral_resources: Array<{
    name: string;
    detail: string;
    phone?: string;
    url?: string;
  }>;
  familiar_face_default: boolean;
  reminder_window_hours: number;
  call_threshold_hours: number;
  auto_publish_low_risk: boolean;
  signed_off_by: string | null;
  signed_off_at: string | Date | null;
};

const grace: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: seedIds.church,
};

const marta: Actor = {
  personId: seedIds.people.marta,
  role: "caregiver",
  churchId: seedIds.church,
};

const ruth: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: seedIds.church,
};

const revisedPolicy: PolicyVersionInput = {
  safeguardingPromises: [...seedSafeguardingPromises],
  questionSet: seedQuestionSet.map((question) => ({ ...question })),
  crisisScript: seedCrisisScript,
  localCrisisLine: seedLocalCrisisLine,
  referralResources: seedReferralResources.map((resource) => ({
    ...resource,
  })),
  familiarFaceDefault: true,
  reminderWindowHours: 24,
  callThresholdHours: 48,
  autoPublishLowRisk: false,
  signedOffBy: "Grace Whitfield",
};

describe("versioned policy content", () => {
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

  it("seeds version 1 with every content field", async () => {
    const [row] = await t.client<SeedPolicyRow[]>`
      SELECT id, version, safeguarding_promises, question_set, crisis_script,
             local_crisis_line, referral_resources, familiar_face_default,
             reminder_window_hours, call_threshold_hours, auto_publish_low_risk,
             signed_off_by, signed_off_at
        FROM policy
       WHERE version = 1
    `;

    expect(row).toBeTruthy();
    expect(row.question_set.map((question) => question.id)).toEqual([
      "Q1",
      "Q2",
      "Q3",
      "Q4",
      "Q5",
      "Q6",
      "Q7",
      "Q8",
      "Q9",
    ]);
    for (const question of row.question_set) {
      expect(question.text.trim().length).toBeGreaterThan(0);
      expect(["yesno", "pick"]).toContain(question.answerType);
    }

    expect(row.safeguarding_promises).toEqual(seedSafeguardingPromises);
    expect(row.crisis_script).toBe(seedCrisisScript);
    expect(row.crisis_script).toMatch(/988/);
    expect(row.crisis_script).toMatch(/911/);

    const referralNames = row.referral_resources
      .map((resource) => resource.name)
      .join(" | ");
    expect(referralNames).toMatch(/ARCH/);
    expect(referralNames).toMatch(/Area Agency on Aging/);
    expect(referralNames).toMatch(/988/);
    expect(row.local_crisis_line).toBe(seedLocalCrisisLine);

    expect(row.familiar_face_default).toBe(true);
    expect(row.reminder_window_hours).toBe(
      seedPolicy.reminderWindowHours,
    );
    expect(row.call_threshold_hours).toBe(seedPolicy.callThresholdHours);
    expect(row.auto_publish_low_risk).toBe(false);
    expect(row.signed_off_by).toBe("Grace Whitfield");
    expect(new Date(row.signed_off_at!).toISOString()).toBe(
      seedPolicy.signedOffAt.toISOString(),
    );
  });

  it("records the policy version in force on every ask and decision", async () => {
    const inForce = await getPolicyInForce(seedIds.church, t.db);
    expect(inForce).toBeTruthy();
    expect(inForce?.version).toBe(1);

    const [createdAsk] = await t.db
      .insert(ask)
      .values({
        churchId: seedIds.church,
        caregiverId: seedIds.people.marta,
        careRecipientId: seedIds.careRecipients.elena,
        verbatimText:
          "I haven't had a Saturday morning to myself since March.",
        status: "waiting_coordinator",
        policyVersionId: inForce!.id,
      })
      .returning({ id: ask.id });

    const [revision] = await t.db
      .insert(askRevision)
      .values({
        askId: createdAsk.id,
        verbatimText:
          "I haven't had a Saturday morning to myself since March.",
        digest: "d".repeat(64),
      })
      .returning({ id: askRevision.id });

    await t.db.insert(decision).values({
      askId: createdAsk.id,
      askRevisionId: revision.id,
      policyVersionId: inForce!.id,
      questionId: "Q1",
      questionText: seedQuestionSet[0].text,
      answerType: "yesno",
      answer: true,
      confidence: 0.93,
      abstained: false,
      model: "test-model",
      provider: "deterministic",
      latencyMs: 5,
      digest: "sha256:test-digest",
    });

    const [joined] = await t.client<
      {
        ask_policy: string;
        decision_policy: string;
        version: number;
      }[]
    >`
      SELECT a.policy_version_id AS ask_policy,
             d.policy_version_id AS decision_policy,
             p.version
        FROM ask a
        JOIN decision d ON d.ask_id = a.id
        JOIN policy p ON p.id = a.policy_version_id
       WHERE a.id = ${createdAsk.id}
    `;

    expect(joined.ask_policy).toBe(inForce!.id);
    expect(joined.decision_policy).toBe(inForce!.id);
    expect(joined.version).toBe(1);
  });

  it("creates a new immutable version and leaves the old one untouched", async () => {
    const v1 = await getPolicyInForce(seedIds.church, t.db);
    expect(v1?.version).toBe(1);

    const v2 = await createPolicyVersion(
      grace,
      {
        ...revisedPolicy,
        safeguardingPromises: [
          ...seedSafeguardingPromises,
          "Promises are reviewed with the church every year.",
        ],
      },
      t.db,
    );

    expect(v2.version).toBe(2);
    expect(v2.signedOffBy).toBe("Grace Whitfield");
    expect(v2.signedOffAt).toBeInstanceOf(Date);
    expect(v2.autoPublishLowRisk).toBe(false);
    expect(v2.safeguardingPromises).toHaveLength(7);

    const [oldRow] = await t.client<
      { safeguarding_promises: string[]; crisis_script: string }[]
    >`
      SELECT safeguarding_promises, crisis_script
        FROM policy
       WHERE id = ${v1!.id}
    `;
    expect(oldRow.safeguarding_promises).toEqual(seedSafeguardingPromises);
    expect(oldRow.crisis_script).toBe(seedCrisisScript);

    const inForce = await getPolicyInForce(seedIds.church, t.db);
    expect(inForce?.version).toBe(2);
    expect(inForce?.id).toBe(v2.id);

    await expectRejection(
      () =>
        t.client`UPDATE policy SET crisis_script = 'rewritten' WHERE id = ${v1!.id}`,
      /policy is append-only/i,
    );
    await expectRejection(
      () => t.client`DELETE FROM policy WHERE id = ${v1!.id}`,
      /policy is append-only/i,
    );

    const versions = await t.client<{ version: number }[]>`
      SELECT version FROM policy ORDER BY version
    `;
    expect(versions.map((row) => row.version)).toEqual([1, 2]);
  });

  it("keeps each ask on the version that was in force at creation", async () => {
    const firstVersion = await getPolicyInForce(seedIds.church, t.db);

    const [firstAsk] = await t.db
      .insert(ask)
      .values({
        churchId: seedIds.church,
        caregiverId: seedIds.people.marta,
        careRecipientId: seedIds.careRecipients.elena,
        verbatimText: "I need a few quiet hours on a Saturday.",
        status: "waiting_coordinator",
        policyVersionId: firstVersion!.id,
      })
      .returning({ id: ask.id });

    const secondVersion = await createPolicyVersion(
      grace,
      { ...revisedPolicy, callThresholdHours: 72 },
      t.db,
    );

    const [secondAsk] = await t.db
      .insert(ask)
      .values({
        churchId: seedIds.church,
        caregiverId: seedIds.people.david,
        careRecipientId: seedIds.careRecipients.june,
        verbatimText: "A patient driver for physio would mean the world.",
        status: "waiting_coordinator",
        policyVersionId: secondVersion.id,
      })
      .returning({ id: ask.id });

    const rows = await t.client<
      { ask_id: string; version: number; threshold: number }[]
    >`
      SELECT a.id AS ask_id, p.version, p.call_threshold_hours AS threshold
        FROM ask a
        JOIN policy p ON p.id = a.policy_version_id
       ORDER BY p.version
    `;

    expect(rows).toHaveLength(2);
    expect(
      rows.find((row) => row.ask_id === firstAsk.id)?.version,
    ).toBe(1);
    expect(
      rows.find((row) => row.ask_id === firstAsk.id)?.threshold,
    ).toBe(48);
    expect(
      rows.find((row) => row.ask_id === secondAsk.id)?.version,
    ).toBe(2);
    expect(
      rows.find((row) => row.ask_id === secondAsk.id)?.threshold,
    ).toBe(72);
  });

  it("does not put an unsigned version in force", async () => {
    const unsigned = await createPolicyVersion(
      grace,
      { ...revisedPolicy, signedOffBy: null },
      t.db,
    );

    expect(unsigned.version).toBe(2);
    expect(unsigned.signedOffBy).toBeNull();
    expect(unsigned.signedOffAt).toBeNull();

    const inForce = await getPolicyInForce(seedIds.church, t.db);
    expect(inForce?.version).toBe(1);
  });

  it("gives the coordinator the crisis and referral content and withholds it from volunteers", async () => {
    const coordinator = await getPolicyForCoordinator(grace, t.db);
    expect(coordinator).toBeTruthy();
    expect(coordinator?.crisisScript).toBe(seedCrisisScript);
    expect(coordinator?.localCrisisLine).toBe(seedLocalCrisisLine);
    expect(coordinator?.referralResources.length).toBeGreaterThanOrEqual(3);

    const volunteer = await getVolunteerPolicyView(ruth, t.db);
    expect(volunteer).toBeTruthy();
    expect(Object.keys(volunteer!).sort()).toEqual([
      "familiarFaceDefault",
      "id",
      "safeguardingPromises",
      "version",
    ]);

    const serialized = JSON.stringify(volunteer);
    expect(serialized).not.toContain(seedCrisisScript);
    expect(serialized).not.toContain(seedLocalCrisisLine);
    expect(serialized).not.toContain("archrespite.org");
    expect(serialized).not.toContain("Suicide & Crisis Lifeline");
  });

  it("withholds crisis content from a caregiver payload too", async () => {
    const caregiver = await getVolunteerPolicyView(marta, t.db);
    expect(caregiver).toBeTruthy();
    expect(JSON.stringify(caregiver)).not.toContain(seedCrisisScript);
    expect(JSON.stringify(caregiver)).not.toContain(seedLocalCrisisLine);
  });

  it("refuses policy edits from a caregiver", async () => {
    await expect(
      createPolicyVersion(marta, revisedPolicy, t.db),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("refuses a new version that is missing one of the nine questions", async () => {
    await expect(
      createPolicyVersion(
        grace,
        { ...revisedPolicy, questionSet: seedQuestionSet.slice(0, 8) },
        t.db,
      ),
    ).rejects.toThrow(/Q9/);
  });
});

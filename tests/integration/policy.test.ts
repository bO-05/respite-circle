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
  listPolicyVersions,
  savePolicyVersion,
  POLICY_AUDIT_ACTIONS,
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
  callAfterOpenHours: 24,
  autoPublishLowRisk: false,
  signedOffBy: "Grace Whitfield",
};

/**
 * The save path the editor uses: a named sign-off is mandatory, and a change
 * that gives the church less notice before a person calls needs the typed
 * confirmation word. These tests speak to the repository directly; the E2E
 * spec drives the same path through the screen.
 */
const signedSave = {
  ...revisedPolicy,
  signedOffBy: "Grace Whitfield",
  authorName: "Grace Whitfield",
};

type PolicyAuditRow = {
  action: string;
  actor_id: string | null;
  detail: {
    version?: number;
    signedOffBy?: string;
    authorName?: string | null;
    loosenedThresholds?: string[];
    changes?: Array<{ field: string; previous: number; next: number }>;
  };
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

  it("VAL-POLICY-005 — seeds version 1 with every content field", async () => {
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

  it("VAL-POLICY-003 — records the policy version in force on every ask and decision", async () => {
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

describe("the policy editor's save path", () => {
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

  async function policyCount(): Promise<number> {
    const [row] = await t.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM policy
    `;
    return row?.count ?? 0;
  }

  async function auditFor(policyId: string): Promise<PolicyAuditRow[]> {
    return t.client<PolicyAuditRow[]>`
      SELECT action, actor_id, detail
        FROM audit_event
       WHERE entity = 'policy' AND entity_id = ${policyId}
       ORDER BY created_at, action
    `;
  }

  it("refuses a blank or missing named sign-off and writes nothing", async () => {
    for (const signedOffBy of ["", "   "]) {
      const result = await savePolicyVersion(
        grace,
        { ...signedSave, signedOffBy },
        t.db,
      );

      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe("signoff_required");
      expect(result.message).toMatch(/sign-off/i);
      expect(result.message).toMatch(/name/i);
    }

    expect(await policyCount()).toBe(1);
    const inForce = await getPolicyInForce(seedIds.church, t.db);
    expect(inForce?.version).toBe(1);
  });

  it("saves version 2 with a named sign-off, the author, and a timestamp", async () => {
    const editedPromise =
      "We review these promises with the church family every Advent.";
    const before = Date.now();

    const result = await savePolicyVersion(
      grace,
      {
        ...signedSave,
        safeguardingPromises: [...seedSafeguardingPromises, editedPromise],
      },
      t.db,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.policy.version).toBe(2);
    expect(result.policy.signedOffBy).toBe("Grace Whitfield");
    expect(result.policy.signedOffAt).toBeInstanceOf(Date);
    expect(result.policy.createdAt).toBeInstanceOf(Date);
    expect(result.policy.createdAt.getTime()).toBeGreaterThanOrEqual(
      before - 1_000,
    );
    expect(result.policy.safeguardingPromises).toContain(editedPromise);
    expect(result.loosened).toEqual([]);

    const [oldRow] = await t.client<
      { safeguarding_promises: string[]; crisis_script: string }[]
    >`
      SELECT safeguarding_promises, crisis_script
        FROM policy
       WHERE id = ${seedIds.policyV1}
    `;
    expect(oldRow.safeguarding_promises).toEqual(seedSafeguardingPromises);
    expect(oldRow.crisis_script).toBe(seedCrisisScript);

    const audits = await auditFor(result.policy.id);
    const saved = audits.find(
      (row) => row.action === POLICY_AUDIT_ACTIONS.saved,
    );
    expect(saved).toBeTruthy();
    expect(saved?.actor_id).toBe(seedIds.people.grace);
    expect(saved?.detail.version).toBe(2);
    expect(saved?.detail.signedOffBy).toBe("Grace Whitfield");
    expect(saved?.detail.authorName).toBe("Grace Whitfield");

    const versions = await listPolicyVersions(grace, t.db);
    expect(versions.map((row) => row.version)).toEqual([2, 1]);
    expect(versions[0].inForce).toBe(true);
    expect(versions[0].signedOffBy).toBe("Grace Whitfield");
    expect(versions[0].createdAt).toBeInstanceOf(Date);

    const inForce = await getPolicyInForce(seedIds.church, t.db);
    expect(inForce?.version).toBe(2);
  });

  it("refuses to loosen the window clock without the typed confirmation", async () => {
    const missing = await savePolicyVersion(
      grace,
      { ...signedSave, callThresholdHours: 24 },
      t.db,
    );

    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.code).toBe("confirmation_required");
    expect(missing.message).toMatch(/LOOSEN/);
    expect(missing.loosened.map((change) => change.field)).toEqual([
      "callThresholdHours",
    ]);

    const wrongWord = await savePolicyVersion(
      grace,
      {
        ...signedSave,
        callThresholdHours: 24,
        loosenConfirmation: "yes please",
      },
      t.db,
    );
    expect(wrongWord.ok).toBe(false);
    if (wrongWord.ok) return;
    expect(wrongWord.code).toBe("confirmation_required");

    expect(await policyCount()).toBe(1);
  });

  it("saves a loosened window clock with LOOSEN and flags it in the audit", async () => {
    const result = await savePolicyVersion(
      grace,
      {
        ...signedSave,
        callThresholdHours: 24,
        loosenConfirmation: " loosen ",
      },
      t.db,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.policy.callThresholdHours).toBe(24);
    expect(result.loosened.map((change) => change.field)).toEqual([
      "callThresholdHours",
    ]);

    const audits = await auditFor(result.policy.id);
    const flagged = audits.find(
      (row) => row.action === POLICY_AUDIT_ACTIONS.loosened,
    );
    expect(flagged).toBeTruthy();
    expect(flagged?.actor_id).toBe(seedIds.people.grace);
    expect(flagged?.detail.version).toBe(2);
    expect(flagged?.detail.loosenedThresholds).toContain(
      "callThresholdHours",
    );
    expect(flagged?.detail.changes?.[0]).toMatchObject({
      field: "callThresholdHours",
      previous: 48,
      next: 24,
    });
  });

  it("treats a later publication clock as a loosening too", async () => {
    const refused = await savePolicyVersion(
      grace,
      { ...signedSave, callAfterOpenHours: 48 },
      t.db,
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe("confirmation_required");
    expect(refused.loosened.map((change) => change.field)).toEqual([
      "callAfterOpenHours",
    ]);

    const saved = await savePolicyVersion(
      grace,
      {
        ...signedSave,
        callAfterOpenHours: 48,
        loosenConfirmation: "LOOSEN",
      },
      t.db,
    );

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.policy.callAfterOpenHours).toBe(48);

    const inForce = await getPolicyInForce(seedIds.church, t.db);
    expect(inForce?.callAfterOpenHours).toBe(48);

    const audits = await auditFor(saved.policy.id);
    const flagged = audits.find(
      (row) => row.action === POLICY_AUDIT_ACTIONS.loosened,
    );
    expect(flagged?.detail.loosenedThresholds).toContain(
      "callAfterOpenHours",
    );
  });

  it("saves a tighter clock without a confirmation and persists both values", async () => {
    const result = await savePolicyVersion(
      grace,
      {
        ...signedSave,
        callThresholdHours: 72,
        callAfterOpenHours: 8,
      },
      t.db,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loosened).toEqual([]);
    expect(result.policy.callThresholdHours).toBe(72);
    expect(result.policy.callAfterOpenHours).toBe(8);

    const audits = await auditFor(result.policy.id);
    expect(
      audits.some((row) => row.action === POLICY_AUDIT_ACTIONS.loosened),
    ).toBe(false);

    const [row] = await t.client<
      { call_threshold_hours: number; call_after_open_hours: number }[]
    >`
      SELECT call_threshold_hours, call_after_open_hours
        FROM policy
       WHERE id = ${result.policy.id}
    `;
    expect(row.call_threshold_hours).toBe(72);
    expect(row.call_after_open_hours).toBe(8);
  });

  it("refuses the save path to a caregiver and a volunteer", async () => {
    await expect(
      savePolicyVersion(marta, signedSave, t.db),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      savePolicyVersion(ruth, signedSave, t.db),
    ).rejects.toBeInstanceOf(AuthError);

    expect(await policyCount()).toBe(1);
  });

  it("refuses incomplete content before writing a version", async () => {
    const result = await savePolicyVersion(
      grace,
      {
        ...signedSave,
        questionSet: seedQuestionSet.slice(0, 8),
      },
      t.db,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_content");
    expect(result.errors.join("\n")).toMatch(/Q9/);
    expect(await policyCount()).toBe(1);
  });
});

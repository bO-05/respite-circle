import { describe, expect, it } from "vitest";
import {
  REQUIRED_QUESTION_IDS,
  isPolicyInForce,
  nextPolicyVersion,
  toPublicPolicyView,
  toVolunteerPolicyView,
  validatePolicyContent,
  validateQuestionSet,
  type PolicyContent,
} from "@/server/domain/policy";
import {
  seedCrisisScript,
  seedIds,
  seedLocalCrisisLine,
  seedPolicy,
  seedQuestionSet,
  seedReferralResources,
  seedSafeguardingPromises,
} from "@/db/seed-data";

const seededPolicy: PolicyContent = {
  id: seedIds.policyV1,
  churchId: seedIds.church,
  version: seedPolicy.version,
  safeguardingPromises: [...seedSafeguardingPromises],
  questionSet: seedQuestionSet.map((question) => ({ ...question })),
  crisisScript: seedCrisisScript,
  localCrisisLine: seedLocalCrisisLine,
  referralResources: seedReferralResources.map((resource) => ({
    ...resource,
  })),
  familiarFaceDefault: seedPolicy.familiarFaceDefault,
  reminderWindowHours: seedPolicy.reminderWindowHours,
  callThresholdHours: seedPolicy.callThresholdHours,
  autoPublishLowRisk: seedPolicy.autoPublishLowRisk,
  signedOffBy: seedPolicy.signedOffBy,
  signedOffAt: seedPolicy.signedOffAt,
  createdAt: new Date("2026-11-15T15:00:00.000Z"),
};

describe("the nine typed policy questions", () => {
  it("seeds Q1 through Q9 in order, each with text and a type", () => {
    expect(seedQuestionSet.map((question) => question.id)).toEqual([
      ...REQUIRED_QUESTION_IDS,
    ]);

    for (const question of seedQuestionSet) {
      expect(question.text.trim().length).toBeGreaterThan(0);
      expect(["yesno", "pick"]).toContain(question.answerType);
    }
  });

  it("keeps the pick questions as closed option lists", () => {
    const pickQuestions = seedQuestionSet.filter(
      (question) => question.answerType === "pick",
    );
    expect(pickQuestions.map((question) => question.id)).toEqual(["Q4", "Q7"]);

    for (const question of pickQuestions) {
      expect(question.options?.length ?? 0).toBeGreaterThanOrEqual(2);
      for (const option of question.options ?? []) {
        expect(option.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("samples the safety and personal-care questions three times", () => {
    const samples = Object.fromEntries(
      seedQuestionSet.map((question) => [question.id, question.samples]),
    );
    expect(samples.Q5).toBe(3);
    expect(samples.Q9).toBe(3);
  });

  it("accepts the seeded question set", () => {
    expect(validateQuestionSet(seedQuestionSet)).toEqual([]);
  });

  it("rejects a missing question", () => {
    const errors = validateQuestionSet(seedQuestionSet.slice(0, 8));
    expect(errors.join("\n")).toMatch(/nine/i);
    expect(errors.join("\n")).toMatch(/Q9/);
  });

  it("rejects a duplicated question id", () => {
    const duplicated = seedQuestionSet.map((question) =>
      question.id === "Q9" ? { ...question, id: "Q1" } : question,
    );
    expect(validateQuestionSet(duplicated).join("\n")).toMatch(/duplicate/i);
  });

  it("rejects a pick question with no options", () => {
    const broken = seedQuestionSet.map((question) =>
      question.id === "Q4" ? { ...question, options: [] } : question,
    );
    expect(validateQuestionSet(broken).join("\n")).toMatch(/options/i);
  });

  it("rejects an empty question text", () => {
    const broken = seedQuestionSet.map((question) =>
      question.id === "Q6" ? { ...question, text: "   " } : question,
    );
    expect(validateQuestionSet(broken).join("\n")).toMatch(/text/i);
  });
});

describe("the seeded safeguarding promises", () => {
  const promises = seedSafeguardingPromises.join("\n");

  it("contains all six approved promises", () => {
    expect(seedSafeguardingPromises).toHaveLength(6);
    for (const promise of seedSafeguardingPromises) {
      expect(promise.trim().length).toBeGreaterThan(20);
    }
  });

  it("names dementia-awareness training before a first morning", () => {
    expect(promises).toMatch(/dementia-awareness training/i);
    expect(promises).toMatch(/before their first morning/i);
  });

  it("requires a familiar face or the church safeguarding checklist", () => {
    expect(promises).toMatch(/familiar-faces list/i);
    expect(promises).toMatch(/safeguarding checklist/i);
    expect(promises).toMatch(/two references/i);
  });

  it("requires a two-person first home visit", () => {
    expect(promises).toMatch(/first home visit is two people/i);
    expect(promises).toMatch(/introduced by the coordinator/i);
  });

  it("rules out personal care in plain words", () => {
    expect(promises).toMatch(/no personal care, ever/i);
    expect(promises).toMatch(/no medication/i);
    expect(promises).toMatch(/no bathing/i);
    expect(promises).toMatch(/no toileting/i);
    expect(promises).toMatch(/no lifting or transfers/i);
  });

  it("requires check-in and check-out with the coordinator", () => {
    expect(promises).toMatch(/check in and out with the coordinator/i);
  });

  it("sends nothing when a slot goes unclaimed and has a person call", () => {
    expect(promises).toMatch(/if a slot goes unclaimed/i);
    expect(promises).toMatch(/coordinator calls the caregiver personally/i);
    expect(promises).toMatch(/software sends nothing/i);
  });
});

describe("policy content validation", () => {
  it("accepts the seeded content", () => {
    expect(validatePolicyContent(seededPolicy)).toEqual([]);
  });

  it("rejects empty promises", () => {
    expect(
      validatePolicyContent({ ...seededPolicy, safeguardingPromises: [] }).join(
        "\n",
      ),
    ).toMatch(/promise/i);
  });

  it("rejects an empty crisis script", () => {
    expect(
      validatePolicyContent({ ...seededPolicy, crisisScript: "   " }).join("\n"),
    ).toMatch(/crisis script/i);
  });

  it("rejects empty referral resources", () => {
    expect(
      validatePolicyContent({ ...seededPolicy, referralResources: [] }).join(
        "\n",
      ),
    ).toMatch(/referral/i);
  });

  it("rejects non-positive reminder and call thresholds", () => {
    const errors = validatePolicyContent({
      ...seededPolicy,
      reminderWindowHours: 0,
      callThresholdHours: -1,
    }).join("\n");
    expect(errors).toMatch(/reminder window/i);
    expect(errors).toMatch(/call threshold/i);
  });
});

describe("who may see crisis and referral content", () => {
  it("keeps the crisis script, local line, and referrals on the full record", () => {
    expect(seededPolicy.crisisScript).toMatch(/988/);
    expect(seededPolicy.crisisScript).toMatch(/911/);
    expect(seededPolicy.localCrisisLine).toBeTruthy();
    expect(
      seededPolicy.referralResources.map((resource) => resource.name).join(" "),
    ).toMatch(/ARCH/);
    expect(
      seededPolicy.referralResources.map((resource) => resource.name).join(" "),
    ).toMatch(/Area Agency on Aging/);
    expect(
      seededPolicy.referralResources.map((resource) => resource.name).join(" "),
    ).toMatch(/988/);
  });

  it("drops crisis and referral content from the volunteer payload", () => {
    const view = toVolunteerPolicyView(seededPolicy);

    expect(Object.keys(view).sort()).toEqual([
      "familiarFaceDefault",
      "id",
      "safeguardingPromises",
      "version",
    ]);

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(seedCrisisScript);
    expect(serialized).not.toContain(seedLocalCrisisLine);
    expect(serialized).not.toContain("archrespite.org");
    expect(serialized).not.toContain("Suicide & Crisis Lifeline");
    expect(view).not.toHaveProperty("crisisScript");
    expect(view).not.toHaveProperty("referralResources");
    expect(view).not.toHaveProperty("localCrisisLine");
  });

  it("publishes promises only for a signed version", () => {
    const published = toPublicPolicyView(seededPolicy);
    expect(published).not.toBeNull();
    expect(published?.version).toBe(1);
    expect(published?.safeguardingPromises).toEqual(seedSafeguardingPromises);
    expect(published?.signedOffBy).toBe("Grace Whitfield");
    expect(published).not.toHaveProperty("crisisScript");
    expect(published).not.toHaveProperty("referralResources");
    expect(published).not.toHaveProperty("localCrisisLine");

    expect(
      toPublicPolicyView({ ...seededPolicy, signedOffBy: null }),
    ).toBeNull();
    expect(toPublicPolicyView({ ...seededPolicy, signedOffBy: "   " })).toBeNull();
  });
});

describe("policy version bookkeeping", () => {
  it("requires a named sign-off before a version is in force", () => {
    expect(isPolicyInForce(seededPolicy)).toBe(true);
    expect(isPolicyInForce({ ...seededPolicy, signedOffBy: null })).toBe(false);
    expect(isPolicyInForce({ ...seededPolicy, signedOffBy: "  " })).toBe(false);
    expect(isPolicyInForce({ ...seededPolicy, signedOffAt: null })).toBe(false);
  });

  it("always allocates the next version number", () => {
    expect(nextPolicyVersion([])).toBe(1);
    expect(nextPolicyVersion([1])).toBe(2);
    expect(nextPolicyVersion([1, 2, 3])).toBe(4);
    expect(nextPolicyVersion([3, 1, 2])).toBe(4);
  });

  it("does not let the seed accidentally turn auto-publish on", () => {
    expect(seedPolicy.autoPublishLowRisk).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  POLICY_LOOSEN_CONFIRMATION,
  validatePolicyContent,
  type PolicyContent,
} from "@/server/domain/policy";
import {
  buildPolicyEditorRequest,
  type PolicyEditorSubmission,
} from "@/server/domain/policy-editor";
import {
  callAfterOpenHoursFromPolicy,
  callThresholdHoursFromPolicy,
  DEFAULT_CALL_AFTER_OPEN_HOURS,
  DEFAULT_CALL_THRESHOLD_HOURS,
} from "@/server/domain/coverage";
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
  callAfterOpenHours: seedPolicy.callAfterOpenHours,
  transportEnabled: seedPolicy.transportEnabled,
  autoPublishLowRisk: seedPolicy.autoPublishLowRisk,
  signedOffBy: seedPolicy.signedOffBy,
  signedOffAt: seedPolicy.signedOffAt,
  createdAt: new Date("2026-11-15T15:00:00.000Z"),
};

function submission(
  overrides: Partial<PolicyEditorSubmission> = {},
): PolicyEditorSubmission {
  return {
    promises: [...seedSafeguardingPromises],
    questionTexts: Object.fromEntries(
      seedQuestionSet.map((question) => [question.id, question.text]),
    ),
    crisisScript: seedCrisisScript,
    localCrisisLine: seedLocalCrisisLine,
    referrals: seedReferralResources.map((resource) => ({
      name: resource.name,
      detail: resource.detail,
      phone: resource.phone ?? "",
      url: resource.url ?? "",
    })),
    reminderWindowHours: String(seedPolicy.reminderWindowHours),
    callThresholdHours: String(seedPolicy.callThresholdHours),
    callAfterOpenHours: String(seedPolicy.callAfterOpenHours),
    signedOffBy: "Grace Whitfield",
    loosenConfirmation: "",
    ...overrides,
  };
}

describe("the two safeguarding clocks", () => {
  it("falls back to the published defaults when a row predates the clock", () => {
    expect(callAfterOpenHoursFromPolicy(undefined)).toBe(
      DEFAULT_CALL_AFTER_OPEN_HOURS,
    );
    expect(callAfterOpenHoursFromPolicy(null)).toBe(
      DEFAULT_CALL_AFTER_OPEN_HOURS,
    );
    expect(callAfterOpenHoursFromPolicy(0)).toBe(
      DEFAULT_CALL_AFTER_OPEN_HOURS,
    );
    expect(callAfterOpenHoursFromPolicy(Number.NaN)).toBe(
      DEFAULT_CALL_AFTER_OPEN_HOURS,
    );
    expect(callAfterOpenHoursFromPolicy(6)).toBe(6);
    expect(callAfterOpenHoursFromPolicy(72)).toBe(72);

    expect(callThresholdHoursFromPolicy(undefined)).toBe(
      DEFAULT_CALL_THRESHOLD_HOURS,
    );
    expect(callThresholdHoursFromPolicy(-4)).toBe(
      DEFAULT_CALL_THRESHOLD_HOURS,
    );
    expect(callThresholdHoursFromPolicy(12)).toBe(12);
  });

  it("defaults the publication clock to 24 hours and the seeded value matches", () => {
    expect(DEFAULT_CALL_AFTER_OPEN_HOURS).toBe(24);
    expect(seedPolicy.callAfterOpenHours).toBe(DEFAULT_CALL_AFTER_OPEN_HOURS);
    expect(seedPolicy.callThresholdHours).toBe(DEFAULT_CALL_THRESHOLD_HOURS);
  });

  it("requires a positive whole number for the publication clock", () => {
    expect(
      validatePolicyContent({ ...seededPolicy, callAfterOpenHours: 0 }).join(
        "\n",
      ),
    ).toMatch(/call[- ]after/i);
    expect(
      validatePolicyContent({ ...seededPolicy, callAfterOpenHours: 1.5 }).join(
        "\n",
      ),
    ).toMatch(/call[- ]after/i);
  });
});

describe("building a policy save from the editor", () => {
  it("accepts the seeded content and keeps the fields this screen does not edit", () => {
    const built = buildPolicyEditorRequest(submission(), seededPolicy);

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.request.safeguardingPromises).toEqual(
      seedSafeguardingPromises,
    );
    expect(built.request.questionSet.map((question) => question.id)).toEqual(
      seedQuestionSet.map((question) => question.id),
    );
    expect(built.request.questionSet[0].text).toBe(seedQuestionSet[0].text);
    expect(built.request.questionSet[0].options).toEqual(
      seedQuestionSet[0].options,
    );
    expect(built.request.callThresholdHours).toBe(48);
    expect(built.request.callAfterOpenHours).toBe(24);
    expect(built.request.signedOffBy).toBe("Grace Whitfield");
    expect(built.request.familiarFaceDefault).toBe(
      seededPolicy.familiarFaceDefault,
    );
    expect(built.request.autoPublishLowRisk).toBe(
      seededPolicy.autoPublishLowRisk,
    );
    expect(built.request.transportEnabled).toBe(
      seededPolicy.transportEnabled,
    );
    expect(built.clockChanges).toEqual([]);
    expect(built.loosened).toEqual([]);
  });

  it("trims typed content and drops blank promises and referral rows", () => {
    const built = buildPolicyEditorRequest(
      submission({
        promises: ["  A promise kept.  ", "   ", "Another promise."],
        referrals: [
          { name: "  ARCH  ", detail: "  Respite referrals.  ", phone: "", url: "" },
          { name: "", detail: "", phone: "", url: "" },
          { name: "  Local line  ", detail: "  Call anytime.  ", phone: " 555-0100 ", url: "" },
        ],
      }),
      seededPolicy,
    );

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.request.safeguardingPromises).toEqual([
      "A promise kept.",
      "Another promise.",
    ]);
    expect(built.request.referralResources).toEqual([
      { name: "ARCH", detail: "Respite referrals." },
      { name: "Local line", detail: "Call anytime.", phone: "555-0100" },
    ]);
  });

  it("replaces question text without changing ids, types, options, or samples", () => {
    const built = buildPolicyEditorRequest(
      submission({
        questionTexts: {
          ...submission().questionTexts,
          Q1: "  Is company needed this week?  ",
        },
      }),
      seededPolicy,
    );

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const q1 = built.request.questionSet.find(
      (question) => question.id === "Q1",
    );
    expect(q1?.text).toBe("Is company needed this week?");
    expect(q1?.key).toBe("sit");
    expect(q1?.answerType).toBe("yesno");

    const q4 = built.request.questionSet.find(
      (question) => question.id === "Q4",
    );
    expect(q4?.options).toEqual(seedQuestionSet[3].options);
  });

  it("rejects a blank named sign-off", () => {
    const built = buildPolicyEditorRequest(
      submission({ signedOffBy: "   " }),
      seededPolicy,
    );

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.join("\n")).toMatch(/sign-off/i);
    expect(built.errors.join("\n")).toMatch(/name/i);
  });

  it("rejects a clock that is not a whole number of hours", () => {
    const built = buildPolicyEditorRequest(
      submission({ callAfterOpenHours: "24.5" }),
      seededPolicy,
    );

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.join("\n")).toMatch(/call[- ]after/i);

    const negative = buildPolicyEditorRequest(
      submission({ callThresholdHours: "-2" }),
      seededPolicy,
    );
    expect(negative.ok).toBe(false);
    if (negative.ok) return;
    expect(negative.errors.join("\n")).toMatch(/call threshold/i);
  });

  it("names a loosened window clock and a loosened publication clock", () => {
    const looser = buildPolicyEditorRequest(
      submission({ callThresholdHours: "24", callAfterOpenHours: "48" }),
      seededPolicy,
    );

    expect(looser.ok).toBe(true);
    if (!looser.ok) return;
    expect(looser.loosened.map((change) => change.field).sort()).toEqual([
      "callAfterOpenHours",
      "callThresholdHours",
    ]);
    for (const change of looser.loosened) {
      expect(change.direction).toBe("looser");
      expect(change.previous).not.toBe(change.next);
    }
  });

  it("does not call a tighter clock a loosening", () => {
    const tighter = buildPolicyEditorRequest(
      submission({ callThresholdHours: "72", callAfterOpenHours: "12" }),
      seededPolicy,
    );

    expect(tighter.ok).toBe(true);
    if (!tighter.ok) return;
    expect(tighter.loosened).toEqual([]);
    expect(tighter.clockChanges.map((change) => change.direction).sort()).toEqual(
      ["tighter", "tighter"],
    );
  });

  it("names the typed confirmation word LOOSEN", () => {
    expect(POLICY_LOOSEN_CONFIRMATION).toBe("LOOSEN");
  });
});

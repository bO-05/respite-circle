import { describe, expect, it } from "vitest";
import {
  CHECKLIST_VALID_MONTHS,
  RULE_CODE_COPY,
  canClaim,
  type CandidateOwner,
  type CandidateVerdict,
  type GatingContext,
  type GatingPolicy,
  type GatingSlot,
  type RuleCode,
  type VolunteerGatingFacts,
} from "@/server/domain/gating";

/**
 * The volunteer gate, as pure code.
 *
 * One active volunteer is compared with one draft time. The result is exactly
 * four fields — eligible, a rule code, a fix hint, and an owner — never a score
 * or a rank. The same function is used to write `slot_candidate` rows and to
 * render the coordinator's "why not proposed" panel, so the explanation and the
 * decision can never drift apart.
 */

const TIME_ZONE = "America/New_York";
// Sunday 22 November 2026, 10:00 in New York.
const NOW = new Date("2026-11-22T15:00:00.000Z");

const CONTEXT: GatingContext = { now: NOW, timeZone: TIME_ZONE };

const NO_DRIVER_POLICY: GatingPolicy = { transportEnabled: false };
const DRIVER_POLICY: GatingPolicy = { transportEnabled: true };

function volunteer(
  overrides: Partial<VolunteerGatingFacts> = {},
): VolunteerGatingFacts {
  return {
    personId: crypto.randomUUID(),
    firstName: "Ruth",
    checklistCompletedAt: new Date("2026-10-06T14:00:00.000Z"),
    referencesContacted: 2,
    trainingExpiresOn: "2027-06-30",
    backgroundRenewsOn: "2027-03-15",
    driverOk: true,
    familiarForRecipient: false,
    servingThatDay: 0,
    windowOverlapsCommitment: false,
    isCaregiverForRecipient: false,
    ...overrides,
  };
}

function slot(overrides: Partial<GatingSlot> = {}): GatingSlot {
  return {
    kind: "companion",
    tier: "public_event",
    gated: false,
    windowStart: new Date("2026-11-24T15:00:00.000Z"),
    windowEnd: new Date("2026-11-24T19:00:00.000Z"),
    ...overrides,
  };
}

function homeSlot(): GatingSlot {
  return slot({
    kind: "home",
    tier: "in_home",
    gated: true,
    windowStart: new Date("2026-11-28T15:00:00.000Z"),
    windowEnd: new Date("2026-11-28T17:00:00.000Z"),
  });
}

function driveSlot(): GatingSlot {
  return slot({
    kind: "drive",
    tier: "transport",
    gated: true,
    windowStart: new Date("2026-11-24T13:00:00.000Z"),
    windowEnd: new Date("2026-11-24T15:00:00.000Z"),
  });
}

function verdict(
  facts: VolunteerGatingFacts,
  draft: GatingSlot,
  policy: GatingPolicy = NO_DRIVER_POLICY,
  context: GatingContext = CONTEXT,
): CandidateVerdict {
  return canClaim(facts, draft, policy, context);
}

const REQUIRED_REASONS: RuleCode[] = [
  "no_checklist",
  "checklist_expired",
  "not_familiar",
  "unavailable_window",
  "already_serving_twice",
  "no_driver_policy",
  "driver_not_ok",
];

describe("canClaim — public and doorstep times", () => {
  it("lets any active volunteer take a companion place, with no checklist", () => {
    const result = verdict(
      volunteer({
        checklistCompletedAt: null,
        referencesContacted: 0,
        familiarForRecipient: false,
      }),
      slot(),
    );

    expect(result).toEqual({
      eligible: true,
      ruleCode: "eligible",
      fixHint: null,
      owner: null,
    });
  });

  it("lets any active volunteer take a meal, with no checklist", () => {
    const result = verdict(
      volunteer({
        checklistCompletedAt: null,
        referencesContacted: 0,
        driverOk: false,
      }),
      slot({ kind: "meal", tier: "doorstep", gated: false }),
    );

    expect(result.eligible).toBe(true);
    expect(result.ruleCode).toBe("eligible");
  });

  it("never returns a score or a rank", () => {
    const result = verdict(volunteer(), slot());
    expect(Object.keys(result).sort()).toEqual([
      "eligible",
      "fixHint",
      "owner",
      "ruleCode",
    ]);
  });
});

describe("canClaim — the in-home gate", () => {
  it("allows a familiar face without a checklist", () => {
    const result = verdict(
      volunteer({
        familiarForRecipient: true,
        checklistCompletedAt: null,
        referencesContacted: 0,
      }),
      homeSlot(),
    );

    expect(result.eligible).toBe(true);
    expect(result.ruleCode).toBe("eligible");
  });

  it("allows the checklist-only path when the checklist, references, training, and background are current", () => {
    const result = verdict(
      volunteer({
        familiarForRecipient: false,
        checklistCompletedAt: new Date("2026-09-22T14:00:00.000Z"),
        referencesContacted: 2,
        trainingExpiresOn: "2027-04-30",
        backgroundRenewsOn: "2027-01-20",
      }),
      homeSlot(),
    );

    expect(result.eligible).toBe(true);
  });

  it("names 'not a familiar face' when the volunteer knows nobody and has not started a checklist", () => {
    const result = verdict(
      volunteer({
        firstName: "Tom",
        familiarForRecipient: false,
        checklistCompletedAt: null,
        referencesContacted: 0,
      }),
      homeSlot(),
    );

    expect(result.eligible).toBe(false);
    expect(result.ruleCode).toBe("not_familiar");
    expect(result.fixHint).toMatch(/familiar face/i);
    expect(result.fixHint).toMatch(/checklist/i);
    expect(result.owner).toBe("coordinator");
  });

  it("names the missing checklist when references are already recorded", () => {
    const result = verdict(
      volunteer({
        familiarForRecipient: false,
        checklistCompletedAt: null,
        referencesContacted: 1,
      }),
      homeSlot(),
    );

    expect(result.eligible).toBe(false);
    expect(result.ruleCode).toBe("no_checklist");
    expect(result.fixHint).toMatch(/one of two references|1 of 2/i);
    expect(result.owner).toBe("coordinator");
  });

  it("names no checklist when the checklist is present but a second reference is missing", () => {
    const result = verdict(
      volunteer({
        familiarForRecipient: false,
        checklistCompletedAt: new Date("2026-09-22T14:00:00.000Z"),
        referencesContacted: 1,
      }),
      homeSlot(),
    );

    expect(result.eligible).toBe(false);
    expect(result.ruleCode).toBe("no_checklist");
    expect(result.fixHint).toMatch(/second reference|2 of 2/i);
    expect(result.owner).toBe("coordinator");
  });

  it("names an expired checklist when it was completed more than twelve months ago", () => {
    const result = verdict(
      volunteer({
        familiarForRecipient: false,
        checklistCompletedAt: new Date("2024-05-01T14:00:00.000Z"),
      }),
      homeSlot(),
    );

    expect(result.eligible).toBe(false);
    expect(result.ruleCode).toBe("checklist_expired");
    expect(result.fixHint).toMatch(/May 2024/);
    expect(result.owner).toBe("coordinator");
    expect(CHECKLIST_VALID_MONTHS).toBe(12);
  });

  it("names an expired checklist when safeguarding training has lapsed", () => {
    const result = verdict(
      volunteer({
        familiarForRecipient: false,
        trainingExpiresOn: "2026-09-30",
      }),
      homeSlot(),
    );

    expect(result.eligible).toBe(false);
    expect(result.ruleCode).toBe("checklist_expired");
    expect(result.fixHint).toMatch(/training/i);
    expect(result.fixHint).toMatch(/30 September 2026/);
  });

  it("names an expired checklist when the background check has lapsed", () => {
    const result = verdict(
      volunteer({
        familiarForRecipient: false,
        backgroundRenewsOn: "2026-10-01",
      }),
      homeSlot(),
    );

    expect(result.eligible).toBe(false);
    expect(result.ruleCode).toBe("checklist_expired");
    expect(result.fixHint).toMatch(/background/i);
    expect(result.fixHint).toMatch(/1 October 2026/);
  });

  it("treats a missing training or background date as not yet recorded", () => {
    const result = verdict(
      volunteer({
        familiarForRecipient: false,
        trainingExpiresOn: null,
      }),
      homeSlot(),
    );

    expect(result.ruleCode).toBe("no_checklist");
    expect(result.fixHint).toMatch(/training/i);
  });

  it("refuses the family's own caregiver for that recipient", () => {
    const result = verdict(
      volunteer({ isCaregiverForRecipient: true }),
      homeSlot(),
    );

    expect(result.ruleCode).toBe("recipient_not_eligible");
    expect(result.owner).toBe("coordinator");
    expect(result.fixHint).toMatch(/family|caregiver/i);
  });
});

describe("canClaim — drives", () => {
  it("blocks every drive while the church has not signed its driver policy", () => {
    const result = verdict(volunteer(), driveSlot(), NO_DRIVER_POLICY);

    expect(result.eligible).toBe(false);
    expect(result.ruleCode).toBe("no_driver_policy");
    expect(result.owner).toBe("church");
    expect(result.fixHint).toMatch(/volunteer-driver policy/i);
  });

  it("blocks a drive when the driver record is not in place", () => {
    const result = verdict(
      volunteer({ driverOk: false }),
      driveSlot(),
      DRIVER_POLICY,
    );

    expect(result.eligible).toBe(false);
    expect(result.ruleCode).toBe("driver_not_ok");
    expect(result.owner).toBe("coordinator");
    expect(result.fixHint).toMatch(/licence|insurance/i);
  });

  it("allows a drive when the policy is signed and the driver record is current", () => {
    const result = verdict(volunteer({ driverOk: true }), driveSlot(), DRIVER_POLICY);
    expect(result.eligible).toBe(true);
  });
});

describe("canClaim — time and load", () => {
  it("names a window that overlaps a place the volunteer already holds", () => {
    const result = verdict(
      volunteer({
        familiarForRecipient: true,
        servingThatDay: 1,
        windowOverlapsCommitment: true,
      }),
      homeSlot(),
    );

    expect(result.ruleCode).toBe("unavailable_window");
    expect(result.fixHint).toMatch(/overlap|already serving/i);
    expect(result.owner).toBe("coordinator");
  });

  it("names the second place when the volunteer already holds two that day", () => {
    const result = verdict(
      volunteer({
        familiarForRecipient: true,
        servingThatDay: 2,
        windowOverlapsCommitment: false,
      }),
      homeSlot(),
    );

    expect(result.ruleCode).toBe("already_serving_twice");
    expect(result.fixHint).toMatch(/twice/i);
    expect(result.fixHint).toMatch(/Saturday 28 November 2026/);
    expect(result.owner).toBe("coordinator");
  });

  it("lets one place on the same day through", () => {
    const result = verdict(
      volunteer({ familiarForRecipient: true, servingThatDay: 1 }),
      homeSlot(),
    );

    expect(result.eligible).toBe(true);
  });
});

describe("rule copy", () => {
  it("gives every reason a human title, a fix, and an owner", () => {
    for (const code of REQUIRED_REASONS) {
      const copy = RULE_CODE_COPY[code];
      expect(copy.title.length).toBeGreaterThan(3);
      expect(copy.fix).not.toBeNull();
      expect((copy.fix ?? "").length).toBeGreaterThan(20);
      expect(copy.owner).not.toBeNull();
    }
  });

  it("marks the eligible code as needing no fix and no owner", () => {
    expect(RULE_CODE_COPY.eligible.owner).toBeNull();
    expect(RULE_CODE_COPY.eligible.fix).toBeNull();
  });

  it("names a human owner for every block, never a score", () => {
    const owners = new Set<CandidateOwner>();
    for (const copy of Object.values(RULE_CODE_COPY)) {
      if (copy.owner) owners.add(copy.owner);
    }
    expect([...owners].sort()).toEqual(["church", "coordinator"]);
  });
});

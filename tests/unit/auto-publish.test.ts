import { describe, expect, it } from "vitest";
import {
  AUTO_PUBLISHED_VIA,
  AUTO_PUBLISH_BOARD_LABEL,
  AUTO_PUBLISH_DESK_LABEL,
  AUTO_PUBLISH_KINDS,
  AUTO_PUBLISH_RULES_COPY,
  autoPublishDecision,
  autoPublishRefusalCopy,
  isAutoPublishKind,
  type AutoPublishPolicyFacts,
} from "@/server/domain/auto-publish";
import { seedPolicy } from "@/db/seed-data";

/**
 * The low-risk switch is the only path that may publish a time without a
 * coordinator approving that time. These are the pure rules the database, the
 * construction service, the board, and the trust pages all speak from.
 */

const SIGNED_ON: AutoPublishPolicyFacts = {
  version: 2,
  autoPublishLowRisk: true,
  signedOffBy: "Eli Low",
  signedOffAt: new Date("2026-11-20T15:00:00.000Z"),
};

const SIGNED_OFF: AutoPublishPolicyFacts = {
  ...SIGNED_ON,
  autoPublishLowRisk: false,
};

const UNSIGNED_ON: AutoPublishPolicyFacts = {
  ...SIGNED_ON,
  signedOffBy: null,
  signedOffAt: null,
};

describe("the low-risk auto-publish setting", () => {
  it("covers exactly a meal and an errand, and nothing else", () => {
    expect([...AUTO_PUBLISH_KINDS]).toEqual(["meal", "errand"]);
    expect(isAutoPublishKind("meal")).toBe(true);
    expect(isAutoPublishKind("errand")).toBe(true);
    expect(isAutoPublishKind("companion")).toBe(false);
    expect(isAutoPublishKind("home")).toBe(false);
    expect(isAutoPublishKind("drive")).toBe(false);
    expect(isAutoPublishKind("something-else")).toBe(false);
    expect(AUTO_PUBLISHED_VIA).toBe("auto_low_risk");
  });

  it("is off by default in the seeded policy", () => {
    expect(seedPolicy.autoPublishLowRisk).toBe(false);
  });

  it("refuses every kind while the switch is off", () => {
    for (const kind of ["meal", "errand", "companion", "home", "drive"]) {
      const decision = autoPublishDecision(SIGNED_OFF, kind);
      expect(decision.publish).toBe(false);
      if (decision.publish) return;
      expect(decision.reason).toBe("switch_off");
      expect(decision.message).toMatch(/waits for a coordinator/i);
    }
  });

  it("refuses a meal or an errand while the policy version is unsigned", () => {
    for (const kind of ["meal", "errand"]) {
      const decision = autoPublishDecision(UNSIGNED_ON, kind);
      expect(decision.publish).toBe(false);
      if (decision.publish) return;
      expect(decision.reason).toBe("policy_unsigned");
      expect(decision.message).toMatch(/not signed/i);
    }
  });

  it("publishes a meal and an errand under a signed policy that turns it on", () => {
    expect(autoPublishDecision(SIGNED_ON, "meal")).toEqual({
      publish: true,
      kind: "meal",
    });
    expect(autoPublishDecision(SIGNED_ON, "errand")).toEqual({
      publish: true,
      kind: "errand",
    });
  });

  it("refuses a companion place, a home visit, and a drive with a reason", () => {
    for (const kind of ["companion", "home", "drive"]) {
      const decision = autoPublishDecision(SIGNED_ON, kind);
      expect(decision.publish).toBe(false);
      if (decision.publish) return;
      expect(decision.reason).toBe("not_low_risk");
      expect(decision.message).toMatch(/meal or an errand/i);
      expect(decision.message).toMatch(/coordinator/i);
    }

    expect(autoPublishRefusalCopy("companion")).toMatch(/companion place/i);
    expect(autoPublishRefusalCopy("home")).toMatch(/in-home visit/i);
    expect(autoPublishRefusalCopy("drive")).toMatch(/drive/i);
    expect(autoPublishRefusalCopy("companion")).toMatch(
      /only a meal or an errand/i,
    );
  });

  it("carries the same limit in the copy a coordinator and a neighbour read", () => {
    expect(AUTO_PUBLISH_RULES_COPY).toMatch(/meal or an errand/i);
    expect(AUTO_PUBLISH_RULES_COPY).toMatch(/companion place/i);
    expect(AUTO_PUBLISH_RULES_COPY).toMatch(/drive/i);
    expect(AUTO_PUBLISH_RULES_COPY).toMatch(/in-home visit/i);
    expect(AUTO_PUBLISH_RULES_COPY).toMatch(/decision log/i);
    expect(AUTO_PUBLISH_BOARD_LABEL).toMatch(/automatically/i);
    expect(AUTO_PUBLISH_BOARD_LABEL).toMatch(/meal or an errand/i);
    expect(AUTO_PUBLISH_DESK_LABEL).toMatch(/auto-published/i);
    expect(AUTO_PUBLISH_DESK_LABEL).toMatch(/decision log/i);
  });
});

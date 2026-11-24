import { describe, expect, it } from "vitest";
import {
  demoStructureAllows,
  isDemoLiveAiEnabled,
  type DemoAskRole,
} from "@/server/services/demo-decisions";

/**
 * VAL-AUDITFIX-015 — the demo reset's live-model switch.
 *
 * Two pure decisions carry the whole feature: when to call the provider, and
 * when a model answer may keep the demo's prepared structure. Both are tested
 * here without a database or a network.
 */

describe("RC_DEMO_LIVE_AI", () => {
  it.each(["1", "true", "TRUE", " True "])(
    "turns the live run on for %s",
    (value) => {
      expect(isDemoLiveAiEnabled({ RC_DEMO_LIVE_AI: value })).toBe(true);
    },
  );

  it.each([undefined, "", "0", "false", "yes", "off"])(
    "leaves the reset on the rules engine for %s",
    (value) => {
      const env = value === undefined ? {} : { RC_DEMO_LIVE_AI: value };
      expect(isDemoLiveAiEnabled(env)).toBe(false);
    },
  );
});

describe("the demo's structural guard", () => {
  const slotted: DemoAskRole = "slotted";
  const queued: DemoAskRole = "queued";
  const held: DemoAskRole = "held";

  const waiting = {
    status: "waiting_coordinator" as const,
    slotConstructionAllowed: true,
  };
  const safety = {
    status: "safety_hold" as const,
    slotConstructionAllowed: false,
  };
  const care = {
    status: "care_hold" as const,
    slotConstructionAllowed: false,
  };

  it("accepts a live run that leaves a slotted ask in the queue", () => {
    expect(demoStructureAllows(slotted, waiting)).toBe(true);
    expect(demoStructureAllows(queued, waiting)).toBe(true);
  });

  it("refuses a live run that would hold an ask the demo publishes", () => {
    expect(demoStructureAllows(slotted, safety)).toBe(false);
    expect(demoStructureAllows(slotted, care)).toBe(false);
    expect(demoStructureAllows(queued, care)).toBe(false);
  });

  it("accepts any hold for the held ask, and only a hold", () => {
    expect(demoStructureAllows(held, safety)).toBe(true);
    expect(demoStructureAllows(held, care)).toBe(true);
    expect(demoStructureAllows(held, waiting)).toBe(false);
  });
});

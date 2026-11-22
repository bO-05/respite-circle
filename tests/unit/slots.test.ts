import { describe, expect, it } from "vitest";
import {
  KIND_LABEL,
  buildDraftSlots,
  buildManualDraft,
  canPublishDraft,
  formatWindowLabel,
  nextWindowForPreference,
  parseWallTimeInput,
  ruleReferenceText,
  tierForKind,
  toDateTimeLocalValue,
  validateDraftSlotInput,
  type ConstructionInput,
  type SessionOption,
  type TypedAnswer,
} from "@/server/domain/slots";

/**
 * Plain-code slot construction.
 *
 * The model answers nine closed questions; this module turns those answers into
 * draft times. It never reads the caregiver's words and cannot produce a
 * sentence about a person. Safety and personal care are checked before any
 * branch exists, an abstention anywhere in Q1–Q3/Q6 keeps the plan empty, and a
 * drive is only proposed when the church has signed its volunteer-driver
 * policy.
 */

const TIME_ZONE = "America/New_York";
const NOW = new Date("2026-11-17T15:00:00.000Z"); // Tuesday 10:00 in New York

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

function sessionOption(
  id: string,
  startsAt: string,
  overrides: Partial<SessionOption> = {},
): SessionOption {
  const start = new Date(startsAt);
  return {
    id,
    startsAt: start,
    endsAt: new Date(start.getTime() + 4 * 60 * 60 * 1_000),
    capacity: 12,
    usedCompanionPlaces: 0,
    status: "scheduled",
    ...overrides,
  };
}

function input(overrides: Partial<ConstructionInput> = {}): ConstructionInput {
  return {
    answers: HERO_ANSWERS,
    sessions: [sessionOption("session-1", "2026-11-24T15:00:00.000Z")],
    recipientFirstName: "Elena",
    policy: { transportEnabled: false },
    now: NOW,
    timeZone: TIME_ZONE,
    ...overrides,
  };
}

describe("plain-code construction from the nine answers", () => {
  it("proposes a companion place at the next Respite Morning and a gated Saturday home visit for the hero ask", () => {
    const plan = buildDraftSlots(input());

    expect(plan.blocked).toBeNull();
    expect(plan.proposals.map((proposal) => proposal.kind)).toEqual([
      "companion",
      "home",
    ]);

    const companion = plan.proposals[0];
    expect(companion).toMatchObject({
      kind: "companion",
      tier: "public_event",
      label: "Companion place at Respite Morning",
      gated: false,
      ruleRef: "q1_companion",
      sessionId: "session-1",
    });
    expect(companion.windowStart?.toISOString()).toBe(
      "2026-11-24T15:00:00.000Z",
    );
    expect(companion.windowEnd?.toISOString()).toBe(
      "2026-11-24T19:00:00.000Z",
    );
    expect(companion.orientationNote).toContain("Elena");
    expect(companion.orientationNote).toMatch(/already know/i);
    expect(companion.ruleText).toMatch(/Rule Q1/);

    const home = plan.proposals[1];
    expect(home).toMatchObject({
      kind: "home",
      tier: "in_home",
      gated: true,
      ruleRef: "q6_home",
      sessionId: null,
    });
    // Saturday 21 November 2026, 10:00–12:00 America/New_York (EST).
    expect(home.windowStart?.toISOString()).toBe(
      "2026-11-21T15:00:00.000Z",
    );
    expect(home.windowEnd?.toISOString()).toBe("2026-11-21T17:00:00.000Z");
    expect(home.orientationNote).toMatch(/two people|first visit/i);
    expect(home.orientationNote).toMatch(/no medication/i);
    expect(home.label).toMatch(/Saturday/);
    expect(home.ruleText).toMatch(/Rule Q1 \+ Q6/);
  });

  it("skips the companion place when no future Respite Morning has room", () => {
    const full = sessionOption("session-full", "2026-11-24T15:00:00.000Z", {
      capacity: 1,
      usedCompanionPlaces: 1,
    });
    const plan = buildDraftSlots(input({ sessions: [full] }));

    expect(plan.proposals.map((proposal) => proposal.kind)).toEqual(["home"]);
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        kind: "companion",
        reason: "no_session_capacity",
      }),
    ]);
    expect(plan.skipped[0].message).toMatch(/room/i);
  });

  it("never proposes a companion place if no session was loaded", () => {
    const plan = buildDraftSlots(input({ sessions: [] }));
    expect(plan.proposals.map((proposal) => proposal.kind)).toEqual(["home"]);
    expect(plan.skipped[0]).toMatchObject({
      kind: "companion",
      reason: "no_session_capacity",
    });
  });

  it("proposes a drive only when transport is enabled and the driver policy is signed", () => {
    const driveAnswers = HERO_ANSWERS.map((entry) =>
      entry.questionId === "Q2" ? answer("Q2", true) : entry,
    );

    const blocked = buildDraftSlots(
      input({ answers: driveAnswers, policy: { transportEnabled: false } }),
    );
    expect(blocked.proposals.map((proposal) => proposal.kind)).not.toContain(
      "drive",
    );
    expect(blocked.skipped).toEqual([
      expect.objectContaining({ kind: "drive", reason: "no_driver_policy" }),
    ]);
    expect(blocked.skipped[0].message).toMatch(/driver policy/i);

    const allowed = buildDraftSlots(
      input({ answers: driveAnswers, policy: { transportEnabled: true } }),
    );
    const drive = allowed.proposals.find(
      (proposal) => proposal.kind === "drive",
    );
    expect(drive).toMatchObject({
      tier: "transport",
      gated: true,
      ruleRef: "q2_drive",
    });
    // Saturday 21 November 2026, 10:00–12:00 local.
    expect(drive?.windowStart?.toISOString()).toBe(
      "2026-11-21T15:00:00.000Z",
    );
    expect(drive?.ruleText).toMatch(/Rule Q2/);
    expect(allowed.skipped).toEqual([]);
  });

  it("carries the reheat preference on a meal and no clinical detail", () => {
    const mealAnswers: TypedAnswer[] = [
      answer("Q1", false),
      answer("Q2", false),
      answer("Q3", true),
      answer("Q4", "saturday"),
      answer("Q5", false),
      answer("Q6", false),
      answer("Q7", "reheats"),
      answer("Q8", false),
      answer("Q9", false),
    ];

    const plan = buildDraftSlots(input({ answers: mealAnswers }));
    expect(plan.proposals).toHaveLength(1);

    const meal = plan.proposals[0];
    expect(meal).toMatchObject({
      kind: "meal",
      tier: "doorstep",
      gated: false,
      ruleRef: "q3_meal",
    });
    expect(meal.label).toMatch(/reheat/i);
    expect(meal.orientationNote).toMatch(/reheat/i);
    expect(meal.orientationNote).toMatch(/label the dish/i);
    expect(`${meal.label} ${meal.orientationNote}`).not.toMatch(
      /diagnos|medicat|dementia|condition|clinical/i,
    );
  });

  it("never constructs a slot from a safety or personal-care flag", () => {
    const safety = buildDraftSlots(
      input({
        answers: HERO_ANSWERS.map((entry) =>
          entry.questionId === "Q5" ? answer("Q5", true) : entry,
        ),
      }),
    );
    expect(safety.proposals).toEqual([]);
    expect(safety.blocked?.reason).toBe("safety_flag");
    expect(safety.blocked?.message).toMatch(/a person calls today/i);

    const care = buildDraftSlots(
      input({
        answers: HERO_ANSWERS.map((entry) =>
          entry.questionId === "Q9" ? answer("Q9", true) : entry,
        ),
      }),
    );
    expect(care.proposals).toEqual([]);
    expect(care.blocked?.reason).toBe("personal_care_flag");
    expect(care.blocked?.message).toMatch(/professional help/i);

    // An abstention on Q5/Q9 is the same handoff, never a guess.
    const unsureCare = buildDraftSlots(
      input({
        answers: HERO_ANSWERS.map((entry) =>
          entry.questionId === "Q9" ? answer("Q9", false, true) : entry,
        ),
      }),
    );
    expect(unsureCare.proposals).toEqual([]);
    expect(unsureCare.blocked?.reason).toBe("personal_care_flag");
  });

  it("keeps proposals conservative when a need question abstains", () => {
    for (const questionId of ["Q1", "Q2", "Q3", "Q6"]) {
      const plan = buildDraftSlots(
        input({
          answers: HERO_ANSWERS.map((entry) =>
            entry.questionId === questionId
              ? answer(questionId, entry.answer, true)
              : entry,
          ),
        }),
      );
      expect(plan.proposals).toEqual([]);
      expect(plan.blocked?.reason).toBe("abstained");
      expect(plan.blocked?.questionIds).toContain(questionId);
    }
  });

  it("treats a missing need answer as no need, without inventing one", () => {
    const plan = buildDraftSlots(input({ answers: [] }));
    expect(plan.proposals).toEqual([]);
    expect(plan.blocked).toBeNull();
  });
});

describe("window mapping", () => {
  it("maps Q4 to the next matching local window", () => {
    const cases: Array<{
      preference: string;
      startsAt: string | null;
      endsAt: string | null;
    }> = [
      {
        preference: "weekday_morning",
        startsAt: "2026-11-18T15:00:00.000Z",
        endsAt: "2026-11-18T17:00:00.000Z",
      },
      {
        preference: "weekday_afternoon",
        startsAt: "2026-11-17T18:00:00.000Z",
        endsAt: "2026-11-17T20:00:00.000Z",
      },
      {
        preference: "weekday_evening",
        startsAt: "2026-11-17T23:00:00.000Z",
        endsAt: "2026-11-18T01:00:00.000Z",
      },
      {
        preference: "saturday",
        startsAt: "2026-11-21T15:00:00.000Z",
        endsAt: "2026-11-21T17:00:00.000Z",
      },
      {
        preference: "sunday",
        startsAt: "2026-11-22T15:00:00.000Z",
        endsAt: "2026-11-22T17:00:00.000Z",
      },
      { preference: "flexible", startsAt: null, endsAt: null },
      { preference: "none_stated", startsAt: null, endsAt: null },
      { preference: "not a real value", startsAt: null, endsAt: null },
    ];

    for (const entry of cases) {
      const window = nextWindowForPreference(
        entry.preference,
        NOW,
        TIME_ZONE,
        "home",
      );
      expect(window.start?.toISOString() ?? null).toBe(entry.startsAt);
      expect(window.end?.toISOString() ?? null).toBe(entry.endsAt);
    }
  });

  it("skips the weekend for a weekday window", () => {
    // Friday 20 November 2026, 18:00 in New York.
    const fridayEvening = new Date("2026-11-20T23:00:00.000Z");
    const window = nextWindowForPreference(
      "weekday_evening",
      fridayEvening,
      TIME_ZONE,
      "home",
    );
    // Monday 23 November 2026, 18:00 local.
    expect(window.start?.toISOString()).toBe("2026-11-23T23:00:00.000Z");
  });

  it("uses a lunchtime window for a meal", () => {
    const window = nextWindowForPreference(
      "saturday",
      NOW,
      TIME_ZONE,
      "meal",
    );
    // Saturday 21 November 2026, 11:00–12:00 local.
    expect(window.start?.toISOString()).toBe("2026-11-21T16:00:00.000Z");
    expect(window.end?.toISOString()).toBe("2026-11-21T17:00:00.000Z");
  });
});

describe("local time fields", () => {
  it("round-trips a datetime-local value through the church timezone", () => {
    const parsed = parseWallTimeInput("2026-11-21T10:00", TIME_ZONE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.date?.toISOString()).toBe("2026-11-21T15:00:00.000Z");
    expect(toDateTimeLocalValue(parsed.date ?? null, TIME_ZONE)).toBe(
      "2026-11-21T10:00",
    );
  });

  it("handles daylight saving time rather than assuming one offset", () => {
    const summer = parseWallTimeInput("2026-07-04T10:00", TIME_ZONE);
    if (!summer.ok) throw new Error(summer.message);
    expect(summer.date?.toISOString()).toBe("2026-07-04T14:00:00.000Z");
    const winter = parseWallTimeInput("2026-12-05T10:00", TIME_ZONE);
    if (!winter.ok) throw new Error(winter.message);
    expect(winter.date?.toISOString()).toBe("2026-12-05T15:00:00.000Z");
  });

  it("treats an empty field as no window and refuses nonsense", () => {
    expect(parseWallTimeInput("", TIME_ZONE)).toEqual({
      ok: true,
      date: null,
    });
    expect(parseWallTimeInput("   ", TIME_ZONE)).toEqual({
      ok: true,
      date: null,
    });
    expect(parseWallTimeInput("Saturday", TIME_ZONE).ok).toBe(false);
    expect(parseWallTimeInput("2026-13-40T99:99", TIME_ZONE).ok).toBe(false);
  });

  it("formats a window for a coordinator without a raw timestamp", () => {
    const start = new Date("2026-11-21T15:00:00.000Z");
    const end = new Date("2026-11-21T17:00:00.000Z");
    const label = formatWindowLabel(start, end, TIME_ZONE);
    expect(label).toBe("Saturday 21 November 2026, 10:00–12:00");
    expect(
      formatWindowLabel(null, null, TIME_ZONE),
    ).toBe("Time to be chosen with the family");
  });
});

describe("editing rules", () => {
  const valid = {
    kind: "home",
    label: "Saturday visit at home",
    windowStart: new Date("2026-11-21T15:00:00.000Z"),
    windowEnd: new Date("2026-11-21T17:00:00.000Z"),
    gated: true,
    orientationNote: "Two people for the first visit.",
  };

  it("accepts a complete draft and trims the label", () => {
    const result = validateDraftSlotInput({
      ...valid,
      label: "  Saturday visit at home  ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.label).toBe("Saturday visit at home");
    expect(result.value.tier).toBe("in_home");
    expect(result.value.gated).toBe(true);
  });

  it("refuses an unknown kind, an empty label, reversed windows, and a long note", () => {
    expect(validateDraftSlotInput({ ...valid, kind: "yacht" }).ok).toBe(false);
    expect(validateDraftSlotInput({ ...valid, label: "   " }).ok).toBe(false);
    expect(
      validateDraftSlotInput({
        ...valid,
        windowStart: new Date("2026-11-21T17:00:00.000Z"),
        windowEnd: new Date("2026-11-21T15:00:00.000Z"),
      }).ok,
    ).toBe(false);
    expect(
      validateDraftSlotInput({
        ...valid,
        windowStart: new Date("2026-11-21T15:00:00.000Z"),
        windowEnd: null,
      }).ok,
    ).toBe(false);
    expect(
      validateDraftSlotInput({
        ...valid,
        orientationNote: "x".repeat(2_001),
      }).ok,
    ).toBe(false);
    expect(validateDraftSlotInput({ ...valid, gated: "yes" }).ok).toBe(false);
  });

  it("lets a coordinator clear the window and the orientation note", () => {
    const result = validateDraftSlotInput({
      ...valid,
      windowStart: null,
      windowEnd: null,
      orientationNote: "   ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.windowStart).toBeNull();
    expect(result.value.windowEnd).toBeNull();
    expect(result.value.orientationNote).toBeNull();
  });

  it("refuses to publish a held draft until the hold is resolved", () => {
    expect(
      canPublishDraft({ status: "draft", holdReason: null }).ok,
    ).toBe(true);

    const held = canPublishDraft({
      status: "draft",
      holdReason: "Waiting to hear about the family's Saturday.",
    });
    expect(held.ok).toBe(false);
    if (held.ok) return;
    expect(held.reason).toBe("held");
    expect(held.message).toMatch(/resolve the hold/i);

    const published = canPublishDraft({ status: "open", holdReason: null });
    expect(published.ok).toBe(false);
    if (published.ok) return;
    expect(published.reason).toBe("not_draft");
  });
});

describe("manual additions", () => {
  it("builds a coordinator draft with a manual rule reference", () => {
    const draft = buildManualDraft({
      kind: "home",
      recipientFirstName: "Elena",
      sessions: [sessionOption("session-1", "2026-11-24T15:00:00.000Z")],
      now: NOW,
      timeZone: TIME_ZONE,
      transportEnabled: false,
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.proposal).toMatchObject({
      kind: "home",
      tier: "in_home",
      gated: true,
      ruleRef: "manual",
    });
    expect(draft.proposal.ruleText).toMatch(/Added by the coordinator/);
    expect(draft.proposal.label).toBe(KIND_LABEL.home);
  });

  it("links a manual companion place to the next session with room", () => {
    const draft = buildManualDraft({
      kind: "companion",
      recipientFirstName: "Elena",
      sessions: [sessionOption("session-1", "2026-11-24T15:00:00.000Z")],
      now: NOW,
      timeZone: TIME_ZONE,
      transportEnabled: false,
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.proposal.sessionId).toBe("session-1");
    expect(draft.proposal.windowStart?.toISOString()).toBe(
      "2026-11-24T15:00:00.000Z",
    );
  });

  it("refuses a manual drive when no driver policy is signed", () => {
    const draft = buildManualDraft({
      kind: "drive",
      recipientFirstName: "Elena",
      sessions: [],
      now: NOW,
      timeZone: TIME_ZONE,
      transportEnabled: false,
    });
    expect(draft.ok).toBe(false);
    if (draft.ok) return;
    expect(draft.message).toMatch(/driver policy/i);
  });

  it("refuses an unknown kind and keeps every tier closed", () => {
    const draft = buildManualDraft({
      kind: "yacht" as never,
      recipientFirstName: "Elena",
      sessions: [],
      now: NOW,
      timeZone: TIME_ZONE,
      transportEnabled: false,
    });
    expect(draft.ok).toBe(false);

    expect(tierForKind("companion")).toBe("public_event");
    expect(tierForKind("home")).toBe("in_home");
    expect(tierForKind("drive")).toBe("transport");
    expect(tierForKind("meal")).toBe("doorstep");
  });
});

describe("rule references", () => {
  it("names the rule that produced every proposal", () => {
    for (const ruleRef of [
      "q1_companion",
      "q6_home",
      "q2_drive",
      "q3_meal",
      "manual",
    ] as const) {
      expect(ruleReferenceText(ruleRef)).toMatch(/Rule|coordinator/);
      expect(ruleReferenceText(ruleRef).length).toBeGreaterThan(20);
    }
    expect(ruleReferenceText("an unknown code")).toMatch(/coordinator/i);
  });
});

import { describe, expect, it } from "vitest";
import {
  SKIPPED_MESSAGES,
  buildDraftSlots,
  buildManualDraft,
  skippedMessage,
  type ConstructionInput,
  type SessionOption,
  type TypedAnswer,
} from "@/server/domain/slots";

/**
 * Proposals against the Respite Morning calendar.
 *
 * A Tuesday place can only be proposed for a morning that exists and has room.
 * An incomplete calendar is a refusal with a reason, never a silent null
 * session and never an overbooked morning.
 */

const TIME_ZONE = "America/New_York";
const NOW = new Date("2026-11-22T12:00:00.000Z");

function answer(
  questionId: string,
  value: unknown,
  abstained = false,
): TypedAnswer {
  return { questionId, answer: value, abstained };
}

const COMPANION_ANSWERS: TypedAnswer[] = [
  answer("Q1", true),
  answer("Q2", false),
  answer("Q3", false),
  answer("Q4", "weekday_morning"),
  answer("Q5", false),
  answer("Q6", false),
  answer("Q7", "unknown"),
  answer("Q8", false),
  answer("Q9", false),
];

function session(
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
    answers: COMPANION_ANSWERS,
    sessions: [session("session-1", "2026-11-24T15:00:00.000Z")],
    recipientFirstName: "Elena",
    policy: { transportEnabled: false },
    now: NOW,
    timeZone: TIME_ZONE,
    ...overrides,
  };
}

describe("companion proposals respect the calendar", () => {
  it("refuses a companion place while a week is missing, and says which week", () => {
    const plan = buildDraftSlots(
      input({
        calendar: {
          incomplete: true,
          message:
            "The next four Tuesdays are not all planned. Tuesday 8 December 2026 has no Respite Morning yet, so no companion place can be proposed for that week. Fill the calendar first.",
        },
      }),
    );

    expect(plan.proposals).toHaveLength(0);
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        kind: "companion",
        reason: "calendar_incomplete",
      }),
    ]);
    expect(plan.skipped[0]?.message).toContain("Tuesday 8 December 2026");
    expect(plan.skipped[0]?.message).toMatch(/fill the calendar/i);
  });

  it("has human copy for a calendar refusal", () => {
    expect(SKIPPED_MESSAGES.calendar_incomplete).toMatch(/calendar/i);
    expect(skippedMessage("calendar_incomplete")).toBe(
      SKIPPED_MESSAGES.calendar_incomplete,
    );
  });

  it("still proposes the home visit when only the Tuesday calendar is incomplete", () => {
    const plan = buildDraftSlots(
      input({
        answers: COMPANION_ANSWERS.map((entry) =>
          entry.questionId === "Q6" ? answer("Q6", true) : entry,
        ),
        calendar: {
          incomplete: true,
          message:
            "The next four Tuesdays are not all planned. Tuesday 8 December 2026 has no Respite Morning yet.",
        },
      }),
    );

    expect(plan.proposals.map((proposal) => proposal.kind)).toEqual(["home"]);
    expect(plan.skipped.map((entry) => entry.kind)).toEqual(["companion"]);
  });
});

describe("manual companion places respect capacity", () => {
  const base = {
    kind: "companion" as const,
    recipientFirstName: "Elena",
    now: NOW,
    timeZone: TIME_ZONE,
    transportEnabled: false,
  };

  it("refuses a companion place when every morning is full", () => {
    const result = buildManualDraft({
      ...base,
      sessions: [
        session("session-1", "2026-11-24T15:00:00.000Z", {
          usedCompanionPlaces: 12,
        }),
        session("session-2", "2026-12-01T15:00:00.000Z", {
          usedCompanionPlaces: 12,
        }),
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/full/i);
    expect(result.message).toMatch(/12 of 12/);
  });

  it("refuses a companion place when there is no morning to link", () => {
    const result = buildManualDraft({ ...base, sessions: [] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/no Respite Morning/i);
    expect(result.message).toMatch(/fill the calendar/i);
  });

  it("refuses a companion place while the calendar is incomplete", () => {
    const result = buildManualDraft({
      ...base,
      sessions: [session("session-1", "2026-11-24T15:00:00.000Z")],
      calendar: {
        incomplete: true,
        message:
          "The next four Tuesdays are not all planned. Tuesday 8 December 2026 has no Respite Morning yet.",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("Tuesday 8 December 2026");
  });

  it("still adds a companion place to the earliest morning with room", () => {
    const result = buildManualDraft({
      ...base,
      sessions: [
        session("session-1", "2026-11-24T15:00:00.000Z", {
          usedCompanionPlaces: 12,
        }),
        session("session-2", "2026-12-01T15:00:00.000Z", {
          usedCompanionPlaces: 2,
        }),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.sessionId).toBe("session-2");
    expect(result.proposal.windowStart?.toISOString()).toBe(
      "2026-12-01T15:00:00.000Z",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  DESK_QUEUE_STATUSES,
  HOLD_REASON,
  NO_TYPED_REASON_SENTENCE,
  QUEUE_CATEGORY_HEADING,
  QUEUE_CATEGORY_NOTE,
  QUEUE_CATEGORY_ORDER,
  bilingualSummarySentence,
  formatReasonSummary,
  formatWaitingTime,
  groupDeskQueue,
  holdReasonFor,
  isDeskQueueStatus,
  orderDeskQueue,
  pinLabelFor,
  queueCategoryFor,
  safetyRowTitle,
  summariseTypedReasons,
  waitingLabel,
  type DeskQueueStatus,
  type QueueAnswer,
} from "@/server/domain/desk-queue";

/**
 * The coordinator queue is a category list, never a ranking.
 *
 * Safety and personal-care asks are pinned as categories at the top; every
 * other waiting ask is oldest first. The reason summary is built only from
 * closed typed answers, so an unexpected stored value can never become a
 * sentence about a family.
 */

const NOW = new Date("2026-11-22T12:00:00.000Z");

function answer(overrides: Partial<QueueAnswer> = {}): QueueAnswer {
  return {
    questionId: "Q1",
    answer: true,
    abstained: false,
    ...overrides,
  };
}

function row(
  id: string,
  status: DeskQueueStatus,
  createdAt: string,
): { id: string; status: DeskQueueStatus; createdAt: Date } {
  return { id, status, createdAt: new Date(createdAt) };
}

describe("desk queue membership", () => {
  it("accepts exactly the three queue statuses and nothing else", () => {
    expect([...DESK_QUEUE_STATUSES]).toEqual([
      "waiting_coordinator",
      "safety_hold",
      "care_hold",
    ]);

    for (const status of DESK_QUEUE_STATUSES) {
      expect(isDeskQueueStatus(status)).toBe(true);
    }
    for (const status of [
      "draft",
      "approved",
      "sent_back",
      "closed",
      "withdrawn",
      "open",
    ]) {
      expect(isDeskQueueStatus(status)).toBe(false);
    }
  });

  it("maps each status to its own pinned category", () => {
    expect(queueCategoryFor("safety_hold")).toBe("safety");
    expect(queueCategoryFor("care_hold")).toBe("personal_care");
    expect(queueCategoryFor("waiting_coordinator")).toBe("waiting");

    expect([...QUEUE_CATEGORY_ORDER]).toEqual([
      "safety",
      "personal_care",
      "waiting",
    ]);
  });

  it("names the action each group leads with, not a category or a score", () => {
    expect(pinLabelFor("safety_hold")).toBe("Call today");
    expect(pinLabelFor("care_hold")).toBe("Needs professional help");
    expect(pinLabelFor("waiting_coordinator")).toBeNull();

    expect(QUEUE_CATEGORY_HEADING.safety).toBe("Call today");
    expect(QUEUE_CATEGORY_HEADING.personal_care).toBe(
      "Needs professional help",
    );
    expect(QUEUE_CATEGORY_HEADING.waiting).toBe("Waiting for a person");

    const allCopy = Object.values(QUEUE_CATEGORY_HEADING).join(" ");
    expect(allCopy).not.toMatch(/urgent|priority|score|rank/i);
    // The retired category names are gone from every heading and pin label.
    expect(allCopy).not.toMatch(/safety hold|personal-care hold|coverage watch/i);

    // The sub-line leads with the action a coordinator takes; the defensive
    // "Pinned as a category, not a score" sentence is gone.
    expect(QUEUE_CATEGORY_NOTE.safety).toBe(
      "Someone calls the family today; no time is offered yet.",
    );
    expect(QUEUE_CATEGORY_NOTE.personal_care).toBe(
      "Someone connects the family with professional help.",
    );
    expect(Object.values(QUEUE_CATEGORY_NOTE).join(" ")).not.toMatch(
      /pinned as a category/i,
    );
  });
});

describe("safety row title", () => {
  it("leads with the call and the family's first name", () => {
    expect(safetyRowTitle("Priya")).toBe("Call Priya today");
    expect(safetyRowTitle("  Priya ")).toBe("Call Priya today");
  });

  it("falls back to the family when no name can be used", () => {
    expect(safetyRowTitle("")).toBe("Call the family today");
    expect(safetyRowTitle("   ")).toBe("Call the family today");
    expect(safetyRowTitle(null)).toBe("Call the family today");
    expect(safetyRowTitle(undefined)).toBe("Call the family today");
  });

  it("never puts a hold category or a severity in the row title", () => {
    const title = safetyRowTitle("Priya");
    expect(title.startsWith("Call Priya today")).toBe(true);
    expect(title).not.toMatch(/hold|urgent|priority|score|rank/i);
  });
});

describe("desk queue ordering", () => {
  it("pins safety first, personal care second, and orders each oldest first", () => {
    const ordered = orderDeskQueue([
      row("waiting-new", "waiting_coordinator", "2026-11-22T11:00:00Z"),
      row("care-old", "care_hold", "2026-11-18T09:00:00Z"),
      row("safety-new", "safety_hold", "2026-11-22T10:00:00Z"),
      row("waiting-old", "waiting_coordinator", "2026-11-19T09:00:00Z"),
      row("safety-old", "safety_hold", "2026-11-17T09:00:00Z"),
      row("care-new", "care_hold", "2026-11-21T09:00:00Z"),
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      "safety-old",
      "safety-new",
      "care-old",
      "care-new",
      "waiting-old",
      "waiting-new",
    ]);
  });

  it("breaks exact timestamp ties by id so the order is stable", () => {
    const same = "2026-11-20T09:00:00Z";
    const ordered = orderDeskQueue([
      row("b", "waiting_coordinator", same),
      row("a", "waiting_coordinator", same),
    ]);

    expect(ordered.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("groups the ordered rows without dropping any", () => {
    const groups = groupDeskQueue([
      row("w", "waiting_coordinator", "2026-11-20T09:00:00Z"),
      row("s", "safety_hold", "2026-11-21T09:00:00Z"),
    ]);

    expect(groups.safety.map((item) => item.id)).toEqual(["s"]);
    expect(groups.personal_care).toEqual([]);
    expect(groups.waiting.map((item) => item.id)).toEqual(["w"]);
  });
});

describe("typed reason summary", () => {
  it("names practical needs from closed answers only", () => {
    const summary = summariseTypedReasons([
      answer({ questionId: "Q1", answer: true }),
      answer({ questionId: "Q2", answer: true }),
      answer({ questionId: "Q3", answer: false }),
      answer({ questionId: "Q4", answer: "saturday" }),
      answer({ questionId: "Q6", answer: true }),
      answer({ questionId: "Q8", answer: true }),
    ]);

    expect(summary.reasons).toEqual([
      "Companionship",
      "A ride",
      "A Saturday",
      "Someone they know",
      "A steadying hand",
    ]);
    expect(summary.uncertainCount).toBe(0);
    expect(summary.fallback).toBe(false);
    expect(formatReasonSummary(summary)).toBe(
      "Companionship · A ride · A Saturday · Someone they know · A steadying hand",
    );
  });

  it("never echoes an unrecognised pick value", () => {
    const summary = summariseTypedReasons([
      answer({ questionId: "Q4", answer: "every third Tuesday at dawn" }),
    ]);

    expect(summary.reasons).toEqual([]);
    expect(summary.uncertainCount).toBe(1);
    expect(formatReasonSummary(summary)).not.toContain("third Tuesday");
  });

  it("counts uncertain practical answers, but not the hold questions", () => {
    const summary = summariseTypedReasons([
      answer({ questionId: "Q1", abstained: true, answer: true }),
      answer({ questionId: "Q3", abstained: true, answer: false }),
      answer({ questionId: "Q6", abstained: true, answer: true }),
      answer({ questionId: "Q5", abstained: true, answer: false }),
      answer({ questionId: "Q9", abstained: true, answer: false }),
      answer({ questionId: "Q7", abstained: true, answer: "unknown" }),
    ]);

    expect(summary.reasons).toEqual([]);
    expect(summary.uncertainCount).toBe(3);
    expect(formatReasonSummary(summary)).toBe(
      "3 answers uncertain — a person will decide.",
    );
  });

  it("uses the singular for one uncertain answer", () => {
    const summary = summariseTypedReasons([
      answer({ questionId: "Q2", abstained: true, answer: true }),
    ]);

    expect(formatReasonSummary(summary)).toBe(
      "1 answer uncertain — a person will decide.",
    );
  });

  it("names a bilingual handoff instead of counting uncertain answers", () => {
    // A Spanish ask produces nine abstentions because the model refused to
    // guess in English. "9 answers uncertain" hides the only fact the
    // coordinator needs: nobody has read the family's own language yet.
    const summary = summariseTypedReasons(
      [
        answer({ questionId: "Q1", abstained: true, answer: true }),
        answer({ questionId: "Q2", abstained: true, answer: false }),
        answer({ questionId: "Q3", abstained: true, answer: false }),
        answer({ questionId: "Q4", abstained: true, answer: "saturday" }),
      ],
      { bilingualNeeded: true, language: "es" },
    );

    expect(summary.reasons).toEqual([bilingualSummarySentence("es")]);
    expect(summary.reasons[0]).toBe(
      "Written in Spanish — a bilingual person is needed. No English answers were guessed.",
    );
    expect(summary.uncertainCount).toBe(0);
    expect(summary.fallback).toBe(false);
    expect(formatReasonSummary(summary)).toBe(summary.reasons[0]);
    expect(formatReasonSummary(summary)).not.toMatch(/answers? uncertain/);
  });

  it("names a language it knows and never invents one it does not", () => {
    expect(bilingualSummarySentence("es")).toContain("Spanish");
    expect(bilingualSummarySentence("fr")).toContain("French");
    expect(bilingualSummarySentence("und")).toBe(
      "Written in another language — a bilingual person is needed. No English answers were guessed.",
    );
    expect(bilingualSummarySentence(null)).toBe(
      "Written in another language — a bilingual person is needed. No English answers were guessed.",
    );
  });

  it("leaves an English ask's summary exactly as it was", () => {
    const answers = [answer({ questionId: "Q2", abstained: true, answer: true })];
    const plain = summariseTypedReasons(answers);
    const explicit = summariseTypedReasons(answers, {
      bilingualNeeded: false,
      language: "en",
    });

    expect(explicit).toEqual(plain);
    expect(formatReasonSummary(explicit)).toBe(
      "1 answer uncertain — a person will decide.",
    );
  });

  it("falls back to the words when no practical need was named", () => {
    const summary = summariseTypedReasons([
      answer({ questionId: "Q1", answer: false }),
      answer({ questionId: "Q2", answer: false }),
      answer({ questionId: "Q3", answer: false }),
      answer({ questionId: "Q4", answer: "none_stated" }),
      answer({ questionId: "Q6", answer: false }),
      answer({ questionId: "Q8", answer: false }),
    ]);

    expect(summary.fallback).toBe(true);
    expect(formatReasonSummary(summary)).toBe(NO_TYPED_REASON_SENTENCE);
  });

  it("treats no stored answers as a fallback, never an invented reason", () => {
    const summary = summariseTypedReasons([]);

    expect(summary.reasons).toEqual([]);
    expect(summary.uncertainCount).toBe(0);
    expect(summary.fallback).toBe(true);
    expect(formatReasonSummary(summary)).toBe(NO_TYPED_REASON_SENTENCE);
  });

  it("keeps the summary free of urgency language and numbers used as scores", () => {
    const summary = summariseTypedReasons([
      answer({ questionId: "Q1", answer: true }),
    ]);
    const text = formatReasonSummary(summary);

    expect(text).not.toMatch(/urgent|priority|score|rank|risk level/i);
  });
});

describe("hold reasons", () => {
  it("names the next human action for each hold", () => {
    expect(HOLD_REASON.safety_hold).toMatch(/call the family today/i);
    expect(HOLD_REASON.care_hold).toMatch(/professional help/i);

    expect(holdReasonFor("safety_hold")).toBe(HOLD_REASON.safety_hold);
    expect(holdReasonFor("care_hold")).toBe(HOLD_REASON.care_hold);
    expect(holdReasonFor("waiting_coordinator")).toBeNull();
  });

  it("does not offer a time on a safety hold and never creates a personal-care time", () => {
    expect(HOLD_REASON.safety_hold).toMatch(/no time is offered/i);
    expect(HOLD_REASON.care_hold).toMatch(/no personal-care time/i);
  });
});

describe("time waiting", () => {
  it("renders human durations from a server-side clock", () => {
    expect(formatWaitingTime(new Date("2026-11-22T11:59:31Z"), NOW)).toBe(
      "less than a minute",
    );
    expect(formatWaitingTime(new Date("2026-11-22T11:59:00Z"), NOW)).toBe(
      "1 minute",
    );
    expect(formatWaitingTime(new Date("2026-11-22T11:01:00Z"), NOW)).toBe(
      "59 minutes",
    );
    expect(formatWaitingTime(new Date("2026-11-22T11:00:00Z"), NOW)).toBe(
      "1 hour",
    );
    expect(formatWaitingTime(new Date("2026-11-22T09:00:00Z"), NOW)).toBe(
      "3 hours",
    );
    expect(formatWaitingTime(new Date("2026-11-21T12:00:00Z"), NOW)).toBe(
      "1 day",
    );
    expect(formatWaitingTime(new Date("2026-11-19T12:00:00Z"), NOW)).toBe(
      "3 days",
    );
    expect(formatWaitingTime(new Date("2026-11-08T12:00:00Z"), NOW)).toBe(
      "2 weeks",
    );
    expect(formatWaitingTime(new Date("2026-09-22T12:00:00Z"), NOW)).toBe(
      "2 months",
    );
  });

  it("never shows a negative wait or NaN for a bad clock", () => {
    expect(formatWaitingTime(new Date("2026-11-22T12:05:00Z"), NOW)).toBe(
      "less than a minute",
    );
    expect(formatWaitingTime(new Date("not a date"), NOW)).toBe(
      "time not recorded",
    );
    expect(waitingLabel(new Date("not a date"), NOW)).toBe(
      "Waiting time not recorded",
    );
  });

  it("prefixes the row line with Waiting", () => {
    expect(waitingLabel(new Date("2026-11-19T12:00:00Z"), NOW)).toBe(
      "Waiting 3 days",
    );
  });
});

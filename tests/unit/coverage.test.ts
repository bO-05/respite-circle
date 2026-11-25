import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ABSENCE_PROOF_QUERY_TEXT,
  COVERAGE_CALL_OUTCOMES,
  COVERAGE_CALL_OUTCOME_LABELS,
  COVERAGE_NOTE_MAX_LENGTH,
  DEFAULT_CALL_AFTER_OPEN_HOURS,
  DEFAULT_CALL_THRESHOLD_HOURS,
  caregiverWorkingSentence,
  coverageCallLeadLine,
  coverageCloseRefusal,
  coverageExpiryRefusalCopy,
  coverageMessageCountLine,
  coverageOpenFor,
  coverageReofferRefusal,
  coverageWatchOpensAt,
  formatOpenFor,
  isCoverageCallOutcome,
  isCoverageWatchDue,
  reofferWindow,
  validateCoverageCall,
} from "../../src/server/domain/coverage";
import { computeAbsenceProofDigest } from "../../src/server/domain/absence-proof";

/**
 * VAL-FAILURE-001 / -002 / -003 / -006 at the domain boundary.
 *
 * The coverage watch is arithmetic over a fixed clock, never an urgency score:
 * a published time becomes a call task 48 hours before its window, or 24 hours
 * after it was published, whichever comes first. The five call outcomes are a
 * closed human vocabulary. The absence proof names the exact outbox query and
 * digests to 64 hex characters. The caregiver's line names a person and a day,
 * never a count, a wait, or the word "unclaimed".
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const NOW = new Date("2026-11-20T15:00:00.000Z");

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const GARBAGE_WORDS =
  /places? left|remaining|spaces? left|views?|viewed|declines?|declined|waiting time|unclaimed|scarcity|only\s+\d/i;

/**
 * The desk may name the state plainly (a coordinator marks a time
 * `expired_unclaimed`); it never shows a scarcity count or a decline metric.
 */
const SHAME_WORDS =
  /places? left|remaining|spaces? left|views?|viewed|declines?|declined|waiting time|scarcity|only\s+\d/i;

describe("when a time enters the coverage watch", () => {
  it("opens 48 hours before the window", () => {
    const windowStart = new Date("2026-11-24T15:00:00.000Z");
    // Published the same day the window threshold opens, so the 48-hour rule
    // is the earlier of the two candidates.
    const openSince = new Date("2026-11-22T15:00:00.000Z");

    expect(
      coverageWatchOpensAt({
        windowStart,
        openSince,
        thresholdHours: DEFAULT_CALL_THRESHOLD_HOURS,
        openAfterHours: DEFAULT_CALL_AFTER_OPEN_HOURS,
      }),
    ).toEqual(new Date("2026-11-22T15:00:00.000Z"));

    expect(
      isCoverageWatchDue({
        windowStart,
        openSince,
        thresholdHours: DEFAULT_CALL_THRESHOLD_HOURS,
        openAfterHours: DEFAULT_CALL_AFTER_OPEN_HOURS,
        now: new Date("2026-11-22T14:59:59.000Z"),
      }),
    ).toBe(false);

    expect(
      isCoverageWatchDue({
        windowStart,
        openSince,
        thresholdHours: DEFAULT_CALL_THRESHOLD_HOURS,
        openAfterHours: DEFAULT_CALL_AFTER_OPEN_HOURS,
        now: new Date("2026-11-22T15:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("opens 24 hours after publication when the window is far away", () => {
    const windowStart = new Date("2026-12-15T15:00:00.000Z");
    const openSince = new Date("2026-11-20T15:00:00.000Z");

    expect(
      coverageWatchOpensAt({
        windowStart,
        openSince,
        thresholdHours: DEFAULT_CALL_THRESHOLD_HOURS,
        openAfterHours: DEFAULT_CALL_AFTER_OPEN_HOURS,
      }),
    ).toEqual(new Date("2026-11-21T15:00:00.000Z"));

    expect(
      isCoverageWatchDue({
        windowStart,
        openSince,
        thresholdHours: DEFAULT_CALL_THRESHOLD_HOURS,
        openAfterHours: DEFAULT_CALL_AFTER_OPEN_HOURS,
        now: new Date("2026-11-21T14:59:00.000Z"),
      }),
    ).toBe(false);

    expect(
      isCoverageWatchDue({
        windowStart,
        openSince,
        thresholdHours: DEFAULT_CALL_THRESHOLD_HOURS,
        openAfterHours: DEFAULT_CALL_AFTER_OPEN_HOURS,
        now: new Date("2026-11-21T15:01:00.000Z"),
      }),
    ).toBe(true);
  });

  it("uses the earlier threshold and works with no window at all", () => {
    const nearWindow = new Date(NOW.getTime() + 12 * HOUR);

    expect(
      isCoverageWatchDue({
        windowStart: nearWindow,
        openSince: NOW,
        thresholdHours: DEFAULT_CALL_THRESHOLD_HOURS,
        openAfterHours: DEFAULT_CALL_AFTER_OPEN_HOURS,
        now: NOW,
      }),
    ).toBe(true);

    expect(
      coverageWatchOpensAt({
        windowStart: null,
        openSince: new Date(NOW.getTime() - 25 * HOUR),
        thresholdHours: DEFAULT_CALL_THRESHOLD_HOURS,
        openAfterHours: DEFAULT_CALL_AFTER_OPEN_HOURS,
      }),
    ).toEqual(new Date(NOW.getTime() - HOUR));

    expect(
      isCoverageWatchDue({
        windowStart: null,
        openSince: new Date(NOW.getTime() - 25 * HOUR),
        thresholdHours: DEFAULT_CALL_THRESHOLD_HOURS,
        openAfterHours: DEFAULT_CALL_AFTER_OPEN_HOURS,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("treats an already-started window as due", () => {
    expect(
      isCoverageWatchDue({
        windowStart: new Date(NOW.getTime() - 2 * HOUR),
        openSince: NOW,
        thresholdHours: DEFAULT_CALL_THRESHOLD_HOURS,
        openAfterHours: DEFAULT_CALL_AFTER_OPEN_HOURS,
        now: NOW,
      }),
    ).toBe(true);
  });
});

describe("time open copy", () => {
  it("renders hours and days without a countdown", () => {
    expect(formatOpenFor(10 * 60_000)).toBe("under an hour");
    expect(formatOpenFor(HOUR)).toBe("1 hour");
    expect(formatOpenFor(5 * HOUR)).toBe("5 hours");
    expect(formatOpenFor(DAY)).toBe("1 day");
    expect(formatOpenFor(2 * DAY + 3 * HOUR)).toBe("2 days, 3 hours");
  });

  it("reports the open duration from the publication instant", () => {
    const open = coverageOpenFor(new Date(NOW.getTime() - 30 * HOUR), NOW);
    expect(open.ms).toBe(30 * HOUR);
    expect(open.label).toBe("1 day, 6 hours");
  });
});

describe("the call vocabulary", () => {
  it("offers exactly the five human outcomes with labels", () => {
    expect([...COVERAGE_CALL_OUTCOMES]).toEqual([
      "reached",
      "left_message",
      "try_later",
      "caregiver_withdrew",
      "coordinator_will_cover",
    ]);

    for (const outcome of COVERAGE_CALL_OUTCOMES) {
      expect(COVERAGE_CALL_OUTCOME_LABELS[outcome].length).toBeGreaterThan(3);
    }

    expect(isCoverageCallOutcome("reached")).toBe(true);
    expect(isCoverageCallOutcome("declined")).toBe(false);
    expect(isCoverageCallOutcome(null)).toBe(false);
  });

  it("requires an outcome and normalises a note without trimming it", () => {
    const missing = validateCoverageCall({ outcome: "", note: "x" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.field).toBe("outcome");

    const unknown = validateCoverageCall({ outcome: "declined", note: "" });
    expect(unknown.ok).toBe(false);

    const kept = validateCoverageCall({
      outcome: "left_message",
      note: "  Asked Ruth to call back after six.\r\nShe has the number.  ",
    });
    expect(kept.ok).toBe(true);
    if (kept.ok) {
      expect(kept.outcome).toBe("left_message");
      expect(kept.note).toBe(
        "  Asked Ruth to call back after six.\nShe has the number.  ",
      );
    }

    const blank = validateCoverageCall({ outcome: "reached", note: "   " });
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.note).toBeNull();

    const tooLong = validateCoverageCall({
      outcome: "reached",
      note: "x".repeat(COVERAGE_NOTE_MAX_LENGTH + 1),
    });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.field).toBe("note");
  });

  it("keeps the message-count line exact", () => {
    expect(coverageMessageCountLine(0)).toBe(
      "Messages sent to the caregiver about this slot: 0",
    );
    expect(coverageMessageCountLine(2)).toBe(
      "Messages sent to the caregiver about this slot: 2",
    );
  });
});

describe("the absence proof", () => {
  it("names the outbox query and binds it with the slot, count, and time", () => {
    expect(ABSENCE_PROOF_QUERY_TEXT).toContain("FROM notification");
    expect(ABSENCE_PROOF_QUERY_TEXT).toContain("slot_id");
    expect(ABSENCE_PROOF_QUERY_TEXT).toContain("caregiver_outbox_count");

    const digest = computeAbsenceProofDigest({
      slotId: "0f000000-0000-4000-8000-000000000001",
      caregiverOutboxCount: 0,
      queryText: ABSENCE_PROOF_QUERY_TEXT,
      generatedAt: NOW,
    });
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // The old recipe hashed the four-line constant and proved nothing.
    expect(digest).not.toBe(hash(ABSENCE_PROOF_QUERY_TEXT));
  });
});

describe("offering the same time again", () => {
  it("moves the window at least a day ahead and keeps the duration", () => {
    const windowStart = new Date(NOW.getTime() - 2 * DAY);
    const windowEnd = new Date(windowStart.getTime() + 4 * HOUR);

    const shifted = reofferWindow({ windowStart, windowEnd, now: NOW });
    expect(shifted).not.toBeNull();
    if (!shifted) return;

    expect(shifted.windowStart.getTime()).toBeGreaterThanOrEqual(
      NOW.getTime() + DAY,
    );
    expect(
      shifted.windowStart.getTime() - windowStart.getTime(),
    ).toBeGreaterThanOrEqual(7 * DAY);
    expect(
      (shifted.windowStart.getTime() - windowStart.getTime()) % (7 * DAY),
    ).toBe(0);

    const newEnd = shifted.windowEnd;
    expect(newEnd).not.toBeNull();
    if (newEnd) {
      expect(newEnd.getTime() - shifted.windowStart.getTime()).toBe(
        4 * HOUR,
      );
    }
  });

  it("refuses a time with no window to move", () => {
    expect(
      reofferWindow({ windowStart: null, windowEnd: null, now: NOW }),
    ).toBeNull();
  });

  it("requires a logged call before a re-offer, and allows only one", () => {
    const withoutCall = coverageReofferRefusal({
      status: "open",
      calls: 0,
      reoffers: 0,
    });
    expect(withoutCall.ok).toBe(false);
    if (!withoutCall.ok) {
      expect(withoutCall.code).toBe("needs_call");
      expect(withoutCall.message.toLowerCase()).toContain("call");
    }

    expect(
      coverageReofferRefusal({ status: "open", calls: 1, reoffers: 0 }).ok,
    ).toBe(true);

    const twice = coverageReofferRefusal({
      status: "open",
      calls: 2,
      reoffers: 1,
    });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.code).toBe("already_reoffered");
  });
});

describe("closing a time unclaimed", () => {
  it("refuses every state that is not a published, unclaimed time", () => {
    for (const status of [
      "draft",
      "claimed",
      "covered",
      "done",
      "cancelled",
      "expired_unclaimed",
    ]) {
      const copy = coverageExpiryRefusalCopy(status);
      expect(copy.length).toBeGreaterThan(10);
      expect(copy.toLowerCase()).not.toMatch(SHAME_WORDS);
    }

    expect(
      coverageExpiryRefusalCopy("open").toLowerCase(),
    ).not.toMatch(SHAME_WORDS);
  });

  it("VAL-R2PROM-002 — a time that needs a call cannot close without one, and closes with one", () => {
    const refused = coverageCloseRefusal({
      status: "open",
      calls: 0,
      isDue: true,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe("needs_call");
      // The coordinator reads what is missing in plain words, and that the
      // refusal left the time alone.
      expect(refused.message.toLowerCase()).toContain("call");
      expect(refused.message.toLowerCase()).toContain("nothing was changed");
      expect(refused.message.toLowerCase()).not.toMatch(SHAME_WORDS);
    }

    // One recorded call opens the same close.
    expect(
      coverageCloseRefusal({ status: "open", calls: 1, isDue: true }).ok,
    ).toBe(true);

    // A time that has not promised a call yet closes exactly as before: the
    // card says it enters the watch later, so zero calls is not a broken
    // promise.
    expect(
      coverageCloseRefusal({ status: "open", calls: 0, isDue: false }).ok,
    ).toBe(true);

    // A time that is no longer published keeps the existing refusal, because
    // the call promise is not the reason it cannot close.
    const closed = coverageCloseRefusal({
      status: "expired_unclaimed",
      calls: 0,
      isDue: true,
    });
    expect(closed.ok).toBe(false);
    if (!closed.ok) {
      expect(closed.code).toBe("not_open");
      expect(closed.message).toBe(
        coverageExpiryRefusalCopy("expired_unclaimed"),
      );
    }
  });

  it("VAL-R2PROM-002 — the close path and the re-offer path share one call gate", () => {
    // Two entry points, one predicate: neither invents its own rule for
    // "a person has spoken with the family".
    const close = coverageCloseRefusal({
      status: "open",
      calls: 0,
      isDue: true,
    });
    const reoffer = coverageReofferRefusal({
      status: "open",
      calls: 0,
      reoffers: 0,
    });

    expect(close.ok).toBe(false);
    expect(reoffer.ok).toBe(false);
    if (!close.ok && !reoffer.ok) {
      expect(close.code).toBe("needs_call");
      expect(reoffer.code).toBe("needs_call");
    }
  });
});

describe("the call line on the failure card", () => {
  it("VAL-R2PROM-006 — names the responsible coordinator, never the viewer", () => {
    const line = coverageCallLeadLine({
      responsibleCoordinatorName: "Grace Whitfield",
      caregiverFirstName: "Marta",
    });
    expect(line).toBe("Grace Whitfield calls Marta; the app sends nothing.");

    // The same case read by the deputy and by a second coordinator produces
    // the same sentence. The viewer is not an input to this function, so the
    // only way to put a viewer's name here is to pass them as responsible.
    const deputyView = coverageCallLeadLine({
      responsibleCoordinatorName: "Grace Whitfield",
      caregiverFirstName: "Marta",
    });
    expect(deputyView).toBe(line);
    expect(deputyView).not.toContain("Daniel");
    expect(deputyView).not.toContain("Okafor");

    expect(line).toContain("the app sends nothing");
    expect(line.toLowerCase()).not.toMatch(GARBAGE_WORDS);
  });

  it("VAL-R2PROM-006 — says plainly that no coordinator is assigned, naming nobody", () => {
    const line = coverageCallLeadLine({
      responsibleCoordinatorName: null,
      caregiverFirstName: "Marta",
    });

    expect(line).toBe(
      "No coordinator is assigned to this family yet; the app sends nothing.",
    );
    // Nobody is named: not the seeded cast, not a role word standing in for a
    // person, and not the caregiver as a substitute.
    expect(line).not.toMatch(/Grace|Whitfield|Daniel|Okafor|Marta/);
    expect(line.toLowerCase()).not.toMatch(GARBAGE_WORDS);
  });
});

describe("the caregiver's human line", () => {
  it("names a person and a day, never a board concept", () => {
    const one = caregiverWorkingSentence(["Saturday"]);
    expect(one).toBe("Your coordinator is working on Saturday.");

    const two = caregiverWorkingSentence(["Saturday", "Tuesday"]);
    expect(two).toBe(
      "Your coordinator is working on Saturday and Tuesday.",
    );

    const three = caregiverWorkingSentence([
      "Saturday",
      "Sunday",
      "Tuesday",
    ]);
    expect(three).toBe(
      "Your coordinator is working on Saturday, Sunday, and Tuesday.",
    );

    expect(caregiverWorkingSentence([])).toBeNull();
    expect(caregiverWorkingSentence(["Saturday", "Saturday"])).toBe(
      "Your coordinator is working on Saturday.",
    );

    for (const sentence of [one, two, three]) {
      expect(sentence?.toLowerCase()).not.toMatch(GARBAGE_WORDS);
      expect(sentence?.toLowerCase()).not.toContain("count");
    }
  });
});

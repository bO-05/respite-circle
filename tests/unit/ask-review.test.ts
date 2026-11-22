import { describe, expect, it } from "vitest";
import {
  approveButtonLabel,
  ASK_NOT_WAITING_MESSAGE,
  canApproveAsk,
  canSendBackAsk,
  formatApprovalLine,
  publicationSummary,
  SEND_BACK_NOTE_MAX_LENGTH,
  validateSendBackNote,
} from "../../src/server/domain/ask-review";

/**
 * VAL-DESK-004 and VAL-DESK-005's pure rules.
 *
 * Only an ask that is still waiting for a coordinator can be approved or sent
 * back. A send-back requires a human note, and that note is kept exactly as it
 * was typed — no trim, no collapse, no smart quotes. The approval line is the
 * one a neighbour reads on the board, so its wording is pinned here.
 */

describe("ask review transitions", () => {
  it("approves only an ask that is waiting for a coordinator", () => {
    expect(canApproveAsk("waiting_coordinator")).toEqual({ ok: true });

    for (const status of [
      "draft",
      "safety_hold",
      "care_hold",
      "approved",
      "sent_back",
      "closed",
      "withdrawn",
      "not_a_status",
    ]) {
      const guard = canApproveAsk(status);
      expect(guard.ok).toBe(false);
      if (guard.ok) throw new Error("expected a refusal");
      expect(guard.reason).toBe("not_waiting");
      expect(guard.message).toBe(ASK_NOT_WAITING_MESSAGE);
    }
  });

  it("sends back only an ask that is waiting for a coordinator", () => {
    expect(canSendBackAsk("waiting_coordinator")).toEqual({ ok: true });

    for (const status of [
      "draft",
      "safety_hold",
      "care_hold",
      "approved",
      "sent_back",
      "closed",
      "withdrawn",
    ]) {
      expect(canSendBackAsk(status).ok).toBe(false);
    }
  });

  it("never offers approval to a held ask, so a safety or care hold cannot publish", () => {
    for (const status of ["safety_hold", "care_hold"]) {
      const guard = canApproveAsk(status);
      expect(guard.ok).toBe(false);
      if (!guard.ok) expect(guard.reason).toBe("not_waiting");
    }
  });
});

describe("send-back note", () => {
  it("requires a non-empty human note", () => {
    for (const value of [undefined, null, "", "   ", "\n\t ", 42, {}]) {
      const result = validateSendBackNote(value);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/write a short note/i);
      }
    }
  });

  it("keeps the note exactly as it was typed", () => {
    const note =
      "  Grace — thank you. Please call me on Thursday.\nI'm home after 2pm.  ";
    const result = validateSendBackNote(note);
    expect(result).toEqual({ ok: true, note });
    if (result.ok) {
      expect(result.note.startsWith("  ")).toBe(true);
      expect(result.note.endsWith("  ")).toBe(true);
      expect(result.note).toContain("Grace — thank you.");
    }
  });

  it("accepts a note at the limit and refuses one character more", () => {
    const atLimit = "x".repeat(SEND_BACK_NOTE_MAX_LENGTH);
    expect(validateSendBackNote(atLimit)).toEqual({ ok: true, note: atLimit });

    const tooLong = "x".repeat(SEND_BACK_NOTE_MAX_LENGTH + 1);
    const result = validateSendBackNote(tooLong);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/shorter|under/i);
  });

  it("normalises the form's CRLF newlines to the line breaks the writer saw", () => {
    const result = validateSendBackNote("First line.\r\n\r\nSecond line.\rThird?");
    expect(result).toEqual({
      ok: true,
      note: "First line.\n\nSecond line.\nThird?",
    });
  });
});

describe("approval line", () => {
  const approvedAt = new Date("2026-11-21T15:31:00.000Z"); // 10:31 in New York

  it("names the person and the church-local time", () => {
    expect(
      formatApprovalLine({
        approverFirstName: "Grace",
        approvedAt,
        timeZone: "America/New_York",
      }),
    ).toBe("Approved — Grace, Saturday 21 November 2026, 10:31");
  });

  it("uses the same instant in another church's timezone", () => {
    expect(
      formatApprovalLine({
        approverFirstName: "Grace",
        approvedAt,
        timeZone: "UTC",
      }),
    ).toBe("Approved — Grace, Saturday 21 November 2026, 15:31");
  });

  it("falls back to a plain human phrase when the name is absent", () => {
    expect(
      formatApprovalLine({
        approverFirstName: null,
        approvedAt,
        timeZone: "America/New_York",
      }),
    ).toBe("Approved — a person, Saturday 21 November 2026, 10:31");
  });

  it("says nothing at all when no approval has been recorded", () => {
    expect(
      formatApprovalLine({
        approverFirstName: "Grace",
        approvedAt: null,
        timeZone: "America/New_York",
      }),
    ).toBeNull();
  });
});

describe("publication copy", () => {
  it("counts only the times it actually published", () => {
    expect(publicationSummary(0, 0)).toMatch(/nothing was ready to publish/i);
    expect(publicationSummary(1, 0)).toMatch(/^Published 1 time\./);
    expect(publicationSummary(2, 0)).toMatch(/^Published 2 times\./);
  });

  it("names held times as unpublished rather than hiding them", () => {
    expect(publicationSummary(1, 1)).toContain(
      "One held time stayed unpublished with its reason.",
    );
    expect(publicationSummary(2, 2)).toContain(
      "2 held times stayed unpublished with their reasons.",
    );
  });

  it("labels the approve action with the exact number of times", () => {
    expect(approveButtonLabel(0)).toBe("Approve the ask");
    expect(approveButtonLabel(1)).toBe("Approve and publish 1 time");
    expect(approveButtonLabel(2)).toBe("Approve and publish 2 times");
  });
});

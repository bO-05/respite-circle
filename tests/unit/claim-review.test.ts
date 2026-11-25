import { describe, expect, it } from "vitest";
import {
  CLAIM_APPROVED_MESSAGE,
  CLAIM_REVOKED_MESSAGE,
  canApproveClaim,
  canRevokeClaim,
  claimReviewRefusalCopy,
  formatClaimConfirmationLine,
  REVOKE_REASON_MAX_LENGTH,
  validateRevokeReason,
} from "../../src/server/domain/claim-review";
import {
  CONFIRMATION_TEMPLATE_CODES,
  CONFIRMATION_TEMPLATES,
  confirmationKindFor,
  renderConfirmation,
  type ConfirmationKind,
} from "../../src/server/domain/notifications";
import { humanDateTime, humanWindow } from "../fixtures/human-window";

/**
 * VAL-CONFIRM-001, VAL-CONFIRM-002 and VAL-CLAIM-007 in the pure domain.
 *
 * The confirmation body is a fixed human template plus names a person entered.
 * Nothing here can produce a sentence from model output: the renderer only
 * substitutes four values into a constant, and every kind has its own code so
 * the outbox row can be traced to the exact template a human approved.
 */

const TIME_ZONE = "America/New_York";

const COMPANION_START = new Date("2026-11-24T15:00:00.000Z");
const COMPANION_END = new Date("2026-11-24T19:00:00.000Z");
const HOME_START = new Date("2026-11-28T15:00:00.000Z");
const HOME_END = new Date("2026-11-28T17:00:00.000Z");

/**
 * The human labels these assertions expect, derived from the fixture instants
 * above. No assertion in this file writes a calendar date out by hand.
 */
const COMPANION_DATE_TIME = humanDateTime(COMPANION_START, TIME_ZONE);
const HOME_LABEL = humanWindow(HOME_START, HOME_END, TIME_ZONE);

const FORBIDDEN_COPY =
  /sql|postgres|constraint|stack|model|provider|generated|AI-powered|record id|uuid/i;

function expectCalmCopy(text: string): void {
  expect(text).not.toMatch(FORBIDDEN_COPY);
  expect(text).not.toMatch(
    /\bplaces? left\b|\bremaining\b|\bviews?\b|\bviewed\b|\bdeclines?\b|\bdeclined\b|waiting time|\bunclaimed\b|scarcity/i,
  );
}

describe("claim review predicates", () => {
  it("approves only a claim a neighbour has already made", () => {
    expect(canApproveClaim({ status: "claimed", claimedBy: "ruth" })).toEqual({
      ok: true,
    });

    for (const status of ["draft", "open", "covered", "done", "cancelled"]) {
      const guard = canApproveClaim({ status, claimedBy: null });
      expect(guard.ok).toBe(false);
      if (!guard.ok) {
        expect(guard.code).toBe("not_claimed");
        expectCalmCopy(guard.message);
      }
    }
  });

  it("refuses a claimed status with no claimer as well", () => {
    const guard = canApproveClaim({ status: "claimed", claimedBy: null });
    expect(guard.ok).toBe(false);
  });

  it("revokes only a claim a neighbour has already made", () => {
    expect(canRevokeClaim({ status: "claimed", claimedBy: "ruth" })).toEqual({
      ok: true,
    });

    for (const status of ["draft", "open", "covered", "done", "cancelled"]) {
      const guard = canRevokeClaim({ status, claimedBy: null });
      expect(guard.ok).toBe(false);
    }
  });

  it("has a calm sentence for every state a coordinator can meet", () => {
    for (const status of [
      "draft",
      "open",
      "claimed",
      "covered",
      "done",
      "cancelled",
      "expired_unclaimed",
      "unknown",
    ]) {
      const copy = claimReviewRefusalCopy(status);
      expect(copy.length).toBeGreaterThan(20);
      expectCalmCopy(copy);
    }

    expect(claimReviewRefusalCopy("open")).toMatch(/no neighbour has said yes/i);
    expect(claimReviewRefusalCopy("covered")).toMatch(/already confirmed/i);
  });

  it("names a person, not a system, in its success lines", () => {
    expect(CLAIM_APPROVED_MESSAGE).toMatch(/family has one message/i);
    expect(CLAIM_REVOKED_MESSAGE).toMatch(/not sent anything/i);
    expect(CLAIM_APPROVED_MESSAGE).not.toMatch(/automatically|system/i);
  });
});

describe("the revoke reason", () => {
  it("requires a real human reason", () => {
    for (const value of ["", "   ", "\n\t ", undefined, null, 42]) {
      const result = validateRevokeReason(value);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/reason/i);
        expectCalmCopy(result.message);
      }
    }
  });

  it("keeps the reason exactly as typed, apart from form line endings", () => {
    const result = validateRevokeReason("  Ruth is unwell.\r\nWe will call her.  ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe("  Ruth is unwell.\nWe will call her.  ");
    }
  });

  it("refuses a reason past the readable limit", () => {
    const limit = validateRevokeReason("a".repeat(REVOKE_REASON_MAX_LENGTH));
    expect(limit.ok).toBe(true);

    const tooLong = validateRevokeReason(
      "a".repeat(REVOKE_REASON_MAX_LENGTH + 1),
    );
    expect(tooLong.ok).toBe(false);
  });
});

describe("the claim confirmation line", () => {
  it("is a different line from publication approval", () => {
    const line = formatClaimConfirmationLine({
      confirmerFirstName: "Grace",
      confirmedAt: COMPANION_START,
      timeZone: TIME_ZONE,
    });
    expect(line).toBe(`Confirmed — Grace, ${COMPANION_DATE_TIME}`);
    expect(line).not.toMatch(/^Approved/);
  });

  it("degrades to a human phrase, never an id, and refuses no date", () => {
    const line = formatClaimConfirmationLine({
      confirmerFirstName: null,
      confirmedAt: COMPANION_START,
      timeZone: TIME_ZONE,
    });
    expect(line).toBe(`Confirmed — a person, ${COMPANION_DATE_TIME}`);

    expect(
      formatClaimConfirmationLine({
        confirmerFirstName: "Grace",
        confirmedAt: null,
        timeZone: TIME_ZONE,
      }),
    ).toBeNull();
  });
});

describe("the human confirmation template", () => {
  it("recognises exactly the five slot kinds", () => {
    const kinds: ConfirmationKind[] = [
      "companion",
      "home",
      "drive",
      "meal",
      "errand",
    ];
    for (const kind of kinds) {
      expect(confirmationKindFor(kind)).toBe(kind);
      expect(CONFIRMATION_TEMPLATE_CODES[kind]).toBe(`confirmation.${kind}`);
      expect(CONFIRMATION_TEMPLATES[kind]).toMatch(/\{volunteerFirstName\}/);
    }
    expect(confirmationKindFor("personal_care")).toBeNull();
  });

  it("renders the companion message exactly as a person wrote it", () => {
    const rendered = renderConfirmation({
      kind: "companion",
      volunteerFirstName: "Ruth",
      careRecipientFirstName: "Elena",
      windowStart: COMPANION_START,
      windowEnd: COMPANION_END,
      timeZone: TIME_ZONE,
    });

    expect(rendered).toEqual({
      templateCode: "confirmation.companion",
      body: "Tuesday is covered — Elena has a place at Respite Morning, and Ruth will be their companion.",
    });
  });

  it("renders each kind with the volunteer's first name and slot details", () => {
    const expected: Record<ConfirmationKind, string> = {
      companion:
        "Tuesday is covered — Elena has a place at Respite Morning, and Ruth will be their companion.",
      home: `${HOME_LABEL} is covered — Ruth will visit Elena at home.`,
      drive: `${HOME_LABEL} is covered — Ruth will drive Elena to an appointment and wait, then bring them home.`,
      meal: `${HOME_LABEL} is covered — Ruth will bring a meal to Elena's door.`,
      errand: `${HOME_LABEL} is covered — Ruth will run an errand for Elena.`,
    };

    for (const kind of Object.keys(expected) as ConfirmationKind[]) {
      const rendered = renderConfirmation({
        kind,
        volunteerFirstName: "Ruth",
        careRecipientFirstName: "Elena",
        windowStart: kind === "companion" ? COMPANION_START : HOME_START,
        windowEnd: kind === "companion" ? COMPANION_END : HOME_END,
        timeZone: TIME_ZONE,
      });

      expect(rendered?.body).toBe(expected[kind]);
      expect(rendered?.body).toContain("Ruth");
      expect(rendered?.body).toContain("Elena");
      expect(rendered?.body).not.toContain("{");
      expect(rendered?.body).not.toContain("}");
      expect(rendered?.templateCode).toBe(`confirmation.${kind}`);
      expectCalmCopy(rendered?.body ?? "");
    }
  });

  it("uses the church's own weekday for a companion morning", () => {
    // 00:30 UTC on Sunday is still Saturday evening in New York.
    const rendered = renderConfirmation({
      kind: "companion",
      volunteerFirstName: "Ruth",
      careRecipientFirstName: "Elena",
      windowStart: new Date("2026-11-29T00:30:00.000Z"),
      windowEnd: new Date("2026-11-29T02:30:00.000Z"),
      timeZone: TIME_ZONE,
    });
    expect(rendered?.body.startsWith("Saturday is covered")).toBe(true);
  });

  it("stays a human sentence when no window has been chosen", () => {
    const rendered = renderConfirmation({
      kind: "companion",
      volunteerFirstName: "Ruth",
      careRecipientFirstName: "Elena",
      windowStart: null,
      windowEnd: null,
      timeZone: TIME_ZONE,
    });
    expect(rendered?.body).toBe(
      "The time is covered — Elena has a place at Respite Morning, and Ruth will be their companion.",
    );
  });

  it("refuses an unknown kind instead of inventing prose", () => {
    const rendered = renderConfirmation({
      kind: "personal_care",
      volunteerFirstName: "Ruth",
      careRecipientFirstName: "Elena",
      windowStart: COMPANION_START,
      windowEnd: COMPANION_END,
      timeZone: TIME_ZONE,
    });
    expect(rendered).toBeNull();
  });
});

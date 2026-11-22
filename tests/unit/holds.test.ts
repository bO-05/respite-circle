import { describe, expect, it } from "vitest";
import type { ReferralResource } from "../../src/db/schema";
import {
  ARCH_REFERRAL,
  AREA_AGENCY_REFERRAL,
  canCloseHeldAsk,
  canOverrideHold,
  CLOSE_NOTE_MAX_LENGTH,
  holdCardFor,
  isHoldStatus,
  NO_REPORT_SENTENCE,
  OVERRIDE_CONFIRMATION_VALUE,
  OVERRIDE_REASON_MAX_LENGTH,
  personalCareFlagged,
  safetyFlagged,
  validateCloseNote,
  validateOverride,
} from "../../src/server/domain/holds";

/**
 * VAL-SAFETY-002 through VAL-SAFETY-006 at the pure-rule layer.
 *
 * The safety card must carry a human script, 988, and the church's own local
 * line; the personal-care card must carry the ARCH Respite Locator and the
 * Area Agency on Aging. Personal care can never be overridden, and no card may
 * imply that a report of abuse has been made.
 */

const policy = {
  crisisScript:
    "If anything in the ask suggests immediate danger, stop and tell the caregiver that a person will call today. For danger to life, call 911 now. For emotional crisis support in the United States, call or text 988 at any hour.",
  localCrisisLine: "(202) 555-0142 — Grace Community Church on-call line, answered any hour.",
  referralResources: [
    {
      name: "988 Suicide & Crisis Lifeline",
      detail: "Call or text 988, any hour, for emotional crisis support.",
      phone: "988",
    },
    {
      name: "ARCH National Respite Network",
      detail: "Respite referrals and caregiver support across the United States.",
      url: "https://archrespite.org",
    },
    {
      name: "Area Agency on Aging",
      detail: "Local aging and disability services in your county.",
    },
  ] satisfies ReferralResource[],
};

function allCardText(card: NonNullable<ReturnType<typeof holdCardFor>>): string {
  return [
    card.title,
    card.lead,
    ...card.script,
    card.crisisScript,
    ...card.crisis.map((entry) => `${entry.name} ${entry.detail} ${entry.phone ?? ""}`),
    ...card.referrals.map((entry) => `${entry.name} ${entry.detail} ${entry.phone ?? ""} ${entry.url ?? ""}`),
    card.noSlotsSentence,
    card.noReportSentence ?? "",
  ].join("\n");
}

describe("hold statuses", () => {
  it("recognises exactly the two human-only holds", () => {
    expect(isHoldStatus("safety_hold")).toBe(true);
    expect(isHoldStatus("care_hold")).toBe(true);
    expect(isHoldStatus("waiting_coordinator")).toBe(false);
    expect(isHoldStatus("approved")).toBe(false);
    expect(isHoldStatus("closed")).toBe(false);
  });

  it("allows an override only for a safety hold", () => {
    expect(canOverrideHold("safety_hold")).toBe(true);
    expect(canOverrideHold("care_hold")).toBe(false);
    expect(canOverrideHold("waiting_coordinator")).toBe(false);
    expect(canOverrideHold("closed")).toBe(false);
  });

  it("lets a coordinator close a held ask, never a settled one", () => {
    expect(canCloseHeldAsk("safety_hold")).toBe(true);
    expect(canCloseHeldAsk("care_hold")).toBe(true);
    expect(canCloseHeldAsk("waiting_coordinator")).toBe(false);
    expect(canCloseHeldAsk("approved")).toBe(false);
    expect(canCloseHeldAsk("closed")).toBe(false);
  });
});

describe("the safety card", () => {
  it("carries a human script, 988, and the configured local line", () => {
    const card = holdCardFor("safety_hold", policy);
    expect(card).not.toBeNull();
    if (!card) return;

    expect(card.kind).toBe("safety");
    expect(card.script.length).toBeGreaterThanOrEqual(3);
    expect(card.script.join(" ")).toMatch(/call the family today/i);
    expect(card.crisisScript).toBe(policy.crisisScript);

    const crisisText = card.crisis
      .map((entry) => `${entry.name} ${entry.detail} ${entry.phone ?? ""}`)
      .join(" ");
    expect(crisisText).toMatch(/988/);
    expect(crisisText).toContain(policy.localCrisisLine);
    expect(crisisText).toMatch(/911/);
  });

  it("follows the church's configured local line", () => {
    const other = holdCardFor("safety_hold", {
      ...policy,
      localCrisisLine: "(555) 555-0199 — St Elsewhere night line.",
    });
    expect(other).not.toBeNull();
    expect(
      other?.crisis.map((entry) => entry.detail).join(" "),
    ).toContain("(555) 555-0199 — St Elsewhere night line.");
    expect(
      other?.crisis.map((entry) => entry.detail).join(" "),
    ).not.toContain("(202) 555-0142");
  });

  it("still shows a local-line row when the church has not saved one", () => {
    const card = holdCardFor("safety_hold", {
      ...policy,
      localCrisisLine: null,
    });
    expect(card).not.toBeNull();
    const text = allCardText(card!);
    expect(text).toMatch(/988/);
    expect(text).toMatch(/no local line is saved yet/i);
  });

  it("says plainly that no report has been made", () => {
    const card = holdCardFor("safety_hold", policy);
    expect(card).not.toBeNull();
    if (!card) return;

    expect(card.noReportSentence).toBe(NO_REPORT_SENTENCE);
    expect(card.noReportSentence).toMatch(/^No report has been made/);
    expect(card.noReportSentence).toMatch(/does not contact the police/i);
    expect(card.noReportSentence).toMatch(/911/);

    // No other field may mention a report at all, so no screen can imply one
    // was made outside the explicit denial.
    const rest = allCardText({ ...card, noReportSentence: null });
    expect(rest).not.toMatch(/report/i);
  });

  it("never proposes a time and says so", () => {
    const card = holdCardFor("safety_hold", policy);
    expect(card?.noSlotsSentence).toMatch(/no time/i);
    expect(card?.noSlotsSentence).toMatch(/call/i);
  });
});

describe("the personal-care card", () => {
  it("shows the ARCH Respite Locator and the Area Agency on Aging", () => {
    const card = holdCardFor("care_hold", policy);
    expect(card).not.toBeNull();
    if (!card) return;

    expect(card.kind).toBe("personal_care");
    const names = card.referrals.map((entry) => entry.name).join(" · ");
    expect(names).toMatch(/ARCH/);
    expect(names).toMatch(/Area Agency on Aging/);

    const text = allCardText(card);
    expect(text).toMatch(/personal care/i);
    expect(text).toMatch(/no .*slot|no time/i);
  });

  it("keeps both referrals even when a policy version drops them", () => {
    const card = holdCardFor("care_hold", {
      ...policy,
      referralResources: [
        { name: "A local charity", detail: "A local help line." },
      ],
    });
    expect(card).not.toBeNull();
    const text = allCardText(card!);
    expect(text).toContain(ARCH_REFERRAL.name);
    expect(text).toContain(AREA_AGENCY_REFERRAL.name);
    expect(text).toContain("A local charity");
  });

  it("does not show the crisis script or the local line", () => {
    const card = holdCardFor("care_hold", policy);
    expect(card).not.toBeNull();
    if (!card) return;
    expect(card.crisisScript).toBe("");
    expect(card.crisis).toHaveLength(0);
    expect(allCardText(card)).not.toContain("(202) 555-0142");
  });

  it("offers no override, ever", () => {
    const card = holdCardFor("care_hold", policy);
    expect(card?.overrideAllowed).toBe(false);
  });
});

describe("holdCardFor", () => {
  it("returns nothing for an ask that is not held", () => {
    expect(holdCardFor("waiting_coordinator", policy)).toBeNull();
    expect(holdCardFor("approved", policy)).toBeNull();
    expect(holdCardFor("closed", policy)).toBeNull();
  });
});

describe("the override validator", () => {
  const reason = "I called Marta. She is safe tonight; the fall was last week and a neighbour is with her.";

  it("requires an explicit confirmation, not just a reason", () => {
    const missing = validateOverride({ confirmation: "", reason });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.field).toBe("confirm");

    const wrong = validateOverride({ confirmation: "maybe", reason });
    expect(wrong.ok).toBe(false);

    const confirmed = validateOverride({
      confirmation: OVERRIDE_CONFIRMATION_VALUE,
      reason,
    });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.reason).toBe(reason);
  });

  it("requires a real reason and never trims the stored words", () => {
    const blank = validateOverride({
      confirmation: OVERRIDE_CONFIRMATION_VALUE,
      reason: "   \n  ",
    });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.field).toBe("reason");

    const typed = "  Called the family at 4pm.  ";
    const kept = validateOverride({
      confirmation: OVERRIDE_CONFIRMATION_VALUE,
      reason: typed,
    });
    expect(kept.ok).toBe(true);
    if (kept.ok) expect(kept.reason).toBe(typed);
  });

  it("normalises the textarea's CRLF transport only", () => {
    const input = "Line one\r\nLine two\rLine three";
    const result = validateOverride({
      confirmation: OVERRIDE_CONFIRMATION_VALUE,
      reason: input,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reason).toBe("Line one\nLine two\nLine three");
  });

  it("refuses a reason longer than the limit", () => {
    const result = validateOverride({
      confirmation: OVERRIDE_CONFIRMATION_VALUE,
      reason: "x".repeat(OVERRIDE_REASON_MAX_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("reason");
  });
});

describe("the close-note validator", () => {
  it("requires human words", () => {
    for (const value of ["", "   ", null, undefined, 42]) {
      const result = validateCloseNote(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.field).toBe("note");
    }
  });

  it("keeps the coordinator's words exactly as typed", () => {
    const typed = "  Marta, I am sorry this week has been so heavy.\n\nCall me after 3pm.  ";
    const result = validateCloseNote(typed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.note).toBe(typed);
  });

  it("normalises CRLF and refuses an oversized note", () => {
    const result = validateCloseNote("One\r\nTwo");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.note).toBe("One\nTwo");

    const tooLong = validateCloseNote("x".repeat(CLOSE_NOTE_MAX_LENGTH + 1));
    expect(tooLong.ok).toBe(false);
  });
});

describe("typed-flag readers", () => {
  const answers = (q9: unknown, abstained = false) => [
    { questionId: "Q1", answer: true, abstained: false },
    { questionId: "Q9", answer: q9, abstained },
  ];

  it("flags personal care on a yes or an abstention", () => {
    expect(personalCareFlagged(answers(true))).toBe(true);
    expect(personalCareFlagged(answers(false, true))).toBe(true);
    expect(personalCareFlagged(answers(false))).toBe(false);
    expect(personalCareFlagged([{ questionId: "Q1", answer: true, abstained: false }])).toBe(
      false,
    );
  });

  it("flags safety on a yes or an abstention", () => {
    const q5 = (value: unknown, abstained = false) => [
      { questionId: "Q5", answer: value, abstained },
    ];
    expect(safetyFlagged(q5(true))).toBe(true);
    expect(safetyFlagged(q5(false, true))).toBe(true);
    expect(safetyFlagged(q5(false))).toBe(false);
  });
});

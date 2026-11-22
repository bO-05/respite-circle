import { describe, expect, it } from "vitest";
import {
  askAgainHint,
  canAskAgain,
  canCloseAsk,
  canLeaveThankYou,
  CARE_THANKS_FLASH_CODES,
  careThanksFlashMessage,
  careThankYouHeading,
  closureLead,
  closureTitle,
  isCareThanksFlashCode,
  THANK_YOU_MAX_LENGTH,
  thankYouHeading,
  thankYouSavedLine,
  validateThankYou,
} from "../../src/server/domain/closure";

/**
 * VAL-CONFIRM-005: closing one covered time.
 *
 * The predicates are the contract: a thank-you belongs only to a time that is
 * actually done, and an ask closes only when none of its published times is
 * still live. The copy tests pin the calm sentences a tired caregiver and a
 * volunteer read: a skipped thank-you is never framed as a loss, and no count,
 * timer, chase, or story word appears.
 */

const METRIC_WORDS =
  /places? left|remaining|spaces? left|views?|viewed|declines?|declined|waiting time|unclaimed|scarcity|only\s+\d/i;

const STORY_WORDS =
  /diagnos|medication list|verbatim|her words|his words|what she wrote|what he wrote/i;

function expectCalmCopy(text: string): void {
  expect(text.toLowerCase()).not.toMatch(METRIC_WORDS);
  expect(text.toLowerCase()).not.toMatch(STORY_WORDS);
}

describe("the thank-you validator", () => {
  it("treats an absent, blank, or whitespace-only thank-you as simply skipped", () => {
    for (const value of [undefined, null, "", "   ", "\n\t "]) {
      expect(validateThankYou(value)).toEqual({ ok: true, note: null });
    }
  });

  it("keeps a submitted thank-you exactly as typed", () => {
    const typed = "  Thank you, Ruth. The tea and the hymns made her morning.  ";
    expect(validateThankYou(typed)).toEqual({ ok: true, note: typed });
  });

  it("normalises only the textarea's CRLF transport, and nothing else", () => {
    expect(validateThankYou("Thank you.\r\nIt mattered.\r")).toEqual({
      ok: true,
      note: "Thank you.\nIt mattered.\n",
    });
  });

  it("refuses a thank-you longer than the calm maximum", () => {
    const long = "a".repeat(THANK_YOU_MAX_LENGTH + 1);
    const result = validateThankYou(long);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(String(THANK_YOU_MAX_LENGTH));
      expectCalmCopy(result.message);
    }
  });

  it("accepts a thank-you exactly at the maximum", () => {
    const atLimit = "a".repeat(THANK_YOU_MAX_LENGTH);
    expect(validateThankYou(atLimit)).toEqual({ ok: true, note: atLimit });
  });
});

describe("who may leave a thank-you and ask again", () => {
  it("opens only after the time is done", () => {
    expect(canLeaveThankYou("done")).toBe(true);
    expect(canAskAgain("done")).toBe(true);
  });

  it("is closed for every time that has not finished", () => {
    for (const status of [
      "draft",
      "open",
      "claimed",
      "covered",
      "cancelled",
      "expired_unclaimed",
    ]) {
      expect(canLeaveThankYou(status)).toBe(false);
      expect(canAskAgain(status)).toBe(false);
    }
  });
});

describe("when an ask closes", () => {
  it("closes when no published time is live and at least one has finished", () => {
    expect(canCloseAsk({ live: 0, closed: 1 })).toBe(true);
    expect(canCloseAsk({ live: 0, closed: 2 })).toBe(true);
  });

  it("stays open while any published time is still live", () => {
    expect(canCloseAsk({ live: 1, closed: 1 })).toBe(false);
    expect(canCloseAsk({ live: 2, closed: 0 })).toBe(false);
  });

  it("does not close an ask that never offered a time", () => {
    expect(canCloseAsk({ live: 0, closed: 0 })).toBe(false);
  });
});

describe("the closure copy", () => {
  it("titles a finished and an unfinished closure plainly", () => {
    expect(closureTitle("done")).toBe("This time is closed");
    expect(closureTitle("covered")).toBe("Closing this time");
    expect(closureTitle("cancelled")).toBe("This time is closed");
    expectCalmCopy(closureTitle("covered"));
  });

  it("thanks the volunteer without a count, a chase, or a story", () => {
    const done = closureLead("done", "Grace");
    expect(done).toMatch(/thank you/i);
    expect(done).toMatch(/thank-you|ask again/i);
    expect(done).toMatch(/nothing else/i);
    expectCalmCopy(done);
  });

  it("keeps the premature case calm and names the coordinator", () => {
    const covered = closureLead("covered", "Grace");
    expect(covered).toMatch(/passed/i);
    expectCalmCopy(covered);

    const claimed = closureLead("claimed", "Grace");
    expect(claimed).toMatch(/Grace/);
    expectCalmCopy(claimed);
  });

  it("names no next action on a cancelled time", () => {
    const cancelled = closureLead("cancelled", "Grace");
    expect(cancelled).toMatch(/cancelled/i);
    expect(cancelled).toMatch(/nothing is needed|nothing else/i);
    expectCalmCopy(cancelled);
  });

  it("frames the caregiver's thank-you as optional and the ask-again as a fresh page", () => {
    expect(thankYouHeading()).toBe("A thank-you from the family");
    expect(careThankYouHeading()).toBe("Your thank-you");
    expect(careThankYouHeading()).not.toMatch(/from the family/i);
    expect(careThanksFlashMessage("skipped", "Ruth")).toMatch(/that is/i);
    expect(careThanksFlashMessage("skipped", "Ruth")).not.toMatch(/miss|should|still/i);
    expect(askAgainHint()).toMatch(/empty page/i);
    expect(askAgainHint()).toMatch(/earlier words/i);
    expect(thankYouSavedLine("Ruth")).toContain("Ruth");
    expectCalmCopy(askAgainHint());
  });

  it("has one closed code set for the caregiver flash", () => {
    for (const code of CARE_THANKS_FLASH_CODES) {
      expect(isCareThanksFlashCode(code)).toBe(true);
      expectCalmCopy(careThanksFlashMessage(code, "Ruth"));
    }
    expect(isCareThanksFlashCode("something-else")).toBe(false);
  });
});

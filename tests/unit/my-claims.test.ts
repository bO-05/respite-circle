import { describe, expect, it } from "vitest";
import {
  canCheckIn,
  canCheckOut,
  canMarkDone,
  isMyClaimStatus,
  isVisitAction,
  isVisitFlashCode,
  myClaimEmptyCopy,
  myClaimExpectationCopy,
  myClaimNoteMissingCopy,
  myClaimNotePendingCopy,
  myClaimStatusCopy,
  noteIsVisible,
  visitFlashMessage,
} from "../../src/server/domain/my-claims";
import { SLOT_KINDS } from "../../src/server/domain/slots";

/**
 * VAL-CLAIM-005 and the calm-copy rules around a volunteer's own claims.
 *
 * The predicate is the contract: a note is readable only when the coordinator
 * has approved the claim (`covered`) or the visit is over (`done`). It is never
 * readable for an open, draft, claimed, cancelled, or expired time. The copy
 * tests pin the human sentences a tired volunteer reads: no counts, no
 * shaming, no story before the note is due, and an empty state that names the
 * next person to speak to.
 */

const METRIC_WORDS =
  /places? left|remaining|spaces? left|views?|viewed|declines?|declined|waiting time|unclaimed|scarcity|only\s+\d/i;

const STORY_WORDS =
  /diagnos|medication list|verbatim|her words|his words|what she wrote|what he wrote/i;

function expectCalmCopy(text: string): void {
  expect(text.toLowerCase()).not.toMatch(METRIC_WORDS);
  expect(text.toLowerCase()).not.toMatch(STORY_WORDS);
}

describe("the orientation-note predicate", () => {
  it("opens only after coordinator approval and stays open once done", () => {
    expect(noteIsVisible("covered")).toBe(true);
    expect(noteIsVisible("done")).toBe(true);
  });

  it("is closed for every pre-approval, cancelled, and unclaimed state", () => {
    for (const status of [
      "draft",
      "open",
      "claimed",
      "cancelled",
      "expired_unclaimed",
    ]) {
      expect(noteIsVisible(status)).toBe(false);
    }
  });
});

describe("a volunteer's claim status", () => {
  it("recognises exactly the four statuses that belong on this page", () => {
    for (const status of ["claimed", "covered", "done", "cancelled"] as const) {
      expect(isMyClaimStatus(status)).toBe(true);
    }
    for (const status of ["draft", "open", "expired_unclaimed", "safety"]) {
      expect(isMyClaimStatus(status)).toBe(false);
    }
  });

  it("names the coordinator in a claimed or covered line", () => {
    expect(myClaimStatusCopy("claimed", "Grace").label).toBe(
      "Claimed — waiting for Grace",
    );
    expect(myClaimStatusCopy("covered", "Grace").label).toBe(
      "Covered — Grace confirmed it",
    );
    expect(myClaimStatusCopy("claimed", null).label).toBe(
      "Claimed — waiting for your coordinator",
    );
  });

  it("closes the loop in plain words without a score or a count", () => {
    expect(myClaimStatusCopy("done", "Grace").label).toBe("Done — thank you");
    expect(myClaimStatusCopy("cancelled", "Grace").label).toBe(
      "Cancelled by the church",
    );

    for (const status of ["claimed", "covered", "done", "cancelled"] as const) {
      const copy = myClaimStatusCopy(status, "Grace");
      expectCalmCopy(copy.label);
    }
  });
});

describe("what to expect before the note arrives", () => {
  it("tells the volunteer the note comes after confirmation and nothing comes before", () => {
    const pending = myClaimNotePendingCopy("Grace");
    expect(pending).toMatch(/Grace/);
    expect(pending).toMatch(/confirm/i);
    expect(pending).toMatch(/orientation note/i);
    expect(pending).toMatch(/nothing about the family/i);
    expectCalmCopy(pending);
  });

  it("names the human to ask when no note was written", () => {
    const missing = myClaimNoteMissingCopy("Grace");
    expect(missing).toMatch(/Grace/);
    expect(missing).toMatch(/ask/i);
    expectCalmCopy(missing);
  });

  it("gives every kind a plain expectation sentence", () => {
    for (const kind of SLOT_KINDS) {
      const copy = myClaimExpectationCopy(kind);
      expect(copy.length).toBeGreaterThan(20);
      expectCalmCopy(copy);
    }
    expect(myClaimExpectationCopy("home")).toMatch(/home|visit/i);
    expect(myClaimExpectationCopy("meal")).toMatch(/door/i);
    expect(myClaimExpectationCopy("home")).toMatch(/companionship|company/i);
  });
});

describe("home-visit check-in and check-out", () => {
  const emptyVisit = { checkedInAt: null, checkedOutAt: null };

  it("is offered on a confirmed home visit and refused elsewhere", () => {
    expect(
      canCheckIn({
        kind: "home",
        status: "covered",
        visit: emptyVisit,
      }).ok,
    ).toBe(true);

    const companion = canCheckIn({
      kind: "companion",
      status: "covered",
      visit: emptyVisit,
    });
    expect(companion.ok).toBe(false);
    if (!companion.ok) expect(companion.code).toBe("not_home");

    const waiting = canCheckIn({
      kind: "home",
      status: "claimed",
      visit: emptyVisit,
    });
    expect(waiting.ok).toBe(false);
    if (!waiting.ok) {
      expect(waiting.code).toBe("not_covered");
      expect(waiting.message).toMatch(/confirm/i);
    }
  });

  it("checks in once and then checks out once", () => {
    const checkedIn = { checkedInAt: new Date("2026-11-21T15:00:00.000Z"), checkedOutAt: null };
    const duplicate = canCheckIn({
      kind: "home",
      status: "covered",
      visit: checkedIn,
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.code).toBe("already_checked_in");

    expect(
      canCheckOut({ kind: "home", status: "covered", visit: checkedIn }).ok,
    ).toBe(true);

    const beforeCheckIn = canCheckOut({
      kind: "home",
      status: "covered",
      visit: emptyVisit,
    });
    expect(beforeCheckIn.ok).toBe(false);
    if (!beforeCheckIn.ok) {
      expect(beforeCheckIn.code).toBe("not_checked_in");
      expect(beforeCheckIn.message).toMatch(/check in/i);
    }

    const afterCheckOut = canCheckOut({
      kind: "home",
      status: "covered",
      visit: {
        checkedInAt: checkedIn.checkedInAt,
        checkedOutAt: new Date("2026-11-21T17:00:00.000Z"),
      },
    });
    expect(afterCheckOut.ok).toBe(false);
    if (!afterCheckOut.ok) expect(afterCheckOut.code).toBe("already_checked_out");
  });

  it("refuses check-in on a finished time", () => {
    const done = canCheckIn({
      kind: "home",
      status: "done",
      visit: emptyVisit,
    });
    expect(done.ok).toBe(false);
    if (!done.ok) expect(done.code).toBe("not_covered");
  });

  it("keeps every visit sentence calm and human", () => {
    const checks = [
      canCheckIn({ kind: "companion", status: "covered", visit: emptyVisit }),
      canCheckIn({ kind: "home", status: "claimed", visit: emptyVisit }),
      canCheckOut({ kind: "home", status: "covered", visit: emptyVisit }),
    ];
    for (const check of checks) {
      if (!check.ok) expectCalmCopy(check.message);
    }
    expect(visitFlashMessage("checked_in", "Grace")).toMatch(/checked in/i);
    expect(visitFlashMessage("checked_out", "Grace")).toMatch(/checked out/i);
    expectCalmCopy(visitFlashMessage("checked_out", "Grace"));
  });

  it("accepts only the two closed actions and the closed flash codes", () => {
    expect(isVisitAction("check_in")).toBe(true);
    expect(isVisitAction("check_out")).toBe(true);
    expect(isVisitAction("checkin")).toBe(false);
    expect(isVisitAction(undefined)).toBe(false);
    expect(isVisitFlashCode("checked_in")).toBe(true);
    expect(isVisitFlashCode("DROP TABLE")).toBe(false);
  });
});

describe("marking a claim done", () => {
  const BEFORE = new Date("2026-11-21T16:00:00.000Z");
  const AFTER = new Date("2026-11-21T19:00:00.000Z");

  const covered = {
    status: "covered",
    windowStart: new Date("2026-11-21T15:00:00.000Z"),
    windowEnd: new Date("2026-11-21T17:00:00.000Z"),
  };

  it("is offered only after the slot's window has passed", () => {
    const early = canMarkDone(covered, BEFORE, "Grace");
    expect(early.ok).toBe(false);
    if (!early.ok) {
      expect(early.code).toBe("too_early");
      expect(early.message).toMatch(/after the time/i);
    }
    expect(canMarkDone(covered, AFTER, "Grace").ok).toBe(true);
  });

  it("uses the window start when there is no end and allows an open window", () => {
    expect(
      canMarkDone(
        {
          status: "covered",
          windowStart: new Date("2026-11-21T15:00:00.000Z"),
          windowEnd: null,
        },
        AFTER,
        "Grace",
      ).ok,
    ).toBe(true);
    expect(
      canMarkDone(
        { status: "covered", windowStart: null, windowEnd: null },
        BEFORE,
        "Grace",
      ).ok,
    ).toBe(true);
  });

  it("refuses a claim the coordinator has not confirmed, and a finished one", () => {
    const waiting = canMarkDone({ ...covered, status: "claimed" }, AFTER, "Grace");
    expect(waiting.ok).toBe(false);
    if (!waiting.ok) {
      expect(waiting.code).toBe("not_covered");
      expect(waiting.message).toMatch(/Grace/);
    }

    const again = canMarkDone({ ...covered, status: "done" }, AFTER, "Grace");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("already_done");
  });
});

describe("the empty claims list", () => {
  it("names the next human action and links to the board", () => {
    const empty = myClaimEmptyCopy("Grace");
    expect(empty.title).toMatch(/nothing claimed/i);
    expect(empty.body).toMatch(/Grace/);
    expect(empty.body).toMatch(/tell|ask|speak/i);
    expect(empty.href).toBe("/circle");
    expect(empty.linkLabel.length).toBeGreaterThan(0);
    expectCalmCopy(empty.title);
    expectCalmCopy(empty.body);
  });

  it("degrades to a human phrase when no coordinator name is known", () => {
    const empty = myClaimEmptyCopy(null);
    expect(empty.body).toMatch(/your coordinator/i);
    expect(empty.body).not.toMatch(/null|undefined/i);
  });
});

import { describe, expect, it } from "vitest";
import {
  BOARD_ACTION_LABEL,
  boardClaimedHint,
  boardClaimHint,
  boardClaimStateCopy,
  boardEmptyCopy,
  boardGatedLine,
  boardKindCopy,
  boardLockCopy,
} from "../../src/server/domain/board";
import { RULE_CODES, type RuleCode } from "../../src/server/domain/gating";
import { SLOT_KINDS, type SlotKind } from "../../src/server/domain/slots";

/**
 * VAL-BOARD-001, VAL-BOARD-003, VAL-BOARD-004, VAL-BOARD-005, and VAL-BOARD-006
 * on the pure copy layer.
 *
 * The board shows a time a neighbour can take, never a story and never a
 * number that shames a family. These tests pin the words that appear on a slot
 * card: the kind, the location, the shape of the place, the calm claimed state,
 * the lock reason with the concrete thing that would unlock it, and an empty
 * state that names the next human action.
 */

const METRIC_WORDS =
  /places? left|remaining|spaces? left|views?|viewed|declines?|declined|waiting time|unclaimed|queue|scarcity|only\s+\d/i;

const STORY_WORDS =
  /diagnos|medication|dementia|depress|anxiety|verbatim|orientation|caregiver name|recipient/i;

function expectCalmCopy(text: string): void {
  expect(text.toLowerCase()).not.toMatch(METRIC_WORDS);
  expect(text.toLowerCase()).not.toMatch(STORY_WORDS);
}

describe("board kind copy", () => {
  it("gives every kind a human word, a location, and the shape of the place", () => {
    for (const kind of SLOT_KINDS) {
      const copy = boardKindCopy(kind);
      expect(copy.word.length).toBeGreaterThan(0);
      expect(copy.location.length).toBeGreaterThan(0);
      expect(copy.capacity.length).toBeGreaterThan(0);
      expectCalmCopy(copy.word);
      expectCalmCopy(copy.location);
      expectCalmCopy(copy.capacity);
    }
  });

  it("describes a group morning differently from a one-to-one visit", () => {
    expect(boardKindCopy("companion").capacity).toMatch(/shared|table|morning/i);
    expect(boardKindCopy("home").capacity).toMatch(/one/i);
    expect(boardKindCopy("meal").capacity).toMatch(/one/i);
  });

  it("names the in-home and driver requirements without a promise it cannot keep", () => {
    const home = boardGatedLine("home");
    const drive = boardGatedLine("drive");
    expect(home).toMatch(/familiar|safeguarding/i);
    expect(home).toMatch(/first visit|two people|introduc/i);
    expect(drive).toMatch(/driver policy|licence|insurance/i);
    expect(boardGatedLine("companion")).toBeNull();
    expect(boardGatedLine("meal")).toBeNull();
    expect(boardGatedLine("errand")).toBeNull();
  });
});

describe("board status copy", () => {
  it("shows a calm claimed state naming the coordinator, and a calm covered state", () => {
    expect(boardClaimStateCopy("claimed", "Grace")).toBe(
      "Waiting for Grace to confirm",
    );
    expect(boardClaimStateCopy("claimed", null)).toBe(
      "Waiting for a coordinator to confirm",
    );
    expect(boardClaimStateCopy("covered", "Grace")).toBe("Covered");
    expect(boardClaimStateCopy("open", "Grace")).toBeNull();
  });

  it("never puts a count or a claimant's note in a status", () => {
    for (const status of ["claimed", "covered"] as const) {
      expectCalmCopy(boardClaimStateCopy(status, "Grace") ?? "");
    }
  });
});

describe("board lock copy", () => {
  const blockedCodes = RULE_CODES.filter(
    (code): code is Exclude<RuleCode, "eligible"> => code !== "eligible",
  );

  it("explains every refusal in second person and names what would unlock it", () => {
    for (const code of blockedCodes) {
      const copy = boardLockCopy(code, "Grace");
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.unlock.length).toBeGreaterThan(0);
      expect(copy.title).not.toMatch(/\bthey\b|\btheir\b/i);
      expect(copy.unlock).toMatch(/Grace|coordinator|church/i);
      expectCalmCopy(`${copy.title} ${copy.unlock}`);
    }
  });

  it("uses the named coordinator when there is one and a plain role when there is not", () => {
    expect(boardLockCopy("no_checklist", "Grace").unlock).toContain("Grace");
    // Mid-sentence the fallback stays lower case; only a sentence opener is
    // capitalised (VAL-R2UI-006).
    expect(boardLockCopy("no_checklist", null).unlock).toContain(
      "Ask your coordinator to record",
    );
    expect(boardLockCopy("no_checklist", null).unlock).not.toContain(
      "Your coordinator",
    );
  });

  it("explains the in-home gate and the driver gate in the family's terms", () => {
    expect(boardLockCopy("not_familiar", "Grace").unlock).toMatch(
      /familiar-faces list|safeguarding checklist/i,
    );
    expect(boardLockCopy("checklist_expired", "Grace").unlock).toMatch(
      /renew/i,
    );
    expect(boardLockCopy("no_driver_policy", "Grace").unlock).toMatch(
      /driver/i,
    );
  });

  it("calls a time close to the family one that is not the viewer's to take", () => {
    expect(boardLockCopy("recipient_not_eligible", "Grace").title).toBe(
      "This one is not yours to take.",
    );
  });
});

describe("board claim action", () => {
  it("offers one plain action with the volunteer's own verb", () => {
    expect(BOARD_ACTION_LABEL).toBe("I'll take this time");
    expect(boardClaimHint("Grace")).toBe(
      "Grace will confirm it with you before the time is covered.",
    );
    // VAL-R2UI-006: the fallback opens the sentence, so it is capitalised.
    expect(boardClaimHint(null)).toBe(
      "Your coordinator will confirm it with you before the time is covered.",
    );
  });

  it("names the coordinator under a time someone has taken", () => {
    expect(boardClaimedHint("Grace")).toBe(
      "Grace confirms a taken time before it is covered.",
    );
    expect(boardClaimedHint(null)).toBe(
      "Your coordinator confirms a taken time before it is covered.",
    );
    expectCalmCopy(boardClaimedHint("Grace"));
  });
});

describe("board empty state", () => {
  it("names the next human action for a volunteer", () => {
    const empty = boardEmptyCopy("volunteer", "Grace");
    expect(empty.title).toMatch(/nothing is open/i);
    expect(empty.body).toContain("Grace");
    expect(empty.body).toMatch(/tell|speak|ask/i);
    expect(empty.href).toBeNull();
    expectCalmCopy(`${empty.title} ${empty.body}`);
  });

  it("sends the desk team to the waiting asks that would fill the board", () => {
    const empty = boardEmptyCopy("coordinator", "Grace");
    expect(empty.title).toMatch(/nothing is open/i);
    expect(empty.body).toMatch(/waiting ask|desk|approve/i);
    expect(empty.href).toBe("/desk");
    expect(empty.linkLabel).toMatch(/desk/i);
    expectCalmCopy(`${empty.title} ${empty.body}`);
  });

  it("falls back to a plain coordinator when no name is known", () => {
    const empty = boardEmptyCopy("volunteer", null);
    expect(empty.body).toMatch(/coordinator/i);
    expect(empty.body).not.toMatch(/null|undefined/i);
  });
});

describe("board kinds stay closed over the schema", () => {
  it("covers every seeded slot kind", () => {
    const covered: SlotKind[] = SLOT_KINDS.filter(
      (kind) => boardKindCopy(kind).word.length > 0,
    );
    expect(covered.sort()).toEqual([...SLOT_KINDS].sort());
  });
});

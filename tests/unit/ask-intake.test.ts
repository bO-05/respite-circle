import { describe, expect, it } from "vitest";
import {
  appendSpokenText,
  characterCountLabel,
  consentSentence,
  MAX_ASK_LENGTH,
  receiptDecisionSentences,
  receiptLifecycleSteps,
  receiptSentence,
  receiptStatusCopy,
  sentBackReceiptSentence,
  validateAskSubmission,
  type ReceiptStatus,
} from "@/server/domain/ask-intake";
import {
  ASK_SAMPLES,
  ASK_SAMPLE_NOTICE,
  sampleById,
} from "@/lib/ask-samples";

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

function longAsk(length: number): string {
  return "a".repeat(length);
}

describe("ask submission validation", () => {
  it("accepts the caregiver's words and returns them byte-identical", () => {
    const text =
      "  I haven't had a Saturday morning to myself since March.\n\n" +
      "Mum is fine with people she knows \u2014 she just can't be alone.\n" +
      "She loves hymns and tea, and she naps after lunch.  ";

    const result = validateAskSubmission({ text, consent: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Verbatim means nobody trims, normalises, or smart-quotes her words.
    expect(result.text).toBe(text);
    expect(result.text.length).toBe(text.length);
  });

  it("rejects an empty submission with a calm message", () => {
    const result = validateAskSubmission({ text: "", consent: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("empty");
    expect(result.message).toMatch(/few words/i);
  });

  it("rejects whitespace-only text and creates nothing", () => {
    for (const text of ["   ", "\n\n\t\r ", " \u00a0 "]) {
      const result = validateAskSubmission({ text, consent: true });
      expect(result.ok, JSON.stringify(text)).toBe(false);
      if (!result.ok) expect(result.code).toBe("empty");
    }
  });

  it("rejects a non-string submission without throwing", () => {
    for (const text of [undefined, null, 42, { words: HERO_ASK }]) {
      const result = validateAskSubmission({ text, consent: true });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid");
    }
  });

  it("requires the consent line to be acknowledged", () => {
    for (const consent of [false, undefined, "true", 1, null]) {
      const result = validateAskSubmission({ text: HERO_ASK, consent });
      expect(result.ok, String(consent)).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("consent_required");
        expect(result.message).toMatch(/tick the box/i);
      }
    }
  });

  it("accepts a 4,000-character ask and stores every character", () => {
    const text = longAsk(4_000);
    const result = validateAskSubmission({ text, consent: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.length).toBe(4_000);
    expect(result.text).toBe(text);
    expect(MAX_ASK_LENGTH).toBeGreaterThanOrEqual(4_000);
  });

  it("refuses text beyond the storage limit instead of truncating it", () => {
    const text = longAsk(MAX_ASK_LENGTH + 1);
    const result = validateAskSubmission({ text, consent: true });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("too_long");
      expect(result.message).toContain(
        MAX_ASK_LENGTH.toLocaleString("en-US"),
      );
    }
  });
});

describe("ask copy", () => {
  it("names the signed meal exception in the same breath as the approval", () => {
    expect(receiptSentence("Grace")).toBe(
      "Grace reads every ask first. Nothing is shown to a neighbour until she approves it, except a meal under the church's signed low-risk policy.",
    );
    expect(receiptSentence("Grace", false)).toBe(receiptSentence("Grace"));
    // The old absolute ignored the signed low-risk meal exception.
    expect(receiptSentence("Grace")).not.toMatch(
      /nothing is shown to anyone until she approves it\.$/i,
    );
  });

  it("never pretends a named person exists when the church has none", () => {
    const sentence = receiptSentence(null);

    expect(sentence).toBe(
      "Your coordinator reads every ask first. Nothing is shown to a neighbour until they approve it, except a meal under the church's signed low-risk policy.",
    );
    expect(sentence).not.toContain("null");
  });

  it("says who may read the words, including the deputy, without repeating the promise", () => {
    expect(consentSentence("Grace")).toBe(
      "I agree that the church may keep these words and that Grace, or the deputy who covers when she is away, may read them.",
    );
    expect(consentSentence(null)).toBe(
      "I agree that the church may keep these words and that my coordinator, or the deputy who covers for them, may read them.",
    );
    // The consent is not a privacy promise, so it cannot make one the trust
    // page contradicts: the deputy reads the same desk.
    expect(consentSentence("Grace")).toMatch(/deputy/);
    expect(consentSentence("Grace")).not.toMatch(/nothing is shown/i);
    expect(consentSentence("Grace")).not.toMatch(/never shown/i);
  });

  it("qualifies the receipt sentence while the signed policy switch is on", () => {
    const sentence = receiptSentence("Grace", true);

    expect(sentence).toMatch(/Grace reads every ask\./);
    expect(sentence).toMatch(/your words are never shown to a neighbour/i);
    expect(sentence).toMatch(/signed low-risk policy/i);
    expect(sentence).toMatch(/meal time from this ask may go on the congregation board/i);
    expect(sentence).toMatch(/before she approves that time/i);
    // The pre-switch promise that she reads it "first" is no longer true.
    expect(sentence).not.toMatch(/reads every ask first/i);

    const unnamed = receiptSentence(null, true);
    expect(unnamed).toMatch(/your coordinator reads every ask\./i);
    expect(unnamed).toMatch(/before they approve that time/i);
    expect(unnamed).not.toContain("null");
  });

  it("keeps today's send-back receipt exactly while the switch is off", () => {
    expect(sentBackReceiptSentence("Grace")).toBe(
      "Grace read your words and sent this back with a note. Nothing was shared with a neighbour, and nothing was published.",
    );
    expect(sentBackReceiptSentence("Grace", false)).toBe(
      sentBackReceiptSentence("Grace"),
    );
    expect(sentBackReceiptSentence(null)).toMatch(
      /^Your coordinator read your words/,
    );
  });

  it("never says nothing was published when a meal may have been on the board", () => {
    const sentence = sentBackReceiptSentence("Grace", true);

    expect(sentence).toMatch(/your words stay private/i);
    expect(sentence).toMatch(
      /no time from this ask is on the congregation board now/i,
    );
    expect(sentence).toMatch(
      /any meal time that had been put there is taken down/i,
    );
    // The pre-switch claim is no longer true while the switch is on.
    expect(sentence).not.toMatch(/nothing was published/i);
    expect(sentence).not.toMatch(/nothing was shared with a neighbour/i);
    expect(sentence).not.toContain("null");
  });

  it("names the real decision point and offers no control the app cannot take", () => {
    const named = receiptDecisionSentences("Grace");

    expect(named.call).toBe(
      "Grace may call to talk the week through. You can say what would help, and what would not.",
    );
    expect(named.offer).toBe(
      "If a time does not suit you, tell Grace on the phone — there is no button here to say whether it helps.",
    );

    // The real decision point, in plain words: the call and the coordinator.
    expect(named.call).toContain("Grace may call");
    expect(named.offer).toContain("tell Grace on the phone");
    expect(named.offer).toContain("there is no button here");

    for (const sentence of [named.call, named.offer]) {
      // No sentence gives the family a decision the app cannot take.
      expect(sentence).not.toMatch(/\byou (decide|approve|accept|decline)\b/i);
      expect(sentence).not.toMatch(/decide whether it helps/i);
      expect(sentence).not.toMatch(/nothing is decided without you/i);
      // The caregiver screens carry no desk vocabulary.
      expect(sentence).not.toMatch(/\b(waiting|declined?|unclaimed|count)\b/i);
    }
  });

  it("keeps the same plain words when no coordinator name resolves", () => {
    const anonymous = receiptDecisionSentences(null);

    expect(anonymous.call).toBe(
      "Your coordinator may call to talk the week through. You can say what would help, and what would not.",
    );
    expect(anonymous.offer).toBe(
      "If a time does not suit you, tell your coordinator on the phone — there is no button here to say whether it helps.",
    );
    expect(anonymous.call).not.toContain("Grace");
    expect(anonymous.offer).not.toContain("null");
  });

  it("trims a coordinator's name rather than printing stray spaces", () => {
    const trimmed = receiptDecisionSentences("  Grace  ");

    expect(trimmed.call).toMatch(/^Grace may call/);
    expect(trimmed.offer).toContain("tell Grace on the phone");
  });

  it("counts characters without judging them", () => {
    expect(characterCountLabel(0)).toBe("0 characters");
    expect(characterCountLabel(1)).toBe("1 character");
    expect(characterCountLabel(4_000)).toBe("4,000 characters");
    expect(characterCountLabel(MAX_ASK_LENGTH + 5)).toMatch(/over the limit/i);
  });

  it("appends spoken words with a single separating space", () => {
    expect(appendSpokenText("", "Mum is fine")).toBe("Mum is fine");
    expect(appendSpokenText("Mum is fine", "with people she knows")).toBe(
      "Mum is fine with people she knows",
    );
    expect(appendSpokenText("Line one.\n", "Line two.")).toBe(
      "Line one.\nLine two.",
    );
    expect(appendSpokenText("A", "  B  ")).toBe("A B");
  });
});

describe("waiting pill read state (VAL-R2PROM-005)", () => {
  const READ_AT = new Date("2026-11-25T14:00:00.000Z");

  function waiting(
    deskReadAt: Date | null,
    coordinatorFirstName: string | null = "Grace",
  ) {
    return receiptStatusCopy({
      status: "waiting_coordinator",
      coordinatorFirstName,
      sentBackByFirstName: null,
      deskReadAt,
    });
  }

  it("says 'not read yet' only while no desk read is recorded", () => {
    expect(waiting(null)).toEqual({
      label: "With Grace — not read yet",
      tone: "amber",
    });
  });

  it("stops claiming 'not read yet' once the desk has read it, and says what happens next", () => {
    const copy = waiting(READ_AT);

    expect(copy.label).not.toMatch(/not read yet/i);
    expect(copy.label).toBe("Read by Grace — she may call you");
    // Still the waiting state, so the pill keeps its amber tone.
    expect(copy.tone).toBe("amber");
  });

  it("never names a person the church does not have", () => {
    expect(waiting(null, null)).toEqual({
      label: "With Your coordinator — not read yet",
      tone: "amber",
    });
    const unnamedRead = waiting(READ_AT, null);
    expect(unnamedRead.label).toBe("Read by Your coordinator — they may call you");
    expect(unnamedRead.label).not.toContain("null");
  });

  it("trims a coordinator's name rather than printing stray spaces", () => {
    expect(waiting(READ_AT, "  Grace  ").label).toBe(
      "Read by Grace — she may call you",
    );
  });

  it("leaves every other status exactly as it was", () => {
    const cases = [
      ["safety_hold", "Grace will call you today", "amber"],
      ["care_hold", "Grace will call you about this", "amber"],
      ["approved", "Approved by Grace", "green"],
      ["sent_back", "Read — Grace will be in touch", "amber"],
      ["closed", "Closed", "ink"],
      ["withdrawn", "Withdrawn", "ink"],
    ] as const;

    for (const [status, label, tone] of cases) {
      expect(
        receiptStatusCopy({
          status,
          coordinatorFirstName: "Grace",
          sentBackByFirstName: null,
          deskReadAt: READ_AT,
        }),
      ).toEqual({ label, tone });
    }
  });

  it("names the person who sent it back, not the lead coordinator", () => {
    expect(
      receiptStatusCopy({
        status: "sent_back",
        coordinatorFirstName: "Grace",
        sentBackByFirstName: "Daniel",
        deskReadAt: null,
      }).label,
    ).toBe("Read — Daniel will be in touch");
  });
});

describe("receipt lifecycle (VAL-R4VIS-006)", () => {
  const READ_AT = new Date("2026-11-25T14:00:00.000Z");

  function lifecycle(
    input: Partial<{
      status: ReceiptStatus;
      coordinatorFirstName: string | null;
      deskReadAt: Date | null;
      publishedCount: number;
      coveredCount: number;
    }> = {},
  ) {
    return receiptLifecycleSteps({
      status: "waiting_coordinator",
      coordinatorFirstName: "Grace",
      deskReadAt: null,
      publishedCount: 0,
      coveredCount: 0,
      ...input,
    });
  }

  function states(input: Parameters<typeof lifecycle>[0] = {}) {
    return lifecycle(input).map((step) => step.state);
  }

  it("names the four stages in order, with the church's coordinator", () => {
    expect(lifecycle().map((step) => step.label)).toEqual([
      "Written",
      "Grace is reading",
      "On the board",
      "Covered",
    ]);
    expect(lifecycle().map((step) => step.kind)).toEqual([
      "written",
      "reading",
      "board",
      "covered",
    ]);
  });

  it("starts an unread waiting ask at Written and never claims a reading", () => {
    expect(states()).toEqual(["current", "future", "future", "future"]);
    expect(lifecycle()[1]!.state).not.toBe("done");
  });

  it("advances the reading stage only when the desk read is recorded", () => {
    expect(states({ deskReadAt: READ_AT })).toEqual([
      "done",
      "current",
      "future",
      "future",
    ]);
  });

  it("shows the route the hold actually took, and keeps an unread hold's reading future", () => {
    const safety = lifecycle({ status: "safety_hold" });
    expect(safety.map((step) => step.label)).toEqual([
      "Written",
      "Grace is reading",
      "Call today",
      "Covered",
    ]);
    expect(states({ status: "safety_hold" })).toEqual([
      "done",
      "future",
      "current",
      "future",
    ]);
    expect(states({ status: "safety_hold", deskReadAt: READ_AT })).toEqual([
      "done",
      "done",
      "current",
      "future",
    ]);

    const care = lifecycle({ status: "care_hold" });
    expect(care[2]!.label).toBe("Needs professional help");
    expect(care[2]!.state).toBe("current");
  });

  it("fills On the board from a published time and Covered only from a confirmed one", () => {
    expect(states({ status: "approved", publishedCount: 2 })).toEqual([
      "done",
      "done",
      "current",
      "future",
    ]);
    expect(
      states({ status: "approved", publishedCount: 2, coveredCount: 1 }),
    ).toEqual(["done", "done", "done", "current"]);
    // A claimed but unconfirmed time is on the board, never covered.
    expect(
      lifecycle({
        status: "approved",
        publishedCount: 2,
        coveredCount: 0,
      })[3]!.state,
    ).toBe("future");
  });

  it("does not call an approved ask 'on the board' before a time is published", () => {
    expect(states({ status: "approved", publishedCount: 0 })).toEqual([
      "done",
      "current",
      "future",
      "future",
    ]);
  });

  it("keeps a closed ask's reached stages done and points at no next step", () => {
    const closed = lifecycle({
      status: "closed",
      deskReadAt: READ_AT,
      publishedCount: 1,
    });
    expect(closed.map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
      "future",
    ]);
    expect(closed.some((step) => step.state === "current")).toBe(false);
  });

  it("shows a covered close as the Covered stage, the one fact that remains", () => {
    expect(states({ status: "closed", coveredCount: 1 })).toEqual([
      "done",
      "done",
      "done",
      "current",
    ]);
  });

  it("never hardcodes a coordinator name", () => {
    const unnamed = lifecycle({ coordinatorFirstName: null });
    expect(unnamed[1]!.label).toBe("Your coordinator is reading");
    expect(unnamed.map((step) => step.label).join(" ")).not.toContain("Grace");
    expect(unnamed[1]!.label).not.toContain("null");
  });
});

describe("fictional sample asks", () => {
  it("offers exactly the five promised examples", () => {
    expect(ASK_SAMPLES.map((sample) => sample.id)).toEqual([
      "marta",
      "david",
      "priya",
      "personal-care",
      "safety",
    ]);
  });

  it("labels the examples fictional in visible copy", () => {
    expect(ASK_SAMPLE_NOTICE).toMatch(/fictional/i);
    for (const sample of ASK_SAMPLES) {
      expect(sample.title.length).toBeGreaterThan(0);
      expect(sample.body.length).toBeGreaterThan(40);
    }
  });

  it("uses the approved hero wording for the three named families", () => {
    expect(sampleById("marta")?.body).toContain(
      "I haven't had a Saturday morning to myself since March.",
    );
    expect(sampleById("david")?.body).toContain("June has physio");
    expect(sampleById("priya")?.body).toContain("Dad has dialysis");
  });

  it("includes a personal-care example and a safety example", () => {
    expect(sampleById("personal-care")?.body).toMatch(
      /medication|bathing|toileting|lifting/i,
    );
    expect(sampleById("safety")?.body).toMatch(
      /leaving the house|scared|fall|wandering/i,
    );
  });

  it("returns undefined for an unknown sample id", () => {
    expect(sampleById("nope")).toBeUndefined();
  });
});

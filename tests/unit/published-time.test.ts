import { describe, expect, it } from "vitest";
import { publishedNotBookedSentence } from "@/server/domain/published-time";

/**
 * VAL-R2UI-004 and VAL-R2UI-006 — one sentence, one meaning, and the resolved
 * coordinator's own name.
 *
 * The sentence exists because the receipt and the care page said different
 * things about the same state: a published time looked like a booking on one
 * page and like nothing at all on the other. Both pages now read this function,
 * so the words cannot drift apart. It names the person who will confirm the
 * neighbour, and the name is the church's own, never a template's.
 */

describe("published is not booked", () => {
  it("says what a published time is, where it appears, and who confirms it", () => {
    expect(publishedNotBookedSentence("Grace", "here")).toBe(
      "A published time is not booked yet: it appears here only after Grace confirms a neighbour.",
    );
    expect(publishedNotBookedSentence("Grace", "on your care page")).toBe(
      "A published time is not booked yet: it appears on your care page only after Grace confirms a neighbour.",
    );
  });

  it("is one sentence, not a paragraph", () => {
    const sentence = publishedNotBookedSentence("Grace", "here");
    // One colon, one full stop at the end: nothing for a tired reader to join.
    expect(sentence.match(/\./g)).toHaveLength(1);
    expect(sentence.trim().endsWith("neighbour.")).toBe(true);
  });

  it("never claims the time is booked or covered", () => {
    for (const where of ["here", "on your care page"] as const) {
      const sentence = publishedNotBookedSentence("Grace", where);
      expect(sentence).not.toMatch(/booked for you|is booked|is covered/i);
      expect(sentence).not.toMatch(/neighbour has said yes/i);
    }
  });

  it("renders the resolved name, never a hardcoded one (VAL-R2UI-006)", () => {
    // A named church.
    expect(publishedNotBookedSentence("Grace", "here")).toContain("Grace");

    // A differently named church: the seeded name must not appear.
    const nora = publishedNotBookedSentence("Nora", "here");
    expect(nora).toContain("Nora");
    expect(nora).not.toContain("Grace");

    // No coordinator resolves: the sentence falls back, still naming nobody.
    for (const where of ["here", "on your care page"] as const) {
      const unnamed = publishedNotBookedSentence(null, where);
      expect(unnamed).toContain("only after your coordinator confirms");
      expect(unnamed).not.toContain("Grace");
      expect(unnamed).not.toContain("null");
      expect(unnamed).not.toContain("undefined");
    }
  });
});

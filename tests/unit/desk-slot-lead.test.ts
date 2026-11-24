import { describe, expect, it } from "vitest";
import {
  DESK_SLOT_LEAD_STATUSES,
  deskSlotLead,
} from "../../src/server/domain/desk-slot-lead";

/**
 * VAL-AUDITFIX-016 in the pure domain.
 *
 * `/desk/slot/[id]` used to open with one hard-coded sentence for every status:
 * "A neighbour has said yes. Confirm the claim, or take it back…". On a
 * published time nobody had taken, and on a time that closed unclaimed, that
 * sentence said a neighbour had said yes when nobody had — the closed state
 * that carries the absence proof was also the state that claimed a neighbour.
 *
 * The lead is now derived from the status. These cases pin each sentence and
 * the two states where the old line was false, so the page cannot drift back.
 */

const CLAIMED_LEAD =
  "A neighbour has said yes. Confirm the claim, or take it back before the family hears anything.";

describe("desk slot lead", () => {
  it("keeps the confirm/take-back wording for a claimed time", () => {
    expect(deskSlotLead("claimed")).toBe(CLAIMED_LEAD);
  });

  it("tells an open time's coordinator to wait or close it, never that a neighbour said yes", () => {
    const lead = deskSlotLead("open");

    expect(lead).not.toMatch(/has said yes|confirm the claim|take it back/i);
    expect(lead).toMatch(/published/i);
    expect(lead).toMatch(/wait/i);
    // The control the coverage watch actually offers for a published time.
    expect(lead).toMatch(/close this time without a claim/i);
  });

  it("says no one took an expired time and points at the absence proof", () => {
    const lead = deskSlotLead("expired_unclaimed");

    expect(lead).toMatch(/no one took/i);
    expect(lead).toMatch(/absence proof/i);
    expect(lead).not.toMatch(/has said yes|confirm the claim|take it back/i);
  });

  it("describes covered, done and cancelled without offering a claim decision", () => {
    expect(deskSlotLead("covered")).toMatch(/confirmed it with the family/i);
    expect(deskSlotLead("done")).toMatch(/done/i);
    expect(deskSlotLead("cancelled")).toMatch(/cancelled/i);

    for (const status of ["covered", "done", "cancelled"] as const) {
      expect(deskSlotLead(status)).not.toMatch(
        /confirm the claim|take it back/i,
      );
    }
  });

  it("never claims a neighbour said yes in a state where nobody has", () => {
    for (const status of [
      "draft",
      "open",
      "cancelled",
      "expired_unclaimed",
    ] as const) {
      expect(deskSlotLead(status)).not.toMatch(/has said yes|said yes/i);
    }
  });

  it("has one distinct, non-empty sentence per status", () => {
    const leads = DESK_SLOT_LEAD_STATUSES.map((status) =>
      deskSlotLead(status),
    );

    expect(leads.every((lead) => lead.trim().length > 20)).toBe(true);
    expect(new Set(leads).size).toBe(DESK_SLOT_LEAD_STATUSES.length);
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ABSENCE_PROOF_QUERY_TEXT } from "../../src/server/domain/coverage";
import {
  ABSENCE_PROOF_DIGEST_VERSION,
  absenceProofCanonicalText,
  absenceProofDigestMatches,
  computeAbsenceProofDigest,
} from "../../src/server/domain/absence-proof";

/**
 * VAL-AUDITFIX-005 at the domain boundary.
 *
 * The stored digest must prove something about the row it sits beside. The old
 * recipe was `sha256(query text)`, a hash of a module constant, so every proof
 * carried the same digest no matter which time it described. The recipe now
 * binds the slot id, the counted outbox rows, the written instant, and the
 * query text under a version tag. The canonical string below is written from
 * the documentation, not from the implementation, so a format change has to be
 * deliberate in both places.
 */

const SLOT_ID = "0f000000-0000-4000-8000-000000000001";
const OTHER_SLOT_ID = "0f000000-0000-4000-8000-000000000002";
const GENERATED_AT = new Date("2026-11-19T16:30:00.000Z");

const INPUT = {
  slotId: SLOT_ID,
  caregiverOutboxCount: 0,
  queryText: ABSENCE_PROOF_QUERY_TEXT,
  generatedAt: GENERATED_AT,
};

const CANONICAL = [
  "absence-proof/v1",
  `slot_id:${SLOT_ID}`,
  "caregiver_outbox_count:0",
  "generated_at:2026-11-19T16:30:00.000Z",
  "query_text:",
  ABSENCE_PROOF_QUERY_TEXT,
].join("\n");

/** Pins the v1 format: any change to the recipe has to update this on purpose. */
const GOLDEN_DIGEST =
  "c2e5182f701f99d347781e61fb4170b8ca8557b660198ceb681b52a35a867fc5";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("the absence-proof digest recipe", () => {
  it("hashes the documented canonical string, not the query text alone", () => {
    expect(ABSENCE_PROOF_DIGEST_VERSION).toBe("absence-proof/v1");
    expect(absenceProofCanonicalText(INPUT)).toBe(CANONICAL);
    expect(computeAbsenceProofDigest(INPUT)).toBe(hash(CANONICAL));
    expect(computeAbsenceProofDigest(INPUT)).toBe(GOLDEN_DIGEST);

    // The defect this feature fixes: the old digest was a hash of the
    // four-line query constant, identical for every proof ever written.
    expect(computeAbsenceProofDigest(INPUT)).not.toBe(
      hash(ABSENCE_PROOF_QUERY_TEXT),
    );
  });

  it("changes when the slot id, the count, the query text, or the time changes", () => {
    const base = computeAbsenceProofDigest(INPUT);

    expect(
      computeAbsenceProofDigest({ ...INPUT, slotId: OTHER_SLOT_ID }),
    ).not.toBe(base);

    expect(
      computeAbsenceProofDigest({ ...INPUT, caregiverOutboxCount: 1 }),
    ).not.toBe(base);

    expect(
      computeAbsenceProofDigest({
        ...INPUT,
        queryText: `${ABSENCE_PROOF_QUERY_TEXT}\n`,
      }),
    ).not.toBe(base);

    expect(
      computeAbsenceProofDigest({
        ...INPUT,
        generatedAt: new Date(GENERATED_AT.getTime() + 1),
      }),
    ).not.toBe(base);
  });

  it("is stable for the same row and treats the stored UUID case as one id", () => {
    const digest = computeAbsenceProofDigest(INPUT);

    expect(computeAbsenceProofDigest({ ...INPUT })).toBe(digest);
    expect(
      computeAbsenceProofDigest({
        ...INPUT,
        slotId: SLOT_ID.toUpperCase(),
      }),
    ).toBe(digest);
  });

  it("recomputes from a stored row and catches a field changed after the fact", () => {
    const digest = computeAbsenceProofDigest(INPUT);
    const row = {
      slotId: SLOT_ID,
      caregiverOutboxCount: 0,
      queryText: ABSENCE_PROOF_QUERY_TEXT,
      createdAt: GENERATED_AT,
      digest,
    };

    expect(absenceProofDigestMatches(row)).toBe(true);

    expect(
      absenceProofDigestMatches({ ...row, caregiverOutboxCount: 1 }),
    ).toBe(false);
    expect(
      absenceProofDigestMatches({ ...row, slotId: OTHER_SLOT_ID }),
    ).toBe(false);
    expect(
      absenceProofDigestMatches({
        ...row,
        createdAt: new Date(GENERATED_AT.getTime() + 1),
      }),
    ).toBe(false);
    expect(
      absenceProofDigestMatches({
        ...row,
        digest: hash(ABSENCE_PROOF_QUERY_TEXT),
      }),
    ).toBe(false);
  });
});

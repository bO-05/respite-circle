import { createHash } from "node:crypto";

/**
 * The absence proof's digest recipe, versioned as `absence-proof/v1`.
 *
 * A digest proves something only when it covers the facts it sits beside. The
 * original recipe hashed the four-line query constant alone, so every proof
 * carried the same digest and the column proved nothing about its own row.
 * This recipe binds the proof's own stored facts.
 *
 * The canonical string is exactly these six parts joined by "\n", in this
 * order, with no trailing newline:
 *
 *   absence-proof/v1
 *   slot_id:<slot id in lowercase>
 *   caregiver_outbox_count:<integer, as stored>
 *   generated_at:<ISO 8601 UTC with milliseconds, e.g. 2026-11-19T16:30:00.000Z>
 *   query_text:
 *   <query text, verbatim, including its own line breaks>
 *
 * The digest is `sha256(canonical)` written as 64 lowercase hex characters.
 *
 * Every part except the version tag comes from the stored row, so anyone who
 * can read the row can recompute and compare it:
 *
 *   SELECT slot_id, caregiver_outbox_count, query_text, created_at, digest
 *     FROM absence_proof
 *    WHERE id = '<proof id>';
 *
 *   const row = ...;
 *   const canonical = [
 *     "absence-proof/v1",
 *     `slot_id:${row.slot_id.toLowerCase()}`,
 *     `caregiver_outbox_count:${row.caregiver_outbox_count}`,
 *     `generated_at:${row.created_at.toISOString()}`,
 *     "query_text:",
 *     row.query_text,
 *   ].join("\n");
 *   sha256(canonical) === row.digest;
 *
 * `generated_at` is the row's `created_at` (timestamptz) formatted with
 * JavaScript's `Date#toISOString`. The write path stores a millisecond-aligned
 * Date, so the value round-trips exactly. The slot id is lowercased because
 * Postgres stores `uuid` in lowercase; an uppercase copy of the same id names
 * the same proof.
 *
 * A row written before this recipe (the old `sha256(query text)` constant)
 * does not recompute under v1. `absence_proof` is append-only by trigger, so
 * those rows are not rewritten.
 *
 * Server-only: the hash uses `node:crypto`, so never import this module from a
 * client component. The card imports only the copy it renders.
 */
export const ABSENCE_PROOF_DIGEST_VERSION = "absence-proof/v1";

export type AbsenceProofDigestInput = {
  /** `absence_proof.slot_id`, as stored. */
  slotId: string;
  /** `absence_proof.caregiver_outbox_count`, as stored. */
  caregiverOutboxCount: number;
  /** `absence_proof.query_text`, verbatim. */
  queryText: string;
  /** `absence_proof.created_at`, the instant the proof was written. */
  generatedAt: Date;
};

/**
 * The exact bytes the digest covers. Keep this in step with the recipe above;
 * the unit test pins the format with its own literal copy so a drift has to be
 * deliberate in both places.
 */
export function absenceProofCanonicalText(
  input: AbsenceProofDigestInput,
): string {
  return [
    ABSENCE_PROOF_DIGEST_VERSION,
    `slot_id:${input.slotId.toLowerCase()}`,
    `caregiver_outbox_count:${input.caregiverOutboxCount}`,
    `generated_at:${input.generatedAt.toISOString()}`,
    "query_text:",
    input.queryText,
  ].join("\n");
}

/** SHA-256 of the canonical string, as 64 lowercase hex characters. */
export function computeAbsenceProofDigest(
  input: AbsenceProofDigestInput,
): string {
  return createHash("sha256")
    .update(absenceProofCanonicalText(input), "utf8")
    .digest("hex");
}

export type StoredAbsenceProof = {
  slotId: string;
  caregiverOutboxCount: number;
  queryText: string;
  createdAt: Date;
  digest: string;
};

/**
 * True when a stored proof's digest is the documented recipe over its own
 * fields. A changed slot id, count, query text, or written instant makes this
 * false; that is the whole claim the digest supports.
 */
export function absenceProofDigestMatches(row: StoredAbsenceProof): boolean {
  return (
    computeAbsenceProofDigest({
      slotId: row.slotId,
      caregiverOutboxCount: row.caregiverOutboxCount,
      queryText: row.queryText,
      generatedAt: row.createdAt,
    }) === row.digest
  );
}

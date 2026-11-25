/**
 * The failure path: a published time no neighbour has taken.
 *
 * The product's promise is that such a time produces a person, not a message.
 * This module holds the rules and the exact sentences; the repository in
 * `src/server/repositories/coverage.ts` is the only write path.
 *
 * Two clocks decide when a time needs a call, and the earlier one wins:
 *
 *   - the church's `call_threshold_hours` before the window starts (48 hours
 *     by default), so a near time is never discovered too late;
 *   - the church's `call_after_open_hours` after it was published to the board
 *     (24 hours by default), so a far time does not sit silently for weeks.
 *
 * Both are policy content and both are editable on the desk. A row that
 * predates the publication clock reads the constant below, which is the
 * seeded value, so an older version behaves exactly as it did.
 *
 * There is no urgency score and no ranking. A time that is due is due.
 *
 * The absence proof is deliberately narrow: the exact query text is a
 * constant, and `absence-proof.ts` hashes it together with the slot id, the
 * live zero count, and the written instant under the `absence-proof/v1`
 * recipe. The row's `caregiver_outbox_count` is read live inside the
 * transaction and the database's `absence_proof_zero_outbox` CHECK refuses
 * anything but zero.
 */

import {
  POLICY_DEFAULT_CALL_AFTER_OPEN_HOURS,
  POLICY_DEFAULT_CALL_THRESHOLD_HOURS,
} from "./policy";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** Hours before a published time's window when the coverage watch starts. */
export const DEFAULT_CALL_THRESHOLD_HOURS =
  POLICY_DEFAULT_CALL_THRESHOLD_HOURS;

/** Hours after publication when a still-unclaimed time needs a call. */
export const DEFAULT_CALL_AFTER_OPEN_HOURS =
  POLICY_DEFAULT_CALL_AFTER_OPEN_HOURS;

function positiveWholeHours(
  value: number | null | undefined,
  fallback: number,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 1
    ? value
    : fallback;
}

/**
 * The window clock a policy row carries, or the published default when the row
 * predates the field or holds something that is not a whole hour.
 */
export function callThresholdHoursFromPolicy(
  value: number | null | undefined,
): number {
  return positiveWholeHours(value, DEFAULT_CALL_THRESHOLD_HOURS);
}

/**
 * The publication clock a policy row carries, or the published default. This
 * is the fallback that keeps an older row behaving as it did before the clock
 * became editable policy content.
 */
export function callAfterOpenHoursFromPolicy(
  value: number | null | undefined,
): number {
  return positiveWholeHours(value, DEFAULT_CALL_AFTER_OPEN_HOURS);
}

/** The five human outcomes a coordinator can record after a call. */
export const COVERAGE_CALL_OUTCOMES = [
  "reached",
  "left_message",
  "try_later",
  "caregiver_withdrew",
  "coordinator_will_cover",
] as const;

export type CoverageCallOutcome = (typeof COVERAGE_CALL_OUTCOMES)[number];

export const COVERAGE_CALL_OUTCOME_LABELS: Record<
  CoverageCallOutcome,
  string
> = {
  reached: "Reached them",
  left_message: "Left a message",
  try_later: "Try again later",
  caregiver_withdrew: "The family withdrew this ask",
  coordinator_will_cover: "I will cover this time myself",
};

export const COVERAGE_NOTE_MAX_LENGTH = 1_000;

export function isCoverageCallOutcome(
  value: unknown,
): value is CoverageCallOutcome {
  return (
    typeof value === "string" &&
    (COVERAGE_CALL_OUTCOMES as readonly string[]).includes(value)
  );
}

export function coverageOutcomeLabel(outcome: string): string {
  return isCoverageCallOutcome(outcome)
    ? COVERAGE_CALL_OUTCOME_LABELS[outcome]
    : "Call recorded";
}

// ---------------------------------------------------------------------------
// When a time needs a call
// ---------------------------------------------------------------------------

export type CoverageThresholdInput = {
  windowStart: Date | null;
  openSince: Date;
  thresholdHours: number;
  openAfterHours?: number;
};

function normaliseHours(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

/**
 * The instant this time enters the coverage watch: the earlier of the
 * window-relative threshold and the publication-relative threshold.
 */
export function coverageWatchOpensAt(
  input: CoverageThresholdInput,
): Date {
  const threshold = normaliseHours(
    input.thresholdHours,
    DEFAULT_CALL_THRESHOLD_HOURS,
  );
  const openAfter = normaliseHours(
    input.openAfterHours ?? DEFAULT_CALL_AFTER_OPEN_HOURS,
    DEFAULT_CALL_AFTER_OPEN_HOURS,
  );

  const candidates: number[] = [
    input.openSince.getTime() + openAfter * HOUR_MS,
  ];

  if (input.windowStart && !Number.isNaN(input.windowStart.getTime())) {
    candidates.push(input.windowStart.getTime() - threshold * HOUR_MS);
  }

  return new Date(Math.min(...candidates));
}

export function isCoverageWatchDue(
  input: CoverageThresholdInput & { now: Date },
): boolean {
  return input.now.getTime() >= coverageWatchOpensAt(input).getTime();
}

/** How long this time has been on the board, from its publication instant. */
export function coverageOpenFor(
  openSince: Date,
  now: Date,
): { ms: number; label: string } {
  const ms = Math.max(0, now.getTime() - openSince.getTime());
  return { ms, label: formatOpenFor(ms) };
}

/**
 * A plain duration a coordinator reads: "under an hour", "5 hours",
 * "2 days, 3 hours". No countdown and no deadline.
 */
export function formatOpenFor(ms: number): string {
  if (!Number.isFinite(ms) || ms < HOUR_MS) return "under an hour";

  const hours = Math.floor(ms / HOUR_MS);
  if (hours < 24) return hours === 1 ? "1 hour" : `${hours} hours`;

  const days = Math.floor(hours / 24);
  const restHours = hours - days * 24;
  const dayLabel = days === 1 ? "1 day" : `${days} days`;

  if (restHours === 0) return dayLabel;
  const hourLabel = restHours === 1 ? "1 hour" : `${restHours} hours`;
  return `${dayLabel}, ${hourLabel}`;
}

// ---------------------------------------------------------------------------
// The live message count and the absence proof
// ---------------------------------------------------------------------------

/**
 * The exact sentence on the coverage card. It is the coordinator's evidence,
 * so it names the family's view plainly.
 */
export function coverageMessageCountLine(count: number): string {
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `Messages sent to the caregiver about this slot: ${safe}`;
}

/**
 * What the zero stands for. It is the product's promise, not an error, so the
 * desk and the coverage card render it as ordinary text beside the count —
 * never inside an amber warning block.
 */
export const COVERAGE_SILENCE_PROMISE =
  "Sending nothing is the promise, not a failure: a person makes the call, and the app stays silent.";

/**
 * The lead line on a time that nobody has taken.
 *
 * It names the coordinator responsible for that family, read from the case —
 * the person who approved the ask, or the person who published the time when
 * the ask has no approver yet. It is never the signed-in viewer: the deputy
 * covering the desk must not see their own name where the card means the lead,
 * and every viewer of one case must read the same sentence. The caller cannot
 * pass a session name because the only name input is the resolved responsible
 * coordinator; `null` says plainly that none is assigned and names nobody.
 */
export function coverageCallLeadLine(input: {
  responsibleCoordinatorName: string | null;
  caregiverFirstName: string;
}): string {
  const name = input.responsibleCoordinatorName?.trim();
  if (!name) {
    return "No coordinator is assigned to this family yet; the app sends nothing.";
  }
  return `${name} calls ${input.caregiverFirstName}; the app sends nothing.`;
}

/**
 * The query text stored with an absence proof. It is a parameterised query:
 * `$1` is the slot id and `$2` the church id. The repository runs exactly this
 * shape against the live database inside the expiry transaction, and stores
 * this constant as the proof of what was asked. It counts every outbox row
 * for the slot — not just one caregiver's — so zero means nothing at all was
 * sent about this time. The digest recipe in `absence-proof.ts` includes this
 * text verbatim, so a changed query changes the digest.
 */
export const ABSENCE_PROOF_QUERY_TEXT = [
  "SELECT count(*)::int AS caregiver_outbox_count",
  "  FROM notification",
  " WHERE slot_id = $1::uuid",
  "   AND church_id = $2::uuid",
].join("\n");

// ---------------------------------------------------------------------------
// Recording a call
// ---------------------------------------------------------------------------

export type CoverageCallValidation =
  | { ok: true; outcome: CoverageCallOutcome; note: string | null }
  | {
      ok: false;
      field: "outcome" | "note";
      message: string;
    };

/**
 * A call is a human act, so the outcome is required. The note is optional and
 * kept exactly as typed, with only the textarea's CRLF transport normalised —
 * the same convention as a send-back reason and a thank-you.
 */
export function validateCoverageCall(input: {
  outcome: unknown;
  note: unknown;
}): CoverageCallValidation {
  if (!isCoverageCallOutcome(input.outcome)) {
    return {
      ok: false,
      field: "outcome",
      message: "Choose what happened on the call.",
    };
  }

  if (typeof input.note !== "string" || input.note.trim().length === 0) {
    return { ok: true, outcome: input.outcome, note: null };
  }

  const note = input.note.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (note.length > COVERAGE_NOTE_MAX_LENGTH) {
    return {
      ok: false,
      field: "note",
      message: `Keep the note under ${COVERAGE_NOTE_MAX_LENGTH} characters so it stays easy to read.`,
    };
  }

  return { ok: true, outcome: input.outcome, note };
}

// ---------------------------------------------------------------------------
// The one gate both coverage paths share
// ---------------------------------------------------------------------------

export type CoverageCallGate =
  | { ok: true }
  | { ok: false; code: "needs_call"; message: string };

/**
 * Has a person spoken with the family about this time?
 *
 * Both the re-offer path and the close path call this predicate, so a time
 * that promised a call cannot move on either route with zero `call_log` rows.
 * Each caller supplies its own plain sentence, because the next human action
 * differs; the rule itself is written once here.
 */
export function coverageCallGate(input: {
  calls: number;
  refusal: string;
}): CoverageCallGate {
  if (input.calls >= 1) return { ok: true };
  return { ok: false, code: "needs_call", message: input.refusal };
}

/** The sentence when a re-offer is attempted before any call. */
export const COVERAGE_REOFFER_NEEDS_CALL =
  "Record a call first. A time is never offered to the congregation again until a person has spoken with the family.";

/** The sentence when a close is attempted before any call. */
export const COVERAGE_CLOSE_NEEDS_CALL =
  "Record the call first. This time needs a call, and a time is never closed without one. Nothing was changed.";

// ---------------------------------------------------------------------------
// Offering the same time again
// ---------------------------------------------------------------------------

/**
 * Move a time one or more whole weeks forward, so a re-offer has at least a
 * day to be seen. The window duration is preserved. A time with no window
 * cannot be re-offered: there is nothing to put on the board.
 *
 * Session-linked times are handled by the repository, which looks up the next
 * real Respite Morning rather than inventing an instant.
 */
export function reofferWindow(input: {
  windowStart: Date | null;
  windowEnd: Date | null;
  now: Date;
}): { windowStart: Date; windowEnd: Date | null } | null {
  if (!input.windowStart || Number.isNaN(input.windowStart.getTime())) {
    return null;
  }

  const earliest = input.now.getTime() + DAY_MS;
  let weeks = 1;

  while (
    input.windowStart.getTime() + weeks * WEEK_MS <
    earliest
  ) {
    weeks += 1;
  }

  const windowStart = new Date(
    input.windowStart.getTime() + weeks * WEEK_MS,
  );
  const windowEnd =
    input.windowEnd && !Number.isNaN(input.windowEnd.getTime())
      ? new Date(input.windowEnd.getTime() + weeks * WEEK_MS)
      : null;

  return { windowStart, windowEnd };
}

export type CoverageReofferRefusalCode =
  | "not_open"
  | "needs_call"
  | "already_reoffered";

export type CoverageReofferGuard =
  | { ok: true }
  | { ok: false; code: CoverageReofferRefusalCode; message: string };

/**
 * A time is offered again at most once, and only after a person has actually
 * called the family. Both conditions are re-checked inside the row lock; the
 * disabled button is an affordance, never the enforcement.
 */
export function coverageReofferRefusal(input: {
  status: string;
  calls: number;
  reoffers: number;
}): CoverageReofferGuard {
  if (input.status !== "open") {
    return {
      ok: false,
      code: "not_open",
      message: coverageExpiryRefusalCopy(input.status),
    };
  }

  if (input.reoffers > 0) {
    return {
      ok: false,
      code: "already_reoffered",
      message:
        "This time has already been offered again once. A person will decide what happens next; it will not be offered a third time.",
    };
  }

  if (input.calls < 1) {
    return coverageCallGate({
      calls: input.calls,
      refusal: COVERAGE_REOFFER_NEEDS_CALL,
    });
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Closing a time without a claim
// ---------------------------------------------------------------------------

export type CoverageCloseGuard =
  | { ok: true }
  | { ok: false; code: "not_open" | "needs_call"; message: string };

/**
 * The close path's gate.
 *
 * A card that says "This time needs a call now." made a promise. That promise
 * is kept or the close is refused: the same call predicate the re-offer path
 * uses, applied only while the card actually carries the call promise. A time
 * still waiting for its watch to open never promised a call, so it closes
 * exactly as it did before.
 */
export function coverageCloseRefusal(input: {
  status: string;
  calls: number;
  isDue: boolean;
}): CoverageCloseGuard {
  if (input.status !== "open") {
    return {
      ok: false,
      code: "not_open",
      message: coverageExpiryRefusalCopy(input.status),
    };
  }

  if (!input.isDue) return { ok: true };

  return coverageCallGate({
    calls: input.calls,
    refusal: COVERAGE_CLOSE_NEEDS_CALL,
  });
}

/**
 * One calm sentence for the state a coordinator actually met. A time can only
 * close without a claim while it is published and nobody has said yes.
 */
export function coverageExpiryRefusalCopy(status: string): string {
  switch (status) {
    case "open":
      return "This time is still published and unclaimed. Recording the outcome will close it and write the proof that no message was sent.";
    case "draft":
      return "This time is still a draft. Only a published time can close without a claim.";
    case "claimed":
      return "A neighbour has said yes to this time. Confirm the claim instead of closing it.";
    case "covered":
      return "This time is covered with the family. It is not unclaimed.";
    case "done":
      return "This time is done. Nothing else is needed.";
    case "cancelled":
      return "The church cancelled this time. Nothing was sent to the family.";
    case "expired_unclaimed":
      return "This time already closed without a claim. The proof is below and nothing was changed.";
    default:
      return "That time is not open, so nothing was changed.";
  }
}

// ---------------------------------------------------------------------------
// The caregiver's line
// ---------------------------------------------------------------------------

/**
 * While a coordinator is working on a time that is not covered yet, the family
 * sees one human sentence naming a day. Never a count, a wait, a decline, or
 * the word "unclaimed". If several days are being worked on, they are named in
 * one sentence.
 */
export function caregiverWorkingSentence(
  weekdays: readonly string[],
): string | null {
  const unique: string[] = [];
  for (const day of weekdays) {
    const clean = day.trim();
    if (clean.length > 0 && !unique.includes(clean)) unique.push(clean);
  }

  if (unique.length === 0) return null;

  if (unique.length === 1) {
    return `Your coordinator is working on ${unique[0]}.`;
  }

  if (unique.length === 2) {
    return `Your coordinator is working on ${unique[0]} and ${unique[1]}.`;
  }

  const head = unique.slice(0, -1).join(", ");
  return `Your coordinator is working on ${head}, and ${unique[unique.length - 1]}.`;
}

// ---------------------------------------------------------------------------
// Action states shared by the server actions and their client forms
// ---------------------------------------------------------------------------

export type CoverageActionField = "outcome" | "note" | "form";

export type CoverageActionState = {
  status: "idle" | "success" | "error";
  message: string;
  field?: CoverageActionField;
  /**
   * What the coordinator had entered when a refusal came back. React 19
   * resets an uncontrolled form after a Server Action, so the call form seeds
   * its chosen outcome and note from this.
   */
  values?: {
    note?: string;
    outcome?: string;
  };
};

export const IDLE_COVERAGE_ACTION: CoverageActionState = {
  status: "idle",
  message: "",
};

export const COVERAGE_SESSION_ENDED =
  "Your sign-in has ended. Open your access link again, then try once more.";

export const COVERAGE_GENERIC_FAILURE =
  "That did not save. Nothing was sent to the family. Please try once more.";


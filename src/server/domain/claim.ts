import {
  boardLockCopy,
  coordinatorDisplayName,
  coordinatorSentenceName,
} from "./board";
import { RULE_CODES, type RuleCode } from "./gating";

/**
 * The claim's human words.
 *
 * One closed set of outcomes, each with exactly one calm sentence. The route
 * uses the same sentences the board shows, so a refusal read in a JSON body and
 * the same refusal read as a banner cannot say different things. No outcome
 * carries SQL, an internal id, a count, a decline, a waiting time, or a score.
 */

export const CLAIM_OUTCOME_CODES = [
  "claimed",
  "taken",
  "already_yours",
  "locked",
  "not_found",
  "not_open",
  "not_volunteer",
] as const;

export type ClaimOutcomeCode = (typeof CLAIM_OUTCOME_CODES)[number];

/** A refusal is never a 500; the closed set maps to exactly these statuses. */
export const CLAIM_HTTP_STATUS: Record<ClaimOutcomeCode, 200 | 403 | 404 | 409> = {
  claimed: 200,
  taken: 409,
  already_yours: 409,
  not_open: 409,
  locked: 403,
  not_volunteer: 403,
  not_found: 404,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isClaimOutcome(value: unknown): value is ClaimOutcomeCode {
  return (
    typeof value === "string" &&
    (CLAIM_OUTCOME_CODES as readonly string[]).includes(value)
  );
}

export function isRuleCode(value: unknown): value is RuleCode {
  return (
    typeof value === "string" &&
    (RULE_CODES as readonly string[]).includes(value)
  );
}

export function claimHttpStatus(code: ClaimOutcomeCode): 200 | 403 | 404 | 409 {
  return CLAIM_HTTP_STATUS[code];
}

export type ClaimCopyOptions = {
  /**
   * The rule that locked the time. Only a closed code is used; anything else
   * falls back to the generic locked sentence rather than echoing input.
   */
  ruleCode?: RuleCode | null;
  coordinatorFirstName?: string | null;
};

/** The one human sentence for an outcome. Never built from request input. */
export function claimCopy(
  code: ClaimOutcomeCode,
  options: ClaimCopyOptions = {},
): string {
  const name = coordinatorDisplayName(options.coordinatorFirstName ?? null);
  // Both outcomes below open with the name, so the shared sentence builder
  // capitalises only the fallback and leaves a resolved name untouched.
  const sentenceName = coordinatorSentenceName(
    options.coordinatorFirstName ?? null,
  );

  switch (code) {
    case "claimed":
      return `Thank you for saying yes. ${sentenceName} will confirm it with you before the time is covered.`;
    case "taken":
      return "Someone else just took this time — thank you for saying yes.";
    case "already_yours":
      return `You already said yes to this time. ${sentenceName} will confirm it with you.`;
    case "locked": {
      const ruleCode = options.ruleCode;
      if (ruleCode && ruleCode !== "eligible") {
        const lock = boardLockCopy(ruleCode, options.coordinatorFirstName ?? null);
        return `${lock.title} ${lock.unlock}`;
      }
      return `That time needs one more thing first. Ask ${name} what would unlock it.`;
    }
    case "not_found":
      return `That time isn't on the board anymore. Ask ${name} to help you find another.`;
    case "not_open":
      return `That time is no longer open. Ask ${name} to help you find another.`;
    case "not_volunteer":
      return `Only a volunteer can take a time from the board. Ask ${name} if you would like to help.`;
  }
}

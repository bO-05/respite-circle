import { claimCopy, type ClaimOutcomeCode } from "@/server/domain/claim";
import type { RuleCode } from "@/server/domain/gating";

/**
 * The claim's answer, on the board.
 *
 * A browser form post is redirected back here with a closed outcome code, so
 * the volunteer reads the same sentence the JSON route would have returned —
 * named for the coordinator who will confirm it. A crafted query string can
 * only choose a code from the closed set and a rule code from the closed set;
 * anything else renders no banner at all.
 */
export function ClaimBanner({
  code,
  ruleCode,
  coordinatorFirstName,
}: {
  code: ClaimOutcomeCode;
  ruleCode: RuleCode | null;
  coordinatorFirstName: string | null;
}) {
  const copy = claimCopy(code, {
    ruleCode: ruleCode && ruleCode !== "eligible" ? ruleCode : null,
    coordinatorFirstName,
  });
  const isWin = code === "claimed";

  return (
    <div
      data-testid="claim-banner"
      data-outcome={code}
      role="status"
      className={`rounded-lg border p-5 ${
        isWin ? "border-green bg-green-soft" : "border-amber bg-amber-soft"
      }`}
    >
      <p className="max-w-prose text-lg leading-relaxed text-ink">{copy}</p>
    </div>
  );
}

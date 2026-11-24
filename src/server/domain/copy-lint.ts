/**
 * The banned-claim list and the scanner behind the copy lint.
 *
 * A claim on this list is banned in UI copy, code comments, the README, and
 * docs, because it either overstates what the app does or invites a question
 * the church cannot win (`statistics.md` §3, `architecture.md` §13). The model
 * is allowed to be uncertain; the copy is not.
 *
 * Pure functions and constants only: the script, the unit test, and any future
 * caller share one definition. This file is the one place the phrases appear
 * verbatim, and `tests/unit/trust-content.test.ts` excludes it from its own
 * source scan.
 */

/** The sixteen phrases the mission contract names, in the contract's order. */
export const REQUIRED_BANNED_CLAIMS = [
  "vetted",
  "HIPAA compliant",
  "platform",
  "AI-powered care",
  "certified safe",
  "fully screened",
  "ecosystem",
  "marketplace",
  "orchestration",
  "seamless",
  "revolutionize",
  "empathy at scale",
  "compassionate AI",
  "AI that understands",
  "replaces your coordinator",
  "zero-touch",
] as const;

/** Why every report-implication phrase is refused, in the lint's own words. */
export const REPORT_CLAIM_MESSAGE =
  "Report claim: the app may say that no report was made. It may never say or imply that one was. Reporting is a person's decision, made on a phone call.";

/**
 * Phrases that say or imply a report was made to the authorities.
 *
 * The mission's audit names "we reported", "a report was submitted", "we
 * contacted APS", "it has been reported", "authorities were notified", and
 * "mandated report"; the safety e2e's own report scan adds "we have reported",
 * "report has been filed", "has been reported to", "notified the police",
 * "notified the authorities", "APS has been notified", and "filed a report".
 * The article-led and bare passive forms are both listed so the lint keeps the
 * article in what it reports ("A report was submitted") while still catching a
 * sentence that starts mid-phrase.
 *
 * A denial is not a claim. `NEGATED_BEFORE` below lets the safety card keep its
 * honest sentence ("No report has been made from this screen") while refusing
 * the same construction with an affirmative subject.
 */
export const REPORT_IMPLICATION_CLAIMS = [
  "we reported",
  "we have reported",
  "we contacted APS",
  "contacted APS",
  "a report was submitted",
  "report was submitted",
  "a report was made",
  "report was made",
  "a report has been made",
  "report has been made",
  "a report has been filed",
  "report has been filed",
  "a report was filed",
  "report was filed",
  "filed a report",
  "it has been reported",
  "has been reported to",
  "authorities were notified",
  "notified the authorities",
  "notified the police",
  "APS has been notified",
  "mandated report",
] as const;

/**
 * The required list, the extra marketing claims `statistics.md` bans in the
 * same spirit, and the report-implication family. A church that says "fully
 * automated" is promising something no coordinated care can keep.
 */
export const BANNED_CLAIMS = [
  ...REQUIRED_BANNED_CLAIMS,
  "fully automated",
  "set it and forget it",
  "no staff needed",
  "reduces headcount",
  "guaranteed safe",
  ...REPORT_IMPLICATION_CLAIMS,
] as const;

const REPORT_CLAIM_SET: ReadonlySet<string> = new Set(REPORT_IMPLICATION_CLAIMS);

export type CopyHit = {
  /** The banned phrase, spelled as it is on the list. */
  claim: string;
  /** 1-based line in the scanned text. */
  line: number;
  /** 1-based column of the match start. */
  column: number;
  /** The matched text exactly as it appeared. */
  matched: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A phrase matches with flexible separators (so "HIPAA-compliant" is caught)
 * and an optional plural or suffix (so "platforms" and "marketplaces" are
 * caught). Word boundaries keep "platform" out of an unrelated word.
 */
function patternFor(claim: string): RegExp {
  const flexible = escapeRegExp(claim).replace(/\\?\s+/g, "[\\s-]+");
  return new RegExp(`\\b${flexible}\\w*\\b`, "gi");
}

const PATTERNS = BANNED_CLAIMS.map((claim) => ({
  claim,
  pattern: patternFor(claim),
}));

/**
 * A report phrase directly after a negation is a denial, not a claim. The
 * window is short on purpose: "No, we reported it" still fails, because the
 * comma breaks the negation and the sentence asserts the report.
 */
const NEGATED_BEFORE =
  /\b(?:no|no[\s-]+one|not|never|nothing|nobody|none|neither|nor|cannot|can't|isn't|wasn't|weren't|hasn't|haven't|hadn't|didn't|doesn't|don't)\s*$/i;

function isNegatedReportClaim(claim: string, text: string, index: number): boolean {
  if (!REPORT_CLAIM_SET.has(claim)) return false;
  return NEGATED_BEFORE.test(text.slice(Math.max(0, index - 32), index));
}

/**
 * The list carries article-led and bare forms of the same phrase, so a
 * sentence can produce two hits at overlapping spans. Keep the longer hit when
 * one span contains the other (so "A report was submitted" is reported with its
 * article) and leave partially overlapping phrases to be reported separately.
 */
function dropContainedHits(hits: readonly CopyHit[]): CopyHit[] {
  const ordered = [...hits].sort(
    (a, b) =>
      a.line - b.line ||
      a.column - b.column ||
      b.matched.length - a.matched.length ||
      a.claim.localeCompare(b.claim),
  );

  const kept: CopyHit[] = [];
  for (const hit of ordered) {
    const end = hit.column + hit.matched.length;
    const covered = kept.some((other) => {
      const otherEnd = other.column + other.matched.length;
      return (
        other.line === hit.line &&
        other.column <= hit.column &&
        otherEnd >= end
      );
    });
    if (!covered) kept.push(hit);
  }

  return kept.sort(
    (a, b) =>
      a.line - b.line || a.column - b.column || a.claim.localeCompare(b.claim),
  );
}

/** Every banned claim found in `text`, in reading order. */
export function scanCopy(text: string): CopyHit[] {
  const hits: CopyHit[] = [];

  for (const { claim, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (isNegatedReportClaim(claim, text, index)) continue;

      const before = text.slice(0, index);
      const lines = before.split("\n");
      hits.push({
        claim,
        line: lines.length,
        column: (lines[lines.length - 1]?.length ?? 0) + 1,
        matched: match[0],
      });
    }
  }

  return dropContainedHits(hits);
}

/**
 * Only the report-implication hits. The safety e2e's own scan asks this
 * narrower question ("does this screen say a report was made?"), and importing
 * the rule keeps that spec from re-declaring a substring of the list.
 */
export function scanReportClaims(text: string): CopyHit[] {
  return scanCopy(text).filter((hit) => REPORT_CLAIM_SET.has(hit.claim));
}

/** The rule behind a claim, when the list has more to say than its name. */
export function claimMessage(claim: string): string | null {
  return REPORT_CLAIM_SET.has(claim) ? REPORT_CLAIM_MESSAGE : null;
}

/** One-line report, for a script or a log. */
export function describeHit(file: string, hit: CopyHit): string {
  return `${file}:${hit.line}:${hit.column} — "${hit.matched}" (${hit.claim})`;
}

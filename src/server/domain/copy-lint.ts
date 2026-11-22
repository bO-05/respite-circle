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

/**
 * The required list plus the extra claims `statistics.md` bans in the same
 * spirit. A church that says "fully automated" is promising something no
 * coordinated care can keep.
 */
export const BANNED_CLAIMS = [
  ...REQUIRED_BANNED_CLAIMS,
  "fully automated",
  "set it and forget it",
  "no staff needed",
  "reduces headcount",
  "guaranteed safe",
] as const;

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

/** Every banned claim found in `text`, in reading order. */
export function scanCopy(text: string): CopyHit[] {
  const hits: CopyHit[] = [];

  for (const { claim, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
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

  return hits.sort(
    (a, b) => a.line - b.line || a.column - b.column || a.claim.localeCompare(b.claim),
  );
}

/** One-line report, for a script or a log. */
export function describeHit(file: string, hit: CopyHit): string {
  return `${file}:${hit.line}:${hit.column} — "${hit.matched}" (${hit.claim})`;
}

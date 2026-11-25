/**
 * The banned-claim list and the scanner behind the copy lint.
 *
 * A claim on this list is banned in UI copy, code comments, the README, and
 * docs, because it either overstates what the app does or invites a question
 * the church cannot win (`statistics.md` §3, `architecture.md` §13). The model
 * is allowed to be uncertain; the copy is not.
 *
 * Two rules live here. `BANNED_CLAIMS` is a list of literal phrases, matched
 * with flexible spacing and suffixes. The report-claim rule is a family
 * (`REPORT_CLAIM_FAMILY`): a subject, a reporting verb, and an agency or a
 * piece of harm. A paraphrase does not need a new literal, only a word in the
 * family.
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
 * The report-claim family: who might report, the verb that carries the claim,
 * and where the report went.
 *
 * `REPORT_IMPLICATION_CLAIMS` above is a list of exact strings, so it only
 * catches the sentences an audit happened to name. This rule matches the shape
 * of the claim instead: "we have reported" and "We've reported", "APS has been
 * notified" and "CPS has been contacted", "We contacted APS" and "We called
 * Adult Protective Services". A new word goes in one of these lists; the unit
 * test walks the lists and proves every member still produces a hit.
 */
export const REPORT_CLAIM_FAMILY = {
  /** Who might make a report: first person, the desk, the app, a named person. */
  subjects: [
    "we",
    "i",
    "they",
    "he",
    "she",
    "someone",
    "staff",
    "the coordinator",
    "a coordinator",
    "the desk",
    "the church",
    "our church",
    "our team",
    "the app",
  ],
  /** Verbs that assert a report when they name harm, a person, or an agency. */
  reportVerbs: ["report", "reported", "reports"],
  /** Verbs that assert a report only when the agency is named. */
  agencyVerbs: [
    "contact",
    "contacted",
    "contacts",
    "call",
    "called",
    "calls",
    "notify",
    "notified",
    "notifies",
    "alert",
    "alerted",
    "alerts",
    "inform",
    "informed",
    "informs",
    "told",
    "tell",
    "tells",
    "let",
    "reached",
    "reach",
    "reaches",
  ],
  /** Where a report goes. The longest name wins so "the police" stays whole. */
  agencies: [
    "CPS",
    "APS",
    "DCFS",
    "Adult Protective Services",
    "Child Protective Services",
    "protective services",
    "the police",
    "police",
    "the authorities",
    "authorities",
    "the sheriff's office",
    "the sheriff",
    "the county",
    "the state",
    "social services",
    "elder services",
    "adult services",
    "the department of social services",
  ],
  /** What makes "reported" a report of harm rather than a status update. */
  harmObjects: [
    "it",
    "this",
    "that",
    "him",
    "her",
    "them",
    "us",
    "the abuse",
    "the neglect",
    "the harm",
    "the injury",
    "the injuries",
    "the bruises",
    "the wounds",
    "the assault",
    "the threats",
    "the threat",
    "the incident",
    "the situation",
    "the concern",
    "a concern",
    "what happened",
  ],
} as const;

/**
 * The claim name for a family hit. It is not a phrase to search for; it is how
 * the lint reports "this sentence asserts a report" without inventing one
 * literal per paraphrase.
 */
export const REPORT_CLAIM_FAMILY_LABEL = "report claim";

/**
 * The required list, the extra marketing claims `statistics.md` bans in the
 * same spirit, and the literal report-implication phrases. The paraphrases are
 * matched by `REPORT_CLAIM_FAMILY_PATTERNS` instead of a longer list. A church
 * that says "fully automated" is promising something no coordinated care can
 * keep.
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

/**
 * Every claim name the report rule owns: the literal report phrases and the
 * family label. `claimMessage` and `scanReportClaims` ask this set, so a family
 * hit is treated as a report claim without adding it to `BANNED_CLAIMS` (which
 * is a list of phrases to search for in rendered copy).
 */
const REPORT_CLAIM_LABELS: ReadonlySet<string> = new Set([
  ...REPORT_IMPLICATION_CLAIMS,
  REPORT_CLAIM_FAMILY_LABEL,
]);

export type CopyHit = {
  /** The rule that matched: a literal banned phrase, or the family label. */
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

/** `the police` becomes `[Tt]he\s+police`, so an agency may start a sentence. */
function phrasePattern(phrase: string): string {
  return escapeRegExp(phrase)
    .split(/\s+/)
    .map((word) => {
      const first = word.charAt(0);
      const rest = word.slice(1);
      return /[a-z]/i.test(first)
        ? `[${first.toUpperCase()}${first.toLowerCase()}]${rest}`
        : word;
    })
    .join("\\s+");
}

function alternation(phrases: readonly string[]): string {
  return [...phrases]
    .sort((left, right) => right.length - left.length)
    .map(phrasePattern)
    .join("|");
}

/**
 * A subject: a first-person pronoun, the desk, the app, or a named person.
 * The negative lookahead keeps a sentence's first ordinary word ("The app…",
 * "This was…", "No report…") from being read as a name.
 */
const FAMILY_SUBJECT = `(?:(?:${alternation(
  REPORT_CLAIM_FAMILY.subjects,
)})(?:'ve|'d)?|(?!(?:The|This|That|These|Those|A|An|It|Nothing|Nobody|No|Someone|Staff|We|I|They|He|She|Our|Your|Their|His|Her|Its)\\b)[A-Z][a-z]+)`;

/**
 * The words allowed between the subject and the verb. It is a closed list on
 * purpose: "We did not report", "We have never reported" and "The app does not
 * contact" cannot match, so a denial stays legal without a later check.
 */
const FAMILY_GAP =
  String.raw`(?:\s+(?:have|has|had|already|then|also|just|only|still|now|today|yesterday|recently|personally|immediately|promptly|formally|officially|quietly|first|both|all)){0,2}\s+`;

const FAMILY_AGENCY = `(?:${alternation(REPORT_CLAIM_FAMILY.agencies)})`;
const FAMILY_HARM = `(?:${alternation(REPORT_CLAIM_FAMILY.harmObjects)})`;
const FAMILY_REPORT_VERB = `(?:${alternation(REPORT_CLAIM_FAMILY.reportVerbs)})`;
const FAMILY_AGENCY_VERB = `(?:${alternation(REPORT_CLAIM_FAMILY.agencyVerbs)})`;

/**
 * The frames a report claim can take. Each is one short regex rather than a
 * phrase, so a new agency, verb or object is covered as soon as it is added to
 * `REPORT_CLAIM_FAMILY`.
 */
const REPORT_CLAIM_FAMILY_PATTERNS: ReadonlyArray<{
  claim: string;
  pattern: RegExp;
}> = [
  // "We've reported this to the authorities.", "Grace reported the abuse.",
  // "We reported the incident to the county."
  {
    claim: REPORT_CLAIM_FAMILY_LABEL,
    pattern: new RegExp(
      String.raw`\b${FAMILY_SUBJECT}${FAMILY_GAP}${FAMILY_REPORT_VERB}\b(?:\s+${FAMILY_HARM}\b|\s+to\s+${FAMILY_AGENCY}\b|\s+${FAMILY_AGENCY}\b|[^.!?\n]{0,30}?\bto\s+${FAMILY_AGENCY}\b)`,
      "g",
    ),
  },
  // "This was reported to the county.", "It has been reported."
  {
    claim: REPORT_CLAIM_FAMILY_LABEL,
    pattern: new RegExp(
      String.raw`\b(?:[Tt]his|[Tt]hat|[Ii]t|[Tt]hey|[Hh]e|[Ss]he|[Ww]e|[Ii])\s+(?:has|have|had|was|were|is|are|got)\s+(?:been\s+)?(?:report(?:ed)?|submit(?:ted)?|fil(?:ed))\b`,
      "g",
    ),
  },
  // "A report was submitted.", "The report has been filed."
  {
    claim: REPORT_CLAIM_FAMILY_LABEL,
    pattern: new RegExp(
      String.raw`\b(?:(?:[Aa]|[Tt]he|[Tt]his|[Tt]hat)\s+)?report\s+(?:was|has\s+been|had\s+been|have\s+been|is\s+being|got)\s+(?:made|filed|submitted|taken|sent|written|logged|forwarded|passed\s+on)\b`,
      "g",
    ),
  },
  // "CPS has been contacted.", "The authorities were notified."
  {
    claim: REPORT_CLAIM_FAMILY_LABEL,
    pattern: new RegExp(
      String.raw`\b${FAMILY_AGENCY}\s+(?:has|have|had|was|were|is|are|got|will\s+be|would\s+be)\s+(?:been\s+)?(?:contact(?:ed)?|notif(?:ied|y)|call(?:ed)?|alert(?:ed)?|inform(?:ed)?|told|report(?:ed)?|sent|reached)\b`,
      "g",
    ),
  },
  // "We called Adult Protective Services.", "We let the police know."
  {
    claim: REPORT_CLAIM_FAMILY_LABEL,
    pattern: new RegExp(
      String.raw`\b${FAMILY_SUBJECT}${FAMILY_GAP}${FAMILY_AGENCY_VERB}\s+(?:to\s+)?${FAMILY_AGENCY}\b`,
      "g",
    ),
  },
  // "A note was sent to the police.", "This was passed on to the county."
  {
    claim: REPORT_CLAIM_FAMILY_LABEL,
    pattern: new RegExp(
      String.raw`\b(?:sent|forwarded|passed\s+on|handed|given|delivered|report(?:ed)?|submit(?:ted)?|fil(?:ed))\b[^.!?\n]{0,40}?\bto\s+${FAMILY_AGENCY}\b`,
      "g",
    ),
  },
];

/**
 * A report phrase directly after a negation is a denial, not a claim. The
 * window is short on purpose: "No, we reported it" still fails, because the
 * comma breaks the negation and the sentence asserts the report.
 */
const NEGATED_BEFORE =
  /\b(?:no|no[\s-]+one|not|never|nothing|nobody|none|neither|nor|cannot|can't|isn't|wasn't|weren't|hasn't|haven't|hadn't|didn't|doesn't|don't)\s*$/i;

/**
 * Some family frames begin at the verb ("It was never formally reported to the
 * police"), so the negation can sit a word or two earlier. A bare "no" is
 * deliberately absent: "No, Grace reported the abuse" still asserts a report.
 */
const NEGATED_VERB_BEFORE =
  /\b(?:not|never|isn't|wasn't|weren't|hasn't|haven't|hadn't|didn't|doesn't|don't|cannot|can't)\b(?:\s+\w+){0,2}\s*$/i;

function isNegatedReportClaim(claim: string, text: string, index: number): boolean {
  if (!REPORT_CLAIM_LABELS.has(claim)) return false;
  const before = text.slice(Math.max(0, index - 32), index);
  if (NEGATED_BEFORE.test(before)) return true;
  return claim === REPORT_CLAIM_FAMILY_LABEL && NEGATED_VERB_BEFORE.test(before);
}

/**
 * A pattern set can carry article-led and bare forms of the same phrase, so a
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

function scanPatterns(
  text: string,
  patterns: ReadonlyArray<{ claim: string; pattern: RegExp }>,
): CopyHit[] {
  const hits: CopyHit[] = [];

  for (const { claim, pattern } of patterns) {
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

function overlaps(left: CopyHit, right: CopyHit): boolean {
  return (
    left.line === right.line &&
    left.column < right.column + right.matched.length &&
    right.column < left.column + left.matched.length
  );
}

/**
 * One sentence can satisfy more than one family frame ("This was reported to
 * the county" is both a passive report and a transfer to an agency). Keep the
 * earliest, then longest, span so the lint names the whole claim once.
 */
function dropOverlappingFamilyHits(hits: readonly CopyHit[]): CopyHit[] {
  const ordered = [...hits].sort(
    (left, right) =>
      left.line - right.line ||
      left.column - right.column ||
      right.matched.length - left.matched.length,
  );

  const kept: CopyHit[] = [];
  for (const hit of ordered) {
    if (!kept.some((other) => overlaps(other, hit))) kept.push(hit);
  }
  return kept;
}

/**
 * Every banned claim found in `text`, in reading order.
 *
 * The literal list runs first and wins any overlap, so the audit's named
 * phrases keep reporting the phrase that was named ("a report was submitted",
 * not "report claim"). The family then catches what the literals cannot: the
 * paraphrases, the contractions, and a subject the list never named.
 */
export function scanCopy(text: string): CopyHit[] {
  const literalHits = scanPatterns(text, PATTERNS);
  const familyHits = dropOverlappingFamilyHits(
    scanPatterns(text, REPORT_CLAIM_FAMILY_PATTERNS).filter(
      (hit) => !literalHits.some((literal) => overlaps(literal, hit)),
    ),
  );

  return [...literalHits, ...familyHits].sort(
    (left, right) =>
      left.line - right.line ||
      left.column - right.column ||
      right.matched.length - left.matched.length ||
      left.claim.localeCompare(right.claim),
  );
}

/**
 * Only the report-claim hits, literal or family. The safety e2e's own scan
 * asks this narrower question ("does this screen say a report was made?"), and
 * importing the rule keeps that spec from re-declaring a substring of the list.
 */
export function scanReportClaims(text: string): CopyHit[] {
  return scanCopy(text).filter((hit) => REPORT_CLAIM_LABELS.has(hit.claim));
}

/** The rule behind a claim, when the list has more to say than its name. */
export function claimMessage(claim: string): string | null {
  return REPORT_CLAIM_LABELS.has(claim) ? REPORT_CLAIM_MESSAGE : null;
}

/** One-line report, for a script or a log. */
export function describeHit(file: string, hit: CopyHit): string {
  return `${file}:${hit.line}:${hit.column} — "${hit.matched}" (${hit.claim})`;
}

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_VISIBILITY,
  AUTO_PUBLISH_TRUST_NOTE,
  CONSENT_TIERS,
  DECIDES_INTRO,
  DECIDES_ROWS,
  HOW_IT_WORKS_LEAD,
  NEVER_COMMITMENTS,
  PRIVACY_ROWS,
  PRIVACY_VIEWERS,
  TRUST_COPY_STRINGS,
} from "@/lib/trust-content";
import {
  BANNED_CLAIMS,
  REPORT_CLAIM_FAMILY,
  REPORT_CLAIM_FAMILY_LABEL,
  REPORT_CLAIM_MESSAGE,
  REPORT_IMPLICATION_CLAIMS,
  REQUIRED_BANNED_CLAIMS,
  claimMessage,
  describeHit,
  scanCopy,
  scanReportClaims,
} from "@/server/domain/copy-lint";
import { NO_REPORT_SENTENCE } from "@/server/domain/holds";

const REPO_ROOT = resolve(__dirname, "../..");

/** Every UI-facing source file, excluding the lint's own definitions. */
function sourceFiles(): string[] {
  const roots = ["src"];
  const files: string[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.(ts|tsx|md)$/.test(entry)) files.push(path);
    }
  };

  for (const root of roots) walk(join(REPO_ROOT, root));

  const readme = join(REPO_ROOT, "README.md");
  try {
    if (statSync(readme).isFile()) files.push(readme);
  } catch {
    // The README belongs to a later feature; scan it when it exists.
  }

  return files.filter(
    (file) => !file.endsWith(join("domain", "copy-lint.ts")),
  );
}

describe("the banned-claim list", () => {
  it("carries every claim the mission contract names", () => {
    const required = [
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
    ];
    expect([...REQUIRED_BANNED_CLAIMS]).toEqual(required);
    for (const claim of required) {
      expect(BANNED_CLAIMS).toContain(claim);
    }
  });

  it("catches each banned claim in a sentence", () => {
    for (const claim of REQUIRED_BANNED_CLAIMS) {
      const found = scanCopy(`A short line about a ${claim} in this church.`);
      expect(found.map((hit) => hit.claim), claim).toContain(claim);
    }
  });

  it("catches hyphen and plural variants", () => {
    expect(scanCopy("This is HIPAA-compliant.")[0]?.claim).toBe(
      "HIPAA compliant",
    );
    expect(scanCopy("Two platforms and marketplaces.").map((hit) => hit.claim)).toEqual(
      expect.arrayContaining(["platform", "marketplace"]),
    );
  });

  it("passes a clean sentence about a person deciding", () => {
    expect(
      scanCopy(
        "A coordinator reads every ask first. Nothing reaches a neighbour until she approves it.",
      ),
    ).toEqual([]);
  });

  it("reports a line number and the matched phrase", () => {
    const hits = scanCopy("first line\nsecond line is vetted\nthird");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.line).toBe(2);
    expect(hits[0]?.claim).toBe("vetted");
  });
});

/**
 * The audit's four planted sentences, plus the variants the safety e2e's own
 * report scan lists. This is the spec for the report-implication lint.
 */
const REPORT_SENTENCES: ReadonlyArray<readonly [string, string]> = [
  ["We have reported this to the authorities.", "we have reported"],
  ["A report was submitted.", "a report was submitted"],
  ["We contacted APS.", "we contacted APS"],
  ["It has been reported.", "it has been reported"],
  ["We reported it last week.", "we reported"],
  ["The report has been filed.", "report has been filed"],
  ["It has been reported to the police.", "it has been reported"],
  ["The authorities were notified.", "authorities were notified"],
  ["We notified the authorities.", "notified the authorities"],
  ["We notified the police.", "notified the police"],
  ["APS has been notified.", "APS has been notified"],
  ["I filed a report last week.", "filed a report"],
  ["This is a mandated report.", "mandated report"],
];

describe("report-implication claims", () => {
  it("keeps every report phrase on the banned list", () => {
    for (const claim of REPORT_IMPLICATION_CLAIMS) {
      expect(BANNED_CLAIMS, claim).toContain(claim);
    }
  });

  it("fails on each report-implication sentence and names the phrase", () => {
    for (const [sentence, claim] of REPORT_SENTENCES) {
      const hits = scanCopy(sentence);
      expect(hits.length, sentence).toBeGreaterThan(0);
      expect(hits.map((hit) => hit.claim), sentence).toContain(claim);
    }
  });

  it("reports an article-led phrase once, with the article", () => {
    const hits = scanCopy("A report was submitted.");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.claim).toBe("a report was submitted");
    expect(hits[0]?.matched).toBe("A report was submitted");
  });

  it("carries the rule for a report claim", () => {
    const [hit] = scanCopy("We have reported this to the authorities.");
    expect(hit).toBeDefined();
    if (!hit) return;

    expect(describeHit("src/example.tsx", hit)).toBe(
      'src/example.tsx:1:1 — "We have reported" (we have reported)',
    );
    expect(claimMessage(hit.claim)).toBe(REPORT_CLAIM_MESSAGE);
    expect(claimMessage("vetted")).toBeNull();
  });

  it("keeps the safety card's plain denial publishable", () => {
    expect(scanCopy(NO_REPORT_SENTENCE)).toEqual([]);
    expect(scanCopy("No report was made from this screen.")).toEqual([]);
    expect(scanCopy("No report has been made from this screen.")).toEqual([]);
    expect(scanCopy("No one filed a report.")).toEqual([]);
  });

  it("does not let punctuation or a new clause hide a claim", () => {
    // The negation must sit directly before the phrase to count as a denial.
    expect(scanCopy("No, we reported it.").map((hit) => hit.claim)).toContain(
      "we reported",
    );
    expect(
      scanCopy("We were asked whether a report was submitted.").map(
        (hit) => hit.claim,
      ),
    ).toContain("a report was submitted");
  });
});

/**
 * VAL-R2COPY-001 — the round-2 audit planted eight paraphrases that the
 * literal list passed, and three negated denials that must stay legal.
 *
 * The rule is a family, not a phrase: `REPORT_CLAIM_FAMILY` is the one place a
 * future subject, verb, agency or harm object is added. The tests below walk
 * those lists, so a word that is added without a matching frame fails here
 * rather than shipping as another blind spot. The scan itself is unchanged:
 * every `.ts`, `.tsx` and `.md` file under `src` plus `README.md`, minus the
 * definitions file — 204 files and zero claims when this test was written.
 */
const REPORT_PARAPHRASES = [
  "We've reported this to the authorities.",
  "We called Adult Protective Services.",
  "We let the police know.",
  "CPS has been contacted.",
  "Grace reported the abuse.",
  "This was reported to the county.",
  "We alerted social services.",
  "CPS has been notified.",
] as const;

const REPORT_DENIALS = [
  // The three the audit named, one per family frame.
  "We did not report this.",
  "Nothing was reported to anyone.",
  "The app does not contact the authorities.",
  // The same denials in the other frames, so the gap cannot quietly widen.
  "We did not call the police.",
  "This was never reported to the county.",
  "A report was never filed.",
  "The police were not notified.",
] as const;

describe("report-claim family (VAL-R2COPY-001)", () => {
  it("fails on each planted paraphrase and names the file, line and rule", () => {
    for (const sentence of REPORT_PARAPHRASES) {
      const hit = scanCopy(sentence)[0];
      expect(hit, sentence).toBeDefined();
      if (!hit) continue;

      expect(hit.claim, sentence).toBe(REPORT_CLAIM_FAMILY_LABEL);
      expect(describeHit("src/planted.tsx", hit), sentence).toMatch(
        /^src\/planted\.tsx:1:\d+ — ".+" \(report claim\)$/,
      );
      expect(claimMessage(hit.claim), sentence).toBe(REPORT_CLAIM_MESSAGE);
      expect(scanReportClaims(sentence), sentence).toHaveLength(1);
    }
  });

  it("keeps every negated denial legal", () => {
    for (const sentence of REPORT_DENIALS) {
      expect(scanCopy(sentence), sentence).toEqual([]);
      expect(scanReportClaims(sentence), sentence).toEqual([]);
    }
  });

  it("keeps every subject in the family live", () => {
    for (const subject of REPORT_CLAIM_FAMILY.subjects) {
      const sentence = `${subject.charAt(0).toUpperCase()}${subject.slice(1)} reported the abuse.`;
      expect(scanReportClaims(sentence), sentence).toHaveLength(1);
    }
  });

  it("keeps every agency in the family live", () => {
    for (const agency of REPORT_CLAIM_FAMILY.agencies) {
      expect(scanReportClaims(`We called ${agency}.`), agency).toHaveLength(1);
    }
  });

  it("keeps every verb in the family live", () => {
    for (const verb of REPORT_CLAIM_FAMILY.reportVerbs) {
      expect(scanReportClaims(`We ${verb} the abuse.`), verb).toHaveLength(1);
    }
    for (const verb of REPORT_CLAIM_FAMILY.agencyVerbs) {
      expect(scanReportClaims(`We ${verb} the police.`), verb).toHaveLength(1);
    }
  });

  it("keeps every named harm in the family live", () => {
    for (const object of REPORT_CLAIM_FAMILY.harmObjects) {
      expect(scanReportClaims(`We reported ${object}.`), object).toHaveLength(1);
    }
  });

  it("runs the lint over the whole app and reports its scan count", () => {
    const tsxCli = resolve(
      REPO_ROOT,
      "node_modules",
      "tsx",
      "dist",
      "cli.mjs",
    );
    const result = spawnSync(
      process.execPath,
      [tsxCli, "scripts/lint-copy.ts"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    const summary =
      /copy lint: (\d+) file\(s\) scanned, no banned claims\./.exec(
        result.stdout,
      );
    expect(summary, result.stdout).not.toBeNull();
    // A collector that silently scans nothing must not read as a clean app.
    expect(Number(summary?.[1] ?? 0)).toBeGreaterThanOrEqual(200);
  });
});

describe("trust page content", () => {
  it("lists all four consent tiers with a requirement each", () => {
    expect(CONSENT_TIERS.map((tier) => tier.tier)).toEqual([
      "Group — Respite Morning",
      "Drive",
      "Meal",
      "In-home",
    ]);
    for (const tier of CONSENT_TIERS) {
      expect(tier.requirement.trim().length).toBeGreaterThan(20);
      expect(tier.who.trim().length).toBeGreaterThan(10);
      expect(tier.what.trim().length).toBeGreaterThan(10);
    }
  });

  it("covers all four privacy viewers for all four fields", () => {
    expect(PRIVACY_VIEWERS.map((viewer) => viewer.key)).toEqual([
      "caregiver",
      "coordinator",
      "claimer",
      "congregation",
    ]);
    expect(PRIVACY_ROWS.map((row) => row.field)).toEqual([
      "Your words",
      "The orientation note",
      "Your family member's name",
      "The time",
    ]);
    for (const row of PRIVACY_ROWS) {
      for (const viewer of PRIVACY_VIEWERS) {
        expect(row[viewer.key].trim().length, `${row.field}/${viewer.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("says both what the AI is given and what it is never given", () => {
    expect(AI_VISIBILITY.some((row) => row.given)).toBe(true);
    expect(
      AI_VISIBILITY.filter((row) => !row.given).map((row) => row.item),
    ).toEqual(
      expect.arrayContaining([
        "Your name, email, or phone number",
        "Your address",
        "The times offered, or who claimed them",
        "Anything another family wrote",
      ]),
    );
  });

  it("gives every decision a value from the AI, plain code, and the coordinator", () => {
    expect(DECIDES_ROWS.length).toBeGreaterThanOrEqual(8);
    for (const row of DECIDES_ROWS) {
      expect(row.ai.trim().length).toBeGreaterThan(0);
      expect(row.code.trim().length).toBeGreaterThan(0);
      expect(row.coordinator.trim().length).toBeGreaterThan(0);
    }
    const publish = DECIDES_ROWS.find((row) =>
      row.decision.toLowerCase().includes("publishes"),
    );
    expect(publish?.ai).toBe("No");
    // The publishing row must describe the low-risk switch instead of denying
    // that a time can ever publish without a coordinator's approval, and it
    // must not offer a kind the app cannot produce.
    expect(publish?.code).toMatch(/only a meal/i);
    expect(publish?.code).toMatch(/signed policy/i);
    expect(publish?.code).toMatch(/decision log/i);
    expect(publish?.code).toMatch(/errands are not available yet/i);
    expect(publish?.coordinator).toMatch(/^Yes/);
    expect(publish?.coordinator).toMatch(/switch/i);
  });

  it("describes the low-risk switch, its limit, its sign-off, and its audit trail", () => {
    // The sentence appears on /how-it-works and /never, and on neither page may
    // it deny that the switch exists once the publishing code reads it.
    expect(TRUST_COPY_STRINGS).toContain(AUTO_PUBLISH_TRUST_NOTE);
    expect(AUTO_PUBLISH_TRUST_NOTE).toMatch(/off by default/i);
    expect(AUTO_PUBLISH_TRUST_NOTE).toMatch(/one low-risk kind: a meal/i);
    expect(AUTO_PUBLISH_TRUST_NOTE).toMatch(/a meal may appear on the board/i);
    expect(AUTO_PUBLISH_TRUST_NOTE).toMatch(/companion place/i);
    expect(AUTO_PUBLISH_TRUST_NOTE).toMatch(/drive/i);
    expect(AUTO_PUBLISH_TRUST_NOTE).toMatch(/in-home visit/i);
    expect(AUTO_PUBLISH_TRUST_NOTE).toMatch(/errands are not available yet/i);
    expect(AUTO_PUBLISH_TRUST_NOTE).toMatch(/signed/i);
    expect(AUTO_PUBLISH_TRUST_NOTE).toMatch(/decision log/i);
    expect(AUTO_PUBLISH_TRUST_NOTE).toMatch(/policy version/i);
    expect(scanCopy(AUTO_PUBLISH_TRUST_NOTE)).toEqual([]);

    // The two sentences that frame the loop carry the same exception, so the
    // page no longer promises that only a person ever offers a time.
    expect(TRUST_COPY_STRINGS).toContain(HOW_IT_WORKS_LEAD);
    expect(TRUST_COPY_STRINGS).toContain(DECIDES_INTRO);
    expect(HOW_IT_WORKS_LEAD).toMatch(/signed policy/i);
    expect(HOW_IT_WORKS_LEAD).toMatch(/publish a meal by itself/i);
    expect(HOW_IT_WORKS_LEAD).toMatch(/errands are not available yet/i);
    expect(DECIDES_INTRO).toMatch(/exception for a meal/i);
    expect(scanCopy(HOW_IT_WORKS_LEAD)).toEqual([]);
    expect(scanCopy(DECIDES_INTRO)).toEqual([]);

    // No rendered trust sentence may offer an errand again. The only allowed
    // mention is the plain statement that errands are not available yet.
    for (const line of TRUST_COPY_STRINGS) {
      expect(line, line).not.toMatch(/meal or an errand|meal and an errand/i);
    }
  });

  it("lists all eight commitments", () => {
    expect(NEVER_COMMITMENTS.map((commitment) => commitment.title)).toEqual([
      "No AI sentences about a person",
      "No scoring",
      "No chasing",
      "No story to the congregation",
      "No fake success",
      "No personal care as a slot",
      "No screening families",
      "No editing words",
    ]);
    for (const commitment of NEVER_COMMITMENTS) {
      expect(commitment.body.trim().length).toBeGreaterThan(80);
      expect(commitment.where.trim().length).toBeGreaterThan(10);
    }
  });

  /**
   * VAL-R2CARE-004 — `/never` is a commitment, not marketing. The sentence a
   * family reads must be literally true for the plainest words the round-2
   * audit used, so it names going to the toilet, dressing, and brushing teeth
   * rather than leaving them to an inference. It stays exactly as strong as
   * before: the ask stops, no times are proposed, and no override applies.
   */
  it("keeps the /never personal-care commitment true for the audited words", () => {
    const commitment = NEVER_COMMITMENTS.find(
      (entry) => entry.id === "no-personal-care",
    );
    expect(commitment).toBeTruthy();
    const body = commitment?.body ?? "";

    expect(body).toContain(
      "If your words raise them, the ask stops, no times are proposed",
    );
    for (const category of [
      "Medication",
      "bathing",
      "dressing",
      "brushing teeth",
      "going to the toilet",
      "lifting",
      "transfers",
    ]) {
      expect(body, category).toContain(category);
    }
    expect(body).toContain(
      "Even an override for a safety flag cannot turn personal care into a time.",
    );
    expect(commitment?.where ?? "").toContain("no times at all");
  });

  it("keeps every trust-page sentence free of a banned claim", () => {
    expect(TRUST_COPY_STRINGS.length).toBeGreaterThan(30);
    for (const line of TRUST_COPY_STRINGS) {
      expect(scanCopy(line), line).toEqual([]);
    }
  });

  it("keeps the whole source tree free of a banned claim", () => {
    const failures = sourceFiles().flatMap((file) =>
      scanCopy(readFileSync(file, "utf8")).map(
        (hit) => `${relative(REPO_ROOT, file)}:${hit.line}: ${hit.claim}`,
      ),
    );
    expect(failures).toEqual([]);
  });
});

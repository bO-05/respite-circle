import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_VISIBILITY,
  CONSENT_TIERS,
  DECIDES_ROWS,
  NEVER_COMMITMENTS,
  PRIVACY_ROWS,
  PRIVACY_VIEWERS,
  TRUST_COPY_STRINGS,
} from "@/lib/trust-content";
import {
  BANNED_CLAIMS,
  REQUIRED_BANNED_CLAIMS,
  scanCopy,
} from "@/server/domain/copy-lint";

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
    expect(publish?.code).toBe("No");
    expect(publish?.coordinator).toMatch(/^Yes/);
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

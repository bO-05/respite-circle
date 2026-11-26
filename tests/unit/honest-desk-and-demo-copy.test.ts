import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * VAL-R2PROM-004 and VAL-R2PROM-008 — the two screens a judge and a
 * coordinator read must state the whole rule and the whole demo.
 *
 * The desk audit page used to end its lead by handing a person every decision
 * the AI did not make, which the signed low-risk auto-publish exception makes
 * false. The demo page said nothing about which part the live model produces.
 * These checks read the shipped source, so a later copy edit cannot quietly
 * restore either claim.
 */

const root = process.cwd();
const deskDir = join(root, "src", "app", "desk");
const auditPagePath = join(deskDir, "audit", "page.tsx");
const demoPagePath = join(root, "src", "app", "demo", "page.tsx");
const demoResetPath = join(root, "src", "app", "demo", "reset", "page.tsx");
const demoFormPath = join(root, "src", "components", "demo-reset-form.tsx");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** JSX writes apostrophes as `&apos;`; flatten so sentences read normally. */
function flatten(source: string): string {
  return source.replace(/&apos;/g, "'").replace(/\s+/g, " ");
}

function walkSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) return walkSources(absolute);
    return /\.(tsx|ts)$/.test(entry.name) ? [absolute] : [];
  });
}

describe("VAL-R2PROM-004 — the desk audit page states both halves", () => {
  const auditPage = read(auditPagePath);
  const lead = /lead="([^"]+)"/.exec(auditPage)?.[1] ?? "";

  it("found the audit lead to check", () => {
    expect(lead).not.toBe("");
  });

  it("names the person who approves what the rules flag", () => {
    expect(lead).toMatch(/a person approves what the rules flag/i);
  });

  it("names the signed low-risk meal that publishes itself first", () => {
    expect(lead).toMatch(/low-risk switch/i);
    expect(lead).toMatch(/reheatable meal may publish itself first/i);
    expect(lead).toMatch(/automatic publication/i);
  });

  it("describes the tier and the event in the same place, in plain words", () => {
    expect(auditPage).toContain("AUTO_PUBLISH_RULES_COPY");
    expect(auditPage).toContain("slot_auto_published");
    expect(auditPage).toMatch(/Published a time\s*\n?\s*automatically/i);
    expect(auditPage).toMatch(/the policy page/i);
  });

  it("does not carry the old absolute, or an equivalent one, on any desk page", () => {
    const files = walkSources(deskDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = read(file);
      expect(text, `${file} must not restore the approval absolute`).not.toMatch(
        /decides?\s+everything|approves?\s+everything\b|\ball other decisions\b/i,
      );
    }
  });
});

describe("VAL-R2PROM-008 — the demo says what it actually does", () => {
  const demoPage = flatten(read(demoPagePath));

  it("says the live model's answers route each ask and the fixed rules can override", () => {
    expect(demoPage).toMatch(
      /the live model's answers route each ask; the app's fixed rules can override\./i,
    );
    expect(demoPage).toMatch(/nine typed questions/i);
    expect(demoPage).not.toMatch(/routing is the live model's/i);
  });

  it("says the calendar around it is fixed so the demonstration repeats", () => {
    expect(demoPage).toMatch(/calendar around it is fixed/i);
    expect(demoPage).toMatch(/demonstration repeats/i);
    expect(demoPage).toMatch(/next four Tuesdays/i);
  });

  it("says a disagreement falls back to the rules, with the reason shown", () => {
    expect(demoPage).toMatch(
      /answers disagree with the church's policy, that ask falls back to the app's backup rules/i,
    );
    expect(demoPage).toMatch(/receipt names the reason in plain words/i);
  });

  it("never implies the model built the whole board", () => {
    expect(demoPage).toMatch(/model does not build the board/i);
    for (const pattern of [
      /model (?:built|builds|produced|produces|wrote|writes) the (?:whole )?board/i,
      /(?:whole )?board (?:was|is) (?:built|written|produced) by the model/i,
      /model built the whole demonstration/i,
    ]) {
      expect(demoPage).not.toMatch(pattern);
    }
  });

  it("carries the same receipt explanation beside the reset form", () => {
    const resetPage = flatten(read(demoResetPath));
    expect(resetPage).toMatch(
      /the live model's answers route each ask; the app's fixed rules can override\./i,
    );
    expect(resetPage).not.toMatch(/routing is the live model's/i);
    expect(resetPage).toMatch(/calendar around it is fixed/i);
    expect(resetPage).toMatch(/falls back to the app's backup rules/i);
    expect(resetPage).toMatch(/reason in plain words/i);
  });

  it("renders a fallback as a sentence, not as the stored code", () => {
    const form = read(demoFormPath);
    expect(form).toContain("demoFallbackSentence");
    expect(form).not.toContain("fell back:");
  });
});

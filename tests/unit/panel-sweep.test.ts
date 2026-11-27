import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The round-5 panel sweep, pinned at the source.
 *
 * The swept surfaces may not carry the soft-card classes any more: the global
 * radius cap makes `rounded-lg` render at 3px, so a computed-radius check
 * alone cannot catch the class coming back. These files are the ones the
 * feature names; every panel in them now opens with a single top rule
 * (`border-t` / `border-t-2`) beside the fill it already had.
 *
 * `src/app/how-it-works/page.tsx` is in the named set but draws no bordered
 * panel of its own — its matrices come from `trust-matrix.tsx` and its rows
 * from table cells with a single bottom rule — so it is checked only for the
 * retired radius utilities.
 */

const CONVERTED = [
  "src/app/desk/policy/page.tsx",
  "src/components/policy-editor-form.tsx",
  "src/app/desk/sessions/page.tsx",
  "src/components/session-calendar-banner.tsx",
  "src/app/desk/audit/page.tsx",
  "src/components/audit-log.tsx",
  "src/app/desk/invite/page.tsx",
  "src/components/invite-composer.tsx",
  "src/components/access-link-list.tsx",
  "src/app/desk/metrics/page.tsx",
  "src/components/metrics-table.tsx",
  "src/components/trust-matrix.tsx",
  "src/app/promises/page.tsx",
  "src/app/never/page.tsx",
  "src/app/ask/page.tsx",
  "src/components/ask-form.tsx",
] as const;

const NO_PANEL_OF_ITS_OWN = ["src/app/how-it-works/page.tsx"] as const;

const ALL = [...CONVERTED, ...NO_PANEL_OF_ITS_OWN];

function source(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("the panel sweep retires the soft card", () => {
  for (const file of ALL) {
    it(`${file} carries no rounded-lg or rounded-xl`, () => {
      expect(source(file)).not.toMatch(/rounded-(lg|xl)\b/);
    });
  }

  for (const file of CONVERTED) {
    it(`${file} opens its panels with one rule`, () => {
      expect(source(file)).toMatch(/border-t(?:-2)?\b/);
    });
  }
});

describe("the panel sweep leaves every control an edge", () => {
  for (const file of ALL) {
    it(`${file} draws no four-sided decorative hairline`, () => {
      // `border border-boundary` (a field) and `border border-accent` (a
      // filled primary button) stay: the border is the control's affordance.
      // A four-sided hairline in a decorative or tone colour is the panel
      // pattern round 5 removes.
      expect(source(file)).not.toMatch(
        /border border-(?:line|amber|accent-soft|red-soft|green-soft)\b/,
      );
    });
  }
});

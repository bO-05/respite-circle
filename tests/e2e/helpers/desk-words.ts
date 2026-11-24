import { expect } from "@playwright/test";

/**
 * The caregiver's pages are consent surfaces, not a desk. These words are the
 * desk's language and must not exist on `/care`, `/ask` or `/ask/[id]`.
 *
 * One list, imported by every route and state scan: `coverage-watch.spec.ts`
 * and `failure-path.spec.ts` both use this helper, so a word added here is
 * banned in both. `nobody` is deliberately absent — `/ask/[id]` says "nobody
 * else sees this" in plain truth, and the scan exists to keep desk vocabulary
 * out, not to ban ordinary English.
 */
export const DESK_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bunclaimed\b/i, "unclaimed"],
  [/\bwaiting\b/i, "waiting"],
  [/\bdeclines?\b/i, "declines"],
  [/\bdeclined\b/i, "declined"],
  [/\bviews?\b/i, "views"],
  [/\bcount\b/i, "count"],
  [/\bcounted\b/i, "counted"],
  [/\bexpired\b/i, "expired"],
  [/places? left/i, "places left"],
  [/remaining/i, "remaining"],
];

/** Assert that `text` carries no desk word. `where` names the route/state. */
export function expectNoDeskConcepts(text: string, where: string): void {
  for (const [pattern, label] of DESK_WORDS) {
    expect(
      pattern.test(text),
      `${where} must not contain the desk word "${label}"`,
    ).toBe(false);
  }
}

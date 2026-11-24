import { expect } from "@playwright/test";

/**
 * The caregiver's pages are consent surfaces, not a desk. These words are the
 * desk's language and must not exist on `/care`, `/ask` or `/ask/[id]`.
 *
 * One list, imported by every route and state scan: `coverage-watch.spec.ts`,
 * `failure-path.spec.ts` and `reminder-outbox.spec.ts` all use this helper, so
 * a word added here is banned in every one of them. `nobody` is deliberately
 * absent — `/ask/[id]` says "nobody else sees this" in plain truth, and the
 * scan exists to keep desk vocabulary out, not to ban ordinary English.
 *
 * `viewed` and `claimant` arrived with `reminder-outbox.spec.ts`: its own
 * board-concept list banned them, and the shared list must carry every word
 * that list refused rather than a spec keeping a second copy.
 */
export const DESK_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bunclaimed\b/i, "unclaimed"],
  [/\bwaiting\b/i, "waiting"],
  [/\bdeclines?\b/i, "declines"],
  [/\bdeclined\b/i, "declined"],
  [/\bviews?\b/i, "views"],
  [/\bviewed\b/i, "viewed"],
  [/\bclaimants?\b/i, "claimant"],
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

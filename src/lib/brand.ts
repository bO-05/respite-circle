/**
 * The one open-ring drawing and the Hall Light colours the generated brand
 * assets share (VAL-R5DES-003).
 *
 * The ring is the app's only non-lucide drawing. It lives in the masthead and
 * in the generated icon and share tiles, is always decorative
 * (`aria-hidden`, no role, no title), and never appears inside `main`, where
 * every icon is still a lucide import.
 *
 * `src/app/icon.svg` repeats the path because a static SVG cannot import a
 * TypeScript constant. `tests/unit/brand-assets.test.ts` fails if the two
 * copies drift, so there is still one source of truth for the geometry.
 */
export const RING_PATH = "M20.2 7.1a9 9 0 1 1-3.4-4.05";

/** Token values from `src/app/globals.css`, for image formats that cannot use CSS. */
export const BRAND = {
  paper: "#efece4",
  ink: "#1f2420",
  inkMuted: "#5c6158",
  accent: "#2f5d45",
  line: "#c9c3b4",
} as const;

/** The description a share card and the Open Graph tags carry. */
export const BRAND_DESCRIPTION =
  "A church-run break for a family that cares for someone.";

/** The share-card title, kept plain so it reads well in a link preview. */
export const BRAND_OG_TITLE =
  "Respite Circle — a church-run break for a family that cares for someone";

/** The fictional/sample stamp every surface repeats, including the share card. */
export const BRAND_STAMP = "Fictional church, fictional families. Sample data.";

/** Alt text for the generated share card. */
export const BRAND_OG_ALT =
  "The Respite Circle open-ring mark and wordmark, with the line: A church-run break for a family that cares for someone.";

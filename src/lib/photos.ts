/**
 * The still-life photographs the app may render, with the two limits every
 * one of them has to carry in its alt text and its visible caption.
 *
 * Round 5 ships five photographs. This module starts with the hall still-life
 * the home hero needs — it is the page's largest image, so it loads eagerly.
 * The remaining four arrive with the photography feature and are added here
 * rather than pasted into a page, so no surface can describe a stock
 * photograph as this church or as anyone in the demo.
 *
 * The credits live beside the file names on purpose: two photographers were
 * confirmed by name, three are unrecorded, and the Unsplash Licence does not
 * require attribution. No name is printed for a photograph whose photographer
 * is unrecorded.
 */
export const HALL_PHOTO = {
  src: "/images/church-pews.jpg",
  width: 1800,
  height: 1200,
  photographer: "Karl Fredrickson",
  alt: "Empty wooden pews facing stained-glass windows and hanging lanterns in a church hall. No people. Not a photograph of this church or of anyone in the demo.",
  caption:
    "An empty hall. Not a photograph of this church, and not of anyone in the demo.",
} as const;

/**
 * The five still-life photographs the app may render, with the limits every
 * one of them has to carry in its alt text and, where a reader sees a large
 * one, its visible caption.
 *
 * Round 5 ships five photographs from Unsplash. They are copied into
 * `public/images/` and served from this app through `next/image`; nothing is
 * hotlinked to a remote image host. Each file carries an explicit intrinsic
 * size so the browser reserves its space and nothing shifts while it loads.
 *
 * The credits live beside the file names on purpose: two photographers were
 * confirmed by name, three are unrecorded, and the Unsplash License does not
 * require attribution. No name is printed for a photograph whose photographer
 * is unrecorded (`photographer: null`).
 *
 * None of these is a photograph of the fictional demo church, of a real
 * congregation, or of anyone in the demo. The alt text says so on every image
 * and the credit line says it again in the footer.
 */

export type StillLifePhoto = {
  /** A same-origin path under `public/images/`. */
  src: string;
  /** The file's intrinsic width in pixels; `next/image` must receive it. */
  width: number;
  /** The file's intrinsic height in pixels; `next/image` must receive it. */
  height: number;
  /** The confirmed photographer, or `null` when the name is not recorded. */
  photographer: string | null;
  /** What is pictured, then both limits. Never calls it "this church". */
  alt: string;
  /** A visible caption for the large placements; repeats the limits. */
  caption?: string;
};

const PEWS_PHOTO = {
  src: "/images/church-pews.jpg",
  width: 1800,
  height: 1200,
  photographer: "Karl Fredrickson",
  alt: "Empty wooden pews facing stained-glass windows and hanging lanterns in a church hall. No people. Not a photograph of this church or of anyone in the demo.",
  caption:
    "An empty hall. Not a photograph of this church, and not of anyone in the demo.",
} as const satisfies StillLifePhoto;

const CHAIR_PHOTO = {
  src: "/images/chairs-table.jpg",
  width: 1800,
  height: 2700,
  photographer: null,
  alt: "An empty wooden chair at a small table set with a teapot, in a bright room with no people. Not a photograph of this church or of anyone in the demo.",
  caption:
    "An empty chair and a pot of tea. Not a photograph of this church, and not of anyone in the demo.",
} as const satisfies StillLifePhoto;

const TEA_PHOTO = {
  src: "/images/tea-mug.jpg",
  width: 1800,
  height: 2484,
  photographer: "Rumman Amin",
  alt: "A mug of tea beside biscuits on a white table. No people. Not a photograph of this church or of anyone in the demo.",
} as const satisfies StillLifePhoto;

const BREAD_PHOTO = {
  src: "/images/bread.jpg",
  width: 1600,
  height: 1065,
  photographer: null,
  alt: "Three loaves of bread on a wooden table. No people. Not a photograph of this church or of anyone in the demo.",
} as const satisfies StillLifePhoto;

const SOUP_PHOTO = {
  src: "/images/soup-bowl.jpg",
  width: 1800,
  height: 1200,
  photographer: null,
  alt: "A bowl of soup on a cloth, with no people. Not a photograph of this church or of anyone in the demo.",
} as const satisfies StillLifePhoto;

/** The five approved still lifes, keyed by the object rather than by page. */
export const STILL_LIFE = {
  pews: PEWS_PHOTO,
  chair: CHAIR_PHOTO,
  tea: TEA_PHOTO,
  bread: BREAD_PHOTO,
  soup: SOUP_PHOTO,
} as const;

/**
 * The home hero is the hall still-life. The name is kept because the home
 * page, its tests and the round-5 contract call it that.
 */
export const HALL_PHOTO = PEWS_PHOTO;

/**
 * The visible credit line in the footer, and the same words in the README.
 * It names the two confirmed photographers, states plainly that the other
 * three are unrecorded, names the license, and repeats the limit. It never
 * prints a name for a photograph whose photographer is unrecorded.
 */
export const PHOTO_CREDIT_LINE =
  "Still-life photographs from Unsplash, used under the Unsplash License: church interior by Karl Fredrickson, tea by Rumman Amin. Three further photographs are by photographers whose names we could not record; the license does not require attribution. None of these photographs is of this church or of anyone in the demo.";

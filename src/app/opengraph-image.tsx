import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import {
  BRAND,
  BRAND_DESCRIPTION,
  BRAND_OG_ALT,
  BRAND_STAMP,
  RING_PATH,
} from "@/lib/brand";

/**
 * The Open Graph share image: the open ring, the two-part wordmark, the
 * product sentence and the fictional/sample stamp, 1200×630.
 *
 * The typefaces come from the app's own files, so the build makes no network
 * request and an offline `npm run build` renders the same picture. They are
 * the static instances of the vendored Fraunces and Source Sans 3 faces, cut
 * at the weights this card uses: the renderer behind `ImageResponse` cannot
 * read a variable font (its bundled OpenType parser requires a `name` table
 * that the variable faces do not expose). `src/app/fonts/README.md` records
 * the exact instancing command. No photograph, and so no photograph of a
 * person, appears in the card.
 */
export const alt = BRAND_OG_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FONT_DIR = path.join(process.cwd(), "src", "app", "fonts");

const [sourceSans, fraunces, frauncesItalic] = await Promise.all([
  readFile(path.join(FONT_DIR, "SourceSans3-Regular.ttf")),
  readFile(path.join(FONT_DIR, "Fraunces-SemiBold.ttf")),
  readFile(path.join(FONT_DIR, "Fraunces-Italic-Medium.ttf")),
]);

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BRAND.paper,
          padding: "72px 84px",
          fontFamily: "Source Sans 3",
          fontWeight: 400,
          color: BRAND.ink,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          <svg width={84} height={84} viewBox="0 0 24 24" fill="none">
            <path
              d={RING_PATH}
              stroke={BRAND.accent}
              strokeWidth={1.85}
              strokeLinecap="round"
            />
          </svg>
          <div
            style={{
              display: "flex",
              fontFamily: "Fraunces",
              fontSize: 64,
              fontWeight: 600,
              letterSpacing: -1,
            }}
          >
            <span>Respite&nbsp;</span>
            <span
              style={{
                fontStyle: "italic",
                fontWeight: 500,
                color: BRAND.accent,
              }}
            >
              Circle
            </span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              display: "flex",
              width: 96,
              height: 3,
              background: BRAND.accent,
            }}
          />
          <div
            style={{
              display: "flex",
              maxWidth: 900,
              fontFamily: "Fraunces",
              fontWeight: 600,
              fontSize: 62,
              lineHeight: 1.16,
              letterSpacing: -1,
            }}
          >
            {BRAND_DESCRIPTION}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              display: "flex",
              width: "100%",
              height: 1,
              background: BRAND.line,
            }}
          />
          <div
            style={{
              display: "flex",
              fontSize: 24,
              fontWeight: 400,
              color: BRAND.inkMuted,
            }}
          >
            {BRAND_STAMP}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Source Sans 3",
          data: sourceSans,
          style: "normal",
          weight: 400,
        },
        {
          name: "Fraunces",
          data: fraunces,
          style: "normal",
          weight: 600,
        },
        {
          name: "Fraunces",
          data: frauncesItalic,
          style: "italic",
          weight: 500,
        },
      ],
    },
  );
}

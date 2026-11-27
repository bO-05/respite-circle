import { ImageResponse } from "next/og";
import { BRAND, RING_PATH } from "@/lib/brand";

/**
 * The apple-touch icon: the open ring in accent on paper, 180×180.
 *
 * Mark-only, so no font is needed and nothing is fetched at build time. iOS
 * applies its own corner mask, so the tile stays full-bleed paper.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND.paper,
        }}
      >
        <svg width={124} height={124} viewBox="0 0 24 24" fill="none">
          <path
            d={RING_PATH}
            stroke={BRAND.accent}
            strokeWidth={1.85}
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}

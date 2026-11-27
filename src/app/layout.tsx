import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { BRAND_DESCRIPTION, BRAND_OG_ALT, BRAND_OG_TITLE } from "@/lib/brand";
import { SITE_NAME } from "@/lib/site-navigation";
import { deploymentUrl } from "@/lib/site-url";
import "./globals.css";

/*
  The two typefaces are vendored with their SIL OFL 1.1 licence (./fonts/OFL.txt)
  and loaded from disk by next/font/local. Nothing here reaches the network,
  which is what keeps `npm run build` — and therefore every e2e webServer —
  independent of any third-party font host.

  Both files are variable faces whose default instance is not Regular
  (Fraunces defaults to 9pt Black, Source Sans 3 to ExtraLight), so each face
  declares its full weight range rather than relying on the file's default.
*/
const fraunces = localFont({
  src: [
    { path: "./fonts/Fraunces.ttf", weight: "100 900", style: "normal" },
    { path: "./fonts/Fraunces-Italic.ttf", weight: "100 900", style: "italic" },
  ],
  variable: "--font-fraunces",
  display: "swap",
});

const sourceSans = localFont({
  src: [
    { path: "./fonts/SourceSans3.ttf", weight: "200 900", style: "normal" },
    {
      path: "./fonts/SourceSans3-Italic.ttf",
      weight: "200 900",
      style: "italic",
    },
  ],
  variable: "--font-source-sans",
  display: "swap",
});

/**
 * Deliberately no `title` here. Public pages own their titles through the
 * metadata API; every guarded route gets its title from the area shell after
 * auth. A page-level `metadata` export would be resolved before its guard and
 * leak the hidden route's name into a refused caregiver's tab.
 *
 * `metadataBase` turns the app's own asset routes into the absolute URLs a
 * share card needs. Only the site's name, a description, and its own icon and
 * share routes are declared: no page-specific information leaks through the
 * root segment.
 */
export const metadata: Metadata = {
  metadataBase: deploymentUrl(),
  description: BRAND_DESCRIPTION,
  // Access links carry a bearer token in the path; never leak it in a Referer.
  referrer: "no-referrer",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon", type: "image/png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: SITE_NAME,
    title: BRAND_OG_TITLE,
    description: BRAND_DESCRIPTION,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: BRAND_OG_ALT,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: BRAND_DESCRIPTION,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: BRAND_OG_ALT,
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${sourceSans.variable} h-full`}
    >
      <body className="flex min-h-full flex-col bg-paper text-ink antialiased">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SiteHeader />
        <div className="flex flex-1 flex-col">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}

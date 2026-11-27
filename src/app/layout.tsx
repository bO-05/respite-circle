import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
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
 */
export const metadata: Metadata = {
  description: "A church-run break for a family that cares for someone.",
  // Access links carry a bearer token in the path; never leak it in a Referer.
  referrer: "no-referrer",
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

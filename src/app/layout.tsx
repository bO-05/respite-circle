import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

/**
 * Deliberately no `title` here. Public pages own their titles through the
 * metadata API; every guarded route gets its title from the area shell after
 * auth. A page-level `metadata` export would be resolved before its guard and
 * leak the hidden route's name into a refused caregiver's tab.
 */
export const metadata: Metadata = {
  description: "A church-run break for the family caregiver.",
  // Access links carry a bearer token in the path; never leak it in a Referer.
  referrer: "no-referrer",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="h-full">
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

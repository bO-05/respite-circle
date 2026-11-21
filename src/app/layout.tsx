import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Respite Circle",
  description: "A church-run break for the family caregiver.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col bg-paper text-ink antialiased">
        {children}
      </body>
    </html>
  );
}

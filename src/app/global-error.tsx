"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  AI_CHIP_LABEL,
  SAMPLE_DATA_STAMP,
  SITE_NAME,
} from "@/lib/site-navigation";
import "./globals.css";

/**
 * Last-resort document for a failure in the root layout itself. It replaces
 * the layout, so it must carry its own html/body, landmarks, skip link, and the
 * sample-data stamp. Metadata exports are not supported in an error boundary;
 * a real `<title>` element is.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col bg-paper text-ink antialiased">
        <title>Something went wrong — Respite Circle</title>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="border-b border-line bg-paper">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="font-serif text-2xl font-semibold text-ink">
              {SITE_NAME}
            </p>
            <nav aria-label="Main">
              <Link
                href="/"
                className="inline-flex min-h-11 items-center rounded-md px-3 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
              >
                Front page
              </Link>
            </nav>
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 py-16 sm:px-6"
        >
          <p className="text-base font-semibold uppercase tracking-wide text-accent">
            Something went wrong
          </p>
          <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">
            This page didn&apos;t load.
          </h1>
          <p className="mt-4 max-w-prose text-xl leading-relaxed text-ink">
            Nothing you did caused this, and nothing private was shown.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="mt-8 inline-flex min-h-11 w-fit items-center rounded-md bg-accent px-5 py-2 text-base font-semibold text-accent-foreground"
          >
            Try again
          </button>
          <p className="mt-4 max-w-prose text-base leading-relaxed text-ink-muted">
            If it keeps happening, open your access link again or call your
            coordinator.
          </p>
        </main>
        <footer className="mt-auto border-t border-line bg-paper">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-8 sm:px-6">
            <p className="w-fit rounded-full border border-line bg-muted px-3 py-1 text-base text-ink-muted">
              {AI_CHIP_LABEL}
            </p>
            <p className="text-base text-ink-muted">{SAMPLE_DATA_STAMP}</p>
          </div>
        </footer>
      </body>
    </html>
  );
}

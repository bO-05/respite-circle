"use client";

import { useEffect } from "react";
import { PageMain } from "@/components/page-main";

/**
 * The 500 boundary for everything inside the root layout. Calm, plain, and
 * specific about the next human action. `retry()` re-fetches the segment; a
 * reload is not required.
 */
export default function ErrorPage({
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
    <>
      <title>Something went wrong — Respite Circle</title>
      <PageMain className="py-16">
        <p className="font-serif italic font-medium text-[17px] text-accent">
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
      </PageMain>
    </>
  );
}

import type { ReactNode } from "react";
import { SampleDataFooter } from "./sample-data-footer";

/** Public, no-session pages: entry help, demo access, and refusal. */
export function PublicPage({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  children?: ReactNode;
}) {
  return (
    <>
      <main
        id="main"
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16"
      >
        {eyebrow ? (
          <p className="text-base font-semibold uppercase tracking-wide text-accent">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">
          {title}
        </h1>
        {lead ? (
          <p className="mt-4 max-w-prose text-xl leading-relaxed text-ink">
            {lead}
          </p>
        ) : null}
        {children ? (
          <div className="mt-8 flex flex-col gap-6">{children}</div>
        ) : null}
      </main>
      <SampleDataFooter />
    </>
  );
}

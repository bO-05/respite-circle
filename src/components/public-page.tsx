import type { ReactNode } from "react";
import { PageMain } from "./page-main";

/**
 * Public, no-session pages: landing support, entry help, and demo access.
 *
 * `wide` is for the trust page and the demo's role-card grid: four trust
 * matrices cannot be read in a 70-character column, and a two-up card grid in
 * the default column would squeeze each card to about 197px. Each matrix and
 * each card still keeps a reading measure of its own.
 */
export function PublicPage({
  eyebrow,
  title,
  lead,
  width = "default",
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  width?: "default" | "wide";
  children?: ReactNode;
}) {
  return (
    <PageMain
      className={width === "wide" ? "max-w-5xl py-16" : "py-16"}
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
    </PageMain>
  );
}

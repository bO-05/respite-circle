import type { ReactNode } from "react";
import { ROLE_LABEL, type Role } from "@/server/auth/policy";
import { SampleDataFooter } from "./sample-data-footer";

/**
 * The calm frame every signed-in foundation page uses. The app shell feature
 * later owns site-wide navigation; the guard and the "signed in as" line stay
 * on each page so a direct URL is always checked next to its content.
 */
export function RolePage({
  person,
  role,
  title,
  lead,
  children,
}: {
  person: { firstName: string; lastName: string };
  role: Role;
  title: string;
  lead?: string;
  children?: ReactNode;
}) {
  return (
    <>
      <main
        id="main"
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-12"
      >
        <p className="text-base text-ink-muted">
          Signed in as{" "}
          <span
            data-testid="signed-in-person"
            className="font-semibold text-ink"
          >
            {person.firstName} {person.lastName}
          </span>
          <span aria-hidden="true"> · </span>
          <span>{ROLE_LABEL[role]}</span>
        </p>
        <h1 className="mt-3 font-serif text-3xl leading-tight text-ink sm:text-4xl">
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

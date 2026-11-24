import type { ReactNode } from "react";
import { ROLE_LABEL, type Role } from "@/server/auth/policy";
import { PageMain } from "./page-main";

/**
 * The calm frame every signed-in foundation page uses. The site header owns
 * role navigation and the global footer owns the sample-data stamp; this
 * component names the person whose own page this is.
 */
export function RolePage({
  person,
  role,
  title,
  lead,
  leadTestId,
  children,
}: {
  person: { firstName: string; lastName: string };
  role: Role;
  title: string;
  lead?: string;
  /** Names the lead paragraph for a screen whose sentence depends on state. */
  leadTestId?: string;
  children?: ReactNode;
}) {
  return (
    <PageMain>
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
        <p
          data-testid={leadTestId}
          className="mt-4 max-w-prose text-xl leading-relaxed text-ink"
        >
          {lead}
        </p>
      ) : null}
      {children ? (
        <div className="mt-8 flex flex-col gap-6">{children}</div>
      ) : null}
    </PageMain>
  );
}

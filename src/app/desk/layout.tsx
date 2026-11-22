import type { ReactNode } from "react";
import { DeputyBanner } from "@/components/deputy-banner";
import { DocumentTitle } from "@/components/document-title";
import { requirePage } from "@/server/auth/guards";
import { DESK_AREA_ROLES } from "@/server/auth/policy";

export const dynamic = "force-dynamic";

/**
 * The desk area's outer shell. Each desk page still names its narrower roles;
 * this only decides who may receive the shell, its title, its navigation, and
 * the deputy's strip. A caregiver is refused here, before any title or private
 * query runs.
 *
 * The deputy banner is part of the shell rather than a page: every desk surface
 * carries the same sentence while a deputy is at the desk, and the coordinator
 * never sees it.
 */
export default async function DeskLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { person, session } = await requirePage(DESK_AREA_ROLES);

  return (
    <>
      <DocumentTitle role={session.role} />
      {session.role === "deputy" ? (
        <DeputyBanner firstName={person.firstName} />
      ) : null}
      {children}
    </>
  );
}

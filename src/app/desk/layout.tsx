import type { ReactNode } from "react";
import { DocumentTitle } from "@/components/document-title";
import { requirePage } from "@/server/auth/guards";
import { DESK_AREA_ROLES } from "@/server/auth/policy";

export const dynamic = "force-dynamic";

/**
 * The desk area's outer shell. Each desk page still names its narrower roles;
 * this only decides who may receive the shell, its title, and its navigation.
 * A caregiver is refused here, before any title or private query runs.
 */
export default async function DeskLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { session } = await requirePage(DESK_AREA_ROLES);

  return (
    <>
      <DocumentTitle role={session.role} />
      {children}
    </>
  );
}

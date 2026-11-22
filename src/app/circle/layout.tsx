import type { ReactNode } from "react";
import { DeputyBanner } from "@/components/deputy-banner";
import { DocumentTitle } from "@/components/document-title";
import { requirePage } from "@/server/auth/guards";
import { BOARD_ROLES } from "@/server/auth/policy";

export const dynamic = "force-dynamic";

/**
 * The board's shell. The deputy sees the same board a coordinator does and
 * carries the same banner here, so the person covering the desk is never in
 * doubt about whose name the next decision will carry.
 */
export default async function CircleLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { person, session } = await requirePage(BOARD_ROLES);

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

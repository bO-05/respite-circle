import type { ReactNode } from "react";
import { DocumentTitle } from "@/components/document-title";
import { requirePage } from "@/server/auth/guards";
import { BOARD_ROLES } from "@/server/auth/policy";

export const dynamic = "force-dynamic";

export default async function CircleLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { session } = await requirePage(BOARD_ROLES);

  return (
    <>
      <DocumentTitle role={session.role} />
      {children}
    </>
  );
}

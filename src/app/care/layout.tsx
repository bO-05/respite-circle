import type { ReactNode } from "react";
import { DocumentTitle } from "@/components/document-title";
import { requirePage } from "@/server/auth/guards";
import { CAREGIVER_ROLES } from "@/server/auth/policy";

export const dynamic = "force-dynamic";

export default async function CareLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { session } = await requirePage(CAREGIVER_ROLES);

  return (
    <>
      <DocumentTitle role={session.role} />
      {children}
    </>
  );
}

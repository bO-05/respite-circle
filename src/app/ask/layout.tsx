import type { ReactNode } from "react";
import { DocumentTitle } from "@/components/document-title";
import { requirePage } from "@/server/auth/guards";
import { CAREGIVER_ROLES } from "@/server/auth/policy";

export const dynamic = "force-dynamic";

/**
 * The shell for a caregiver's own area. The guard runs before the title is
 * written, so a refused request never receives this area's title.
 */
export default async function CaregiverLayout({
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

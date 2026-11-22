import { AskForm } from "@/components/ask-form";
import { RolePage } from "@/components/role-page";
import { CAREGIVER_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { findCoordinatorFirstName } from "@/server/repositories/asks";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const { person, session } = await requirePage(CAREGIVER_ROLES);
  const coordinatorFirstName = await findCoordinatorFirstName(session.churchId);

  const lead = coordinatorFirstName
    ? `Tell us in your own words. ${coordinatorFirstName} reads it first, before anyone else sees a time.`
    : "Tell us in your own words. Your coordinator reads it first, before anyone else sees a time.";

  return (
    <RolePage
      person={person}
      role={session.role}
      title="What does a hard week look like?"
      lead={lead}
    >
      <AskForm coordinatorFirstName={coordinatorFirstName} />
    </RolePage>
  );
}

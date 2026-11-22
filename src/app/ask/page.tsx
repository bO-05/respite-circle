import { AskForm } from "@/components/ask-form";
import { RolePage } from "@/components/role-page";
import { CAREGIVER_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { askAgainHint } from "@/server/domain/closure";
import { findCoordinatorFirstName } from "@/server/repositories/asks";

export const dynamic = "force-dynamic";

/**
 * The caregiver's intake.
 *
 * When a finished ask links back here ("ask again"), the form is deliberately
 * the same blank one: the earlier words are never copied, quoted, or offered
 * as a starting point. The calm note above it says so, and the textarea starts
 * empty. Nothing is created until the caregiver writes and submits.
 */
export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { person, session } = await requirePage(CAREGIVER_ROLES);
  const [coordinatorFirstName, query] = await Promise.all([
    findCoordinatorFirstName(session.churchId),
    searchParams,
  ]);
  const again = typeof query.again === "string";

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
      {again ? (
        <p
          data-testid="ask-again-note"
          className="max-w-prose rounded-lg border border-line bg-surface p-5 text-base leading-relaxed text-ink-muted"
        >
          {askAgainHint()}
        </p>
      ) : null}
      <AskForm coordinatorFirstName={coordinatorFirstName} />
    </RolePage>
  );
}

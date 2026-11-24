import { AskForm } from "@/components/ask-form";
import { CaregiverAskLinks } from "@/components/caregiver-ask-links";
import { CaregiverInviteBanner } from "@/components/caregiver-invite";
import { RolePage } from "@/components/role-page";
import { CAREGIVER_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { askAgainHint } from "@/server/domain/closure";
import {
  findCoordinatorFirstName,
  listCaregiverAsks,
} from "@/server/repositories/asks";
import {
  listCaregiverInvites,
  markCaregiverInvitesSeen,
} from "@/server/repositories/invites";
import { isAutoPublishLowRiskInForce } from "@/server/repositories/policy";

export const dynamic = "force-dynamic";

/**
 * The caregiver's intake.
 *
 * When a finished ask links back here ("ask again"), the form is deliberately
 * the same blank one: the earlier words are never copied, quoted, or offered
 * as a starting point. The calm note above it says so, and the textarea starts
 * empty. Nothing is created until the caregiver writes and submits.
 *
 * An invitation sent by a coordinator is the first thing a family sees here.
 * Rendering it records the first look (`seen_at`) so the desk can tell an
 * opened invitation from one still waiting; the words themselves never change.
 */
export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { person, session } = await requirePage(CAREGIVER_ROLES);
  const [coordinatorFirstName, invites, asks, autoPublishLowRisk, query] =
    await Promise.all([
      findCoordinatorFirstName(session.churchId),
      listCaregiverInvites(session),
      listCaregiverAsks(session),
      isAutoPublishLowRiskInForce(session.churchId),
      searchParams,
    ]);
  const again = typeof query.again === "string";
  const unseenInvite = invites.find((invite) => invite.seenAt === null) ?? null;
  if (unseenInvite) {
    // The marker is a courtesy, not a condition of reading. A failed write must
    // not cost the family the page; the invitation still renders below.
    await markCaregiverInvitesSeen(session).catch(() => undefined);
  }

  // The lead makes the same promise as the consent line below it. While the
  // signed policy has the low-risk switch on, "before anyone else sees a time"
  // is no longer true, so the sentence names the one exception instead.
  const lead = autoPublishLowRisk
    ? coordinatorFirstName
      ? `Tell us in your own words. ${coordinatorFirstName} reads what you write, and your words are never shown to anyone else. Under the church's signed low-risk policy, a meal time from your ask may go on the congregation board before she approves that time.`
      : "Tell us in your own words. Your coordinator reads what you write, and your words are never shown to anyone else. Under the church's signed low-risk policy, a meal time from your ask may go on the congregation board before they approve that time."
    : coordinatorFirstName
      ? `Tell us in your own words. ${coordinatorFirstName} reads it first, before anyone else sees a time.`
      : "Tell us in your own words. Your coordinator reads it first, before anyone else sees a time.";

  return (
    <RolePage
      person={person}
      role={session.role}
      title="What does a hard week look like?"
      lead={lead}
    >
      {unseenInvite ? <CaregiverInviteBanner invite={unseenInvite} /> : null}
      {again ? (
        <p
          data-testid="ask-again-note"
          className="max-w-prose rounded-lg border border-line bg-surface p-5 text-base leading-relaxed text-ink-muted"
        >
          {askAgainHint()}
        </p>
      ) : null}
      <CaregiverAskLinks
        asks={asks.slice(0, 1)}
        heading="You wrote to us before"
        lead="Your words are kept exactly as you sent them. You can read them, and the nine answers about them, whenever you want."
        linkLabel="Read your last ask again"
        testId="ask-previous-link"
        headingId="ask-previous-heading"
      />
      <AskForm
        coordinatorFirstName={coordinatorFirstName}
        autoPublishLowRisk={autoPublishLowRisk}
      />
    </RolePage>
  );
}

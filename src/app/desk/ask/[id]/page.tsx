import { notFound } from "next/navigation";
import { RolePage } from "@/components/role-page";
import { DraftSlotSection } from "@/components/draft-slot-section";
import { ExclusionPanelSection } from "@/components/exclusion-panel";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { holdReasonFor } from "@/server/domain/desk-queue";
import { getCoordinatorAskWords } from "@/server/repositories/asks";
import { getDraftEditorContext } from "@/server/repositories/draft-slots";
import { getExclusionPanel } from "@/server/repositories/exclusions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  waiting_coordinator: "Waiting for a person",
  safety_hold: "Safety hold — a person will call",
  care_hold: "Personal-care hold — a person will call",
};

/**
 * The coordinator's read of one ask.
 *
 * The caregiver's words are shown character-for-character, in a block with no
 * textarea, no contenteditable, and no form action. The database trigger backs
 * that up: an UPDATE to `ask.verbatim_text` is rejected, and every later edit
 * is a separate append-only revision. The lock note names that guarantee so a
 * coordinator never goes looking for an edit control that does not exist.
 */
export default async function DeskAskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { person, session } = await requirePage(DESK_ROLES);
  const { id } = await params;

  // Three independent scoped reads in parallel: the words, the drafts, and the
  // exclusion explanations. The Neon round trip is ~325 ms, so the page must
  // not serialise them.
  const [review, draftContext, exclusionContext] = await Promise.all([
    getCoordinatorAskWords(session, id),
    getDraftEditorContext(session, id),
    getExclusionPanel(session, id),
  ]);

  if (!review || !draftContext || !exclusionContext) {
    notFound();
  }

  const holdReason = holdReasonFor(review.status);

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Ask review"
      lead="A person reads every word before anything is published. Nothing here goes to a neighbour until it is approved."
    >
      <dl className="grid gap-4 rounded-lg border border-line bg-surface p-5 sm:grid-cols-2">
        <div>
          <dt className="text-base font-semibold text-ink">Family</dt>
          <dd className="mt-1 text-base text-ink-muted">
            {review.caregiverFirstName}
          </dd>
        </div>
        <div>
          <dt className="text-base font-semibold text-ink">The person cared for</dt>
          <dd className="mt-1 text-base text-ink-muted">
            {review.careRecipientFirstName}
          </dd>
        </div>
        <div>
          <dt className="text-base font-semibold text-ink">Status</dt>
          <dd className="mt-1 text-base text-ink-muted">
            {STATUS_LABEL[review.status] ?? "Waiting for a person"}
          </dd>
        </div>
        <div>
          <dt className="text-base font-semibold text-ink">Church</dt>
          <dd className="mt-1 text-base text-ink-muted">
            Only your own church&apos;s asks appear here.
          </dd>
        </div>
      </dl>

      {holdReason ? (
        <p
          data-testid="desk-detail-hold"
          className="rounded-md border border-accent-soft bg-accent-soft px-4 py-3 text-lg leading-relaxed text-ink"
        >
          {holdReason}
        </p>
      ) : null}

      <section
        aria-labelledby="caregiver-words"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="caregiver-words" className="font-serif text-2xl text-ink">
          The family&apos;s own words
        </h2>
        <p
          data-testid="verbatim-lock"
          className="mt-2 max-w-prose text-base leading-relaxed text-ink"
        >
          <span className="font-semibold">Locked.</span> These words are stored
          exactly as they arrived. No one can edit them from this screen — not a
          coordinator, not a deputy. If the family sends new words, they are
          added as a new version and these stay as they were.
        </p>
        <blockquote
          data-testid="desk-verbatim"
          className="mt-4 max-w-prose whitespace-pre-wrap break-words rounded-md border border-line bg-accent-soft px-5 py-4 text-xl leading-relaxed text-ink"
        >
          {review.text}
        </blockquote>
        {review.revisionCount > 1 ? (
          <p className="mt-3 text-base text-ink-muted">
            This is the latest of {review.revisionCount} versions the family
            has written.
          </p>
        ) : null}
      </section>

      <DraftSlotSection context={draftContext} timeZone={draftContext.timeZone} />

      <ExclusionPanelSection context={exclusionContext} />
    </RolePage>
  );
}

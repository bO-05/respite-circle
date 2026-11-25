import { notFound } from "next/navigation";
import { RolePage } from "@/components/role-page";
import { AskReviewSection } from "@/components/ask-review-section";
import { DraftSlotSection } from "@/components/draft-slot-section";
import { ExclusionPanelSection } from "@/components/exclusion-panel";
import { HoldCardSection } from "@/components/hold-card";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { holdReasonFor, bilingualSummarySentence } from "@/server/domain/desk-queue";
import { formatWindowLabel } from "@/server/domain/slots";
import {
  getCoordinatorAskWords,
  markAskReadByDesk,
} from "@/server/repositories/asks";
import { getAskPublication } from "@/server/repositories/ask-review";
import { getDraftEditorContext } from "@/server/repositories/draft-slots";
import { getExclusionPanel } from "@/server/repositories/exclusions";
import { getHeldAskCard } from "@/server/repositories/holds";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "Not submitted yet",
  waiting_coordinator: "Waiting for a person",
  safety_hold: "Safety hold — a person will call",
  care_hold: "Personal-care hold — a person will call",
  approved: "Approved — published to the board",
  sent_back: "Sent back to the family",
  closed: "Closed",
  withdrawn: "Withdrawn",
};

/**
 * The coordinator's read of one ask.
 *
 * The caregiver's words are shown character-for-character, in a block with no
 * textarea, no contenteditable, and no form action. The database trigger backs
 * that up: an UPDATE to `ask.verbatim_text` is rejected, and every later edit
 * is a separate append-only revision. The lock note names that guarantee so a
 * coordinator never goes looking for an edit control that does not exist.
 *
 * Rendering this page *is* the desk read. `markAskReadByDesk` records the
 * first one on the ask row with a single conditional UPDATE, so the caregiver's
 * waiting pill stops saying "not read yet" from that moment and the instant
 * never varies by which coordinator looked. It sits in the same parallel batch
 * as the reads: it is church-scoped and ask-scoped, so an ask this page would
 * refuse matches no row, and a second render — including React rendering the
 * component twice — leaves the first instant exactly as it was.
 */
export default async function DeskAskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { person, session } = await requirePage(DESK_ROLES);
  const { id } = await params;

  // Six round trips in parallel: five scoped reads (the words, the drafts, the
  // exclusion explanations, the approval/send-back record, and the held ask's
  // human route) plus the first desk read. The Neon round trip is ~325 ms, so
  // the page must not serialise them.
  const [review, draftContext, exclusionContext, publication, heldCard] =
    await Promise.all([
      getCoordinatorAskWords(session, id),
      getDraftEditorContext(session, id),
      getExclusionPanel(session, id),
      getAskPublication(session, id),
      getHeldAskCard(session, id),
      markAskReadByDesk(session, id),
    ]);

  if (!review || !draftContext || !exclusionContext || !publication) {
    notFound();
  }

  const holdReason = holdReasonFor(review.status);
  // The draft editor belongs to the review step and the two hold states. After
  // a decision, the review section owns the published times and held drafts.
  const showDraftEditor =
    review.status === "waiting_coordinator" ||
    review.status === "safety_hold" ||
    review.status === "care_hold";

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Ask review"
      lead="A person reads every word. A time reaches a neighbour only after that person approves it, unless the signed low-risk policy has published a meal by itself."
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

      {review.bilingualNeeded ? (
        <p
          data-testid="desk-detail-bilingual"
          role="status"
          className="max-w-prose rounded-md border border-amber bg-amber-soft px-4 py-3 text-lg leading-relaxed text-ink"
        >
          {bilingualSummarySentence(review.language)}
        </p>
      ) : null}

      {heldCard ? <HoldCardSection held={heldCard} /> : null}

      {review.safetyOverrideAt ? (
        <section
          data-testid="desk-override-record"
          aria-labelledby="desk-override-record-heading"
          className="flex flex-col gap-2 rounded-lg border border-amber bg-amber-soft p-5"
        >
          <h2
            id="desk-override-record-heading"
            className="font-serif text-2xl text-ink"
          >
            Safety hold converted by a person
          </h2>
          <p className="max-w-prose text-base leading-relaxed text-ink">
            {review.safetyOverrideByName ?? "A coordinator"} confirmed a call
            with the family on{" "}
            {formatWindowLabel(
              review.safetyOverrideAt,
              null,
              draftContext.timeZone,
            )}{" "}
            and recorded why. This was an explicit action, not an automatic
            one.
          </p>
          {review.safetyOverrideReason ? (
            <blockquote
              data-testid="desk-override-reason"
              className="max-w-prose whitespace-pre-wrap break-words rounded-md border border-line bg-surface px-4 py-3 text-base leading-relaxed text-ink"
            >
              {review.safetyOverrideReason}
            </blockquote>
          ) : null}
        </section>
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

      {showDraftEditor ? (
        <DraftSlotSection context={draftContext} timeZone={draftContext.timeZone} />
      ) : null}

      <ExclusionPanelSection context={exclusionContext} />

      <AskReviewSection
        askId={publication.askId}
        status={publication.status}
        publication={publication}
        drafts={draftContext.slots}
      />
    </RolePage>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { RolePage } from "@/components/role-page";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { getCoordinatorAskWords } from "@/server/repositories/asks";

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
 * is a separate append-only revision.
 */
export default async function DeskAskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { person, session } = await requirePage(DESK_ROLES);
  const { id } = await params;
  const review = await getCoordinatorAskWords(session, id);

  if (!review) {
    notFound();
  }

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

      <section
        aria-labelledby="caregiver-words"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="caregiver-words" className="font-serif text-2xl text-ink">
          The family&apos;s own words
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          These are the words the family sent. They are read-only for every
          role, including yours. A later edit becomes a new version; the first
          words stay exactly as they arrived.
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

      <Link
        href="/desk"
        className="inline-flex min-h-11 w-fit items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink"
      >
        Back to the desk
      </Link>
    </RolePage>
  );
}

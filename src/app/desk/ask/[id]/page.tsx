import Link from "next/link";
import { notFound } from "next/navigation";
import { RolePage } from "@/components/role-page";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { getDeskAsk } from "@/server/repositories/coordinator";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  waiting_coordinator: "Waiting for a person",
  safety_hold: "Safety hold — a person will call",
  care_hold: "Personal-care hold — a person will call",
};

export default async function DeskAskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { person, session } = await requirePage(DESK_ROLES);
  const { id } = await params;
  const review = await getDeskAsk(session, id);

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

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        The caregiver&apos;s own words appear on this page, read-only, when the
        desk review screen is built. No edit control will ever be added.
      </p>

      <Link
        href="/desk"
        className="inline-flex min-h-11 w-fit items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink"
      >
        Back to the desk
      </Link>
    </RolePage>
  );
}

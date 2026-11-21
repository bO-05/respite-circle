import Link from "next/link";
import { notFound } from "next/navigation";
import { RolePage } from "@/components/role-page";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { getDeskSlot } from "@/server/repositories/coordinator";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  companion: "Companion place",
  home: "In-home visit",
  drive: "Drive",
  meal: "Meal",
  errand: "Errand",
};

const WINDOW = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
});

export default async function DeskSlotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { person, session } = await requirePage(DESK_ROLES);
  const { id } = await params;
  const review = await getDeskSlot(session, id);

  if (!review) {
    notFound();
  }

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Slot review"
      lead="A slot is a time, never a story. The caregiver's words and orientation note are not part of this view."
    >
      <dl className="grid gap-4 rounded-lg border border-line bg-surface p-5 sm:grid-cols-2">
        <div>
          <dt className="text-base font-semibold text-ink">Kind</dt>
          <dd className="mt-1 text-base text-ink-muted">
            {KIND_LABEL[review.kind] ?? review.kind}
          </dd>
        </div>
        <div>
          <dt className="text-base font-semibold text-ink">Status</dt>
          <dd className="mt-1 text-base text-ink-muted">{review.status}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-base font-semibold text-ink">Label</dt>
          <dd className="mt-1 text-base text-ink-muted">{review.label}</dd>
        </div>
        {review.windowStart ? (
          <div className="sm:col-span-2">
            <dt className="text-base font-semibold text-ink">Window</dt>
            <dd className="mt-1 text-base text-ink-muted">
              {WINDOW.format(review.windowStart)}
              {review.windowEnd ? ` – ${WINDOW.format(review.windowEnd)}` : ""}
            </dd>
          </div>
        ) : null}
        {review.gated ? (
          <div className="sm:col-span-2">
            <dt className="text-base font-semibold text-ink">Gate</dt>
            <dd className="mt-1 text-base text-ink-muted">
              This slot needs the in-home or transport checks before a neighbour
              can take it.
            </dd>
          </div>
        ) : null}
      </dl>

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        Only slots from your own church can be opened here. Another church&apos;s
        slot behaves exactly like a missing one.
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

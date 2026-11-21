import { RolePage } from "@/components/role-page";
import { requirePage } from "@/server/auth/guards";
import { DESK_AREA_ROLES } from "@/server/auth/policy";

export const dynamic = "force-dynamic";

/**
 * The pastor's read-only home. The metrics feature fills the counts; until
 * then this is an honest empty state, not invented numbers.
 */
export default async function DeskMetricsPage() {
  const { person, session } = await requirePage(DESK_AREA_ROLES);

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Church numbers"
      lead="Counts from the church's own records — households served, asks, times covered, and calls made."
    >
      <section
        aria-labelledby="metrics-empty"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="metrics-empty" className="font-serif text-2xl text-ink">
          Nothing counted yet
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          When asks and times are recorded, the counts appear here for a range a
          coordinator chooses. No rankings and no scores.
        </p>
      </section>
    </RolePage>
  );
}

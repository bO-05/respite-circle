import { RolePage } from "@/components/role-page";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function DeskAuditPage() {
  const { person, session } = await requirePage(DESK_ROLES);

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Who decided what, and when"
      lead="The AI's typed answers and the human decisions are kept apart, each with its actor and time."
    >
      <section
        aria-labelledby="audit-append-only"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="audit-append-only" className="font-serif text-2xl text-ink">
          Append-only
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          No screen and no request can edit or delete an audit entry. The public
          decision log stores a digest, never the caregiver&apos;s own words.
        </p>
      </section>
    </RolePage>
  );
}

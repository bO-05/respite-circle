import { RolePage } from "@/components/role-page";
import { CLAIMS_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function MyClaimsPage() {
  const { person, session } = await requirePage(CLAIMS_ROLES);

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Times you've offered to cover"
      lead="Only your own claims appear here, and the family's orientation note arrives after the coordinator approves your claim."
    >
      <section
        aria-labelledby="claims-empty"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="claims-empty" className="font-serif text-2xl text-ink">
          Nothing claimed yet
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          When you claim a time, it shows here with one calm status line. The
          family&apos;s words are never part of this list.
        </p>
      </section>
    </RolePage>
  );
}

import { RolePage } from "@/components/role-page";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function DeskPolicyPage() {
  const { person, session } = await requirePage(DESK_ROLES);

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Church policy and promises"
      lead="Every published version keeps its author, its named sign-off, and the date it was saved."
    >
      <section
        aria-labelledby="policy-versioned"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="policy-versioned" className="font-serif text-2xl text-ink">
          Versioned, never rewritten
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          Saving an edit creates a new version. The promises a family was given
          stay exactly as they were. Publishing waits for a named person to sign
          it.
        </p>
      </section>
    </RolePage>
  );
}

import { RolePage } from "@/components/role-page";
import { CAREGIVER_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const { person, session } = await requirePage(CAREGIVER_ROLES);

  return (
    <RolePage
      person={person}
      role={session.role}
      title="What does a hard week look like?"
      lead="Tell us in your own words. A named coordinator reads it before anyone else sees a time."
    >
      <section
        aria-labelledby="words-stay-yours"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="words-stay-yours" className="font-serif text-2xl text-ink">
          Your words stay yours
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          Nothing you write here is shown to a neighbour. A person decides what,
          if anything, can be offered, and you will hear from them first.
        </p>
      </section>
    </RolePage>
  );
}

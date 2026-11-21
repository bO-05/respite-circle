import { RolePage } from "@/components/role-page";
import { CAREGIVER_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function CarePage() {
  const { person, session } = await requirePage(CAREGIVER_ROLES);

  return (
    <RolePage
      person={person}
      role={session.role}
      title="What's covered for your family"
      lead="The times a neighbour has taken, and the words the church has sent you."
    >
      <section
        aria-labelledby="care-empty"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="care-empty" className="font-serif text-2xl text-ink">
          Nothing to show yet
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          When a time is covered, it appears here with the name of the person
          coming. Nothing is ever counted, timed, or chased.
        </p>
      </section>
    </RolePage>
  );
}

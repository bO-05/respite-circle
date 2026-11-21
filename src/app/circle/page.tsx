import { RolePage } from "@/components/role-page";
import { BOARD_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function CirclePage() {
  const { person, session } = await requirePage(BOARD_ROLES);

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Open times at Respite Morning"
      lead="You see the time and what it needs, never the family's story."
    >
      <section
        aria-labelledby="board-empty"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="board-empty" className="font-serif text-2xl text-ink">
          Nothing is open just now
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          When a coordinator publishes a time, it appears here. A claimed time
          stays calm and quiet until a person confirms it.
        </p>
      </section>
    </RolePage>
  );
}

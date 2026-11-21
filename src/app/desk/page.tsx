import { RolePage } from "@/components/role-page";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { listDeskAsks } from "@/server/repositories/coordinator";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  waiting_coordinator: "Waiting for a person",
  safety_hold: "Safety hold — a person will call",
  care_hold: "Personal-care hold — a person will call",
};

const ASKED_ON = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "America/New_York",
});

export default async function DeskPage() {
  const { person, session } = await requirePage(DESK_ROLES);
  const asks = await listDeskAsks(session);

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Coordinator desk"
      lead="A person reads every ask before a neighbour sees a time. Safety and personal-care asks stay pinned in their own groups."
    >
      <section aria-labelledby="desk-waiting">
        <h2 id="desk-waiting" className="font-serif text-2xl text-ink">
          Waiting for a person
        </h2>

        {asks.length === 0 ? (
          <p className="mt-2 rounded-lg border border-line bg-surface px-4 py-3 text-base text-ink-muted">
            No asks are waiting right now. Nothing has been published.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {asks.map((ask) => (
              <li
                key={ask.id}
                className="rounded-lg border border-line bg-surface p-4"
              >
                <a
                  href={`/desk/ask/${ask.id}`}
                  className="inline-flex min-h-11 items-center text-lg font-semibold text-ink underline decoration-accent underline-offset-4"
                >
                  {ask.caregiverFirstName} — {ask.careRecipientFirstName}
                </a>
                <p className="mt-1 text-base text-ink-muted">
                  {STATUS_LABEL[ask.status] ?? "Waiting for a person"}
                  <span aria-hidden="true"> · </span>
                  asked {ASKED_ON.format(ask.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        This queue is scoped to your own church. An ask from another church
        cannot be opened here, even by its id.
      </p>
    </RolePage>
  );
}

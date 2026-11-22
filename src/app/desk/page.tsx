import Link from "next/link";
import { RolePage } from "@/components/role-page";
import { SessionCalendarStrip } from "@/components/session-calendar-strip";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import {
  QUEUE_CATEGORY_HEADING,
  QUEUE_CATEGORY_NOTE,
  QUEUE_CATEGORY_ORDER,
  groupDeskQueue,
  waitingLabel,
} from "@/server/domain/desk-queue";
import {
  listDeskAsks,
  type DeskQueueItem,
} from "@/server/repositories/coordinator";
import { getDeskSessionOverview } from "@/server/repositories/sessions";

export const dynamic = "force-dynamic";

function QueueRow({ item, now }: { item: DeskQueueItem; now: Date }) {
  return (
    <li
      data-testid="desk-row"
      data-ask-id={item.id}
      data-status={item.status}
      data-category={item.category}
      data-created-at={item.createdAt.toISOString()}
      className="rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <a
          href={`/desk/ask/${item.id}`}
          className="inline-flex min-h-11 items-center text-lg font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          {item.caregiverFirstName}
          <span className="sr-only"> — read this ask</span>
        </a>
        {item.pinLabel ? (
          <span
            data-testid="desk-pin-label"
            className="inline-flex min-h-7 items-center rounded-full border border-accent px-3 text-sm font-semibold text-accent"
          >
            {item.pinLabel}
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-base text-ink-muted">
        For {item.careRecipientFirstName}
      </p>

      <p
        data-testid="desk-reason-summary"
        className="mt-3 text-lg leading-relaxed text-ink"
      >
        {item.reasonSummary}
      </p>

      <p
        data-testid="desk-waiting-time"
        className="mt-2 text-base text-ink-muted"
      >
        <time dateTime={item.createdAt.toISOString()}>
          {waitingLabel(item.createdAt, now)}
        </time>
      </p>

      {item.holdReason ? (
        <p
          data-testid="desk-hold-reason"
          className="mt-3 rounded-md border border-accent-soft bg-accent-soft px-4 py-3 text-base leading-relaxed text-ink"
        >
          {item.holdReason}
        </p>
      ) : null}
    </li>
  );
}

export default async function DeskPage() {
  const { person, session } = await requirePage(DESK_ROLES);
  const [asks, overview] = await Promise.all([
    listDeskAsks(session),
    getDeskSessionOverview(session),
  ]);
  const groups = groupDeskQueue(asks);
  // One server clock for the whole page: every row agrees, and the value is
  // rendered once on the server rather than recomputed during hydration.
  const now = new Date();

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Coordinator desk"
      lead="A person reads every ask before a neighbour sees a time. Safety and personal-care asks stay pinned in their own groups."
    >
      <SessionCalendarStrip overview={overview} />

      {asks.length === 0 ? (
        <section
          data-testid="desk-empty"
          aria-labelledby="desk-empty-heading"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2
            id="desk-empty-heading"
            className="font-serif text-2xl text-ink"
          >
            Nothing is waiting for a person
          </h2>
          <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
            No asks are waiting for a coordinator right now. Next: open the
            Respite Morning board and see which places still need a neighbour.
          </p>
          <Link
            href="/circle"
            className="mt-4 inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            Open the Respite Morning board
          </Link>
        </section>
      ) : (
        <>
          <p className="max-w-prose text-base leading-relaxed text-ink-muted">
            Safety and personal care are pinned in their own groups. Everything
            else is oldest first. No ask is hidden behind a number.
          </p>

          {QUEUE_CATEGORY_ORDER.map((category) => {
            const rows = groups[category];
            if (rows.length === 0) return null;

            return (
              <section
                key={category}
                data-testid={`desk-category-${category}`}
                aria-labelledby={`desk-heading-${category}`}
                className="flex flex-col gap-3"
              >
                <div>
                  <h2
                    id={`desk-heading-${category}`}
                    className="font-serif text-2xl text-ink"
                  >
                    {QUEUE_CATEGORY_HEADING[category]}
                  </h2>
                  <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
                    {QUEUE_CATEGORY_NOTE[category]}
                  </p>
                </div>

                <ul className="flex flex-col gap-3">
                  {rows.map((item) => (
                    <QueueRow key={item.id} item={item} now={now} />
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        This queue is scoped to your own church. An ask from another church
        cannot be opened here, even by its id.
      </p>
    </RolePage>
  );
}

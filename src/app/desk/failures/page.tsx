import Link from "next/link";
import { CoverageCard } from "@/components/coverage-card";
import { RolePage } from "@/components/role-page";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { listCoverageWatch } from "@/server/repositories/coverage";

export const dynamic = "force-dynamic";

/**
 * The coverage watch: published times that no neighbour has taken yet.
 *
 * Every card carries the family's first name, the window, how long the time
 * has been on the board, and a live count of the messages that exist for it.
 * The call form, the one allowed re-offer, and the close-unclaimed action are
 * all here, and every one of them is re-authorized on the server.
 *
 * This page sends nothing. A card may close a time and write the church's
 * proof that zero messages were sent; it never creates an email, a text, or an
 * outbox row.
 *
 * The card names the coordinator responsible for the family, read from the
 * case by the repository. It never names the person looking at the page: a
 * deputy covering the desk must see the same name the lead sees.
 */
export default async function CoverageWatchPage() {
  const { person, session } = await requirePage(DESK_ROLES);
  const items = await listCoverageWatch(session);

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Times nobody has taken yet"
      lead="Times that nobody has taken yet. A person makes the call; the app sends nothing."
    >
      {items.length === 0 ? (
        <section
          data-testid="coverage-empty"
          aria-labelledby="coverage-empty-heading"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2
            id="coverage-empty-heading"
            className="font-serif text-2xl text-ink"
          >
            No time needs a call right now
          </h2>
          <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
            When a published time passes the church&apos;s call threshold
            without a neighbour, it appears here with the family&apos;s first
            name, the window, and the live count of messages sent about it.
          </p>
          <div className="mt-4 flex flex-wrap gap-4">
            <Link
              href="/circle"
              className="inline-flex min-h-11 items-center rounded-md border border-boundary bg-surface px-5 py-2 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
            >
              Open the Respite Morning board
            </Link>
            <Link
              href="/desk"
              className="inline-flex min-h-11 items-center rounded-md border border-boundary bg-surface px-5 py-2 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
            >
              Back to the desk
            </Link>
          </div>
        </section>
      ) : (
        <>
          <p className="max-w-prose text-base leading-relaxed text-ink-muted">
            Oldest first. No time is hidden behind a number, and no family is
            ranked. A card stays here until the time is taken, offered again
            once after a call, or closed with the proof that nothing was sent.
          </p>

          <ul
            data-testid="coverage-list"
            className="flex flex-col gap-4"
            aria-label="Times nobody has taken yet"
          >
            {items.map((item) => (
              <li key={item.slotId}>
                <CoverageCard item={item} />
                <p className="mt-2 px-1 text-base text-ink-muted">
                  <Link
                    href={`/desk/slot/${item.slotId}`}
                    className="font-semibold text-ink underline decoration-accent underline-offset-4"
                  >
                    Open the full time review
                  </Link>
                  .
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        Nothing on this page sends an email or a text message. Closing a time
        writes the church&apos;s proof that zero messages were sent about it.
      </p>

      <Link
        href="/desk"
        className="inline-flex min-h-11 w-fit items-center rounded-md border border-boundary bg-surface px-5 py-2 text-base font-semibold text-ink"
      >
        Back to the desk
      </Link>
    </RolePage>
  );
}

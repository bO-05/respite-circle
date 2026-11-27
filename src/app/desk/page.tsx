import Link from "next/link";
import { CalendarOff } from "lucide-react";
import { DeskQueueSection } from "@/components/desk-queue-section";
import { RolePage } from "@/components/role-page";
import { SessionCalendarStrip } from "@/components/session-calendar-strip";
import { IconWell } from "@/components/visual-primitives";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { groupDeskQueue } from "@/server/domain/desk-queue";
import { listDeskAsks } from "@/server/repositories/coordinator";
import { listPendingClaims } from "@/server/repositories/claim-review";
import {
  COVERAGE_SILENCE_PROMISE,
  coverageMessageCountLine,
} from "@/server/domain/coverage";
import { formatWindowLabel } from "@/server/domain/slots";
import { listCoverageWatch } from "@/server/repositories/coverage";
import { getDeskSessionOverview } from "@/server/repositories/sessions";

export const dynamic = "force-dynamic";

/**
 * The coordinator desk.
 *
 * The order on the screen is the order of the promise: a call today first,
 * because someone calls the family today; then the coverage watch, because a
 * time nobody has taken is a call, not a message; then the Respite Morning
 * calendar; then claims waiting for confirmation; then professional help for
 * the personal-care group and the ordinary queue.
 *
 * A zero on the coverage watch is the product working. Its sentence is
 * ordinary text, never an amber warning block.
 */
export default async function DeskPage() {
  const { person, session } = await requirePage(DESK_ROLES);
  const [asks, overview, pendingClaims, coverageWatch] = await Promise.all([
    listDeskAsks(session),
    getDeskSessionOverview(session),
    listPendingClaims(session),
    listCoverageWatch(session),
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
      lead="A person reads every ask; a signed policy lets a reheated meal go first."
    >
      {/*
        Safety first. This group is the first thing on the page, above the
        coverage watch and above the calendar, and it is drawn as its own
        urgent panel with a larger heading than routine coverage.
      */}
      <DeskQueueSection category="safety" rows={groups.safety} now={now} />

      {coverageWatch.length > 0 ? (
        <section
          data-testid="desk-coverage-watch"
          aria-labelledby="desk-coverage-watch-heading"
          className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5"
        >
          <div>
            <h2
              id="desk-coverage-watch-heading"
              className="font-serif text-2xl text-ink"
            >
              Times nobody has taken yet
            </h2>
            <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
              No neighbour has taken these times yet. A person calls; the app
              sends nothing. A zero below is the promise working, not a
              failure.
            </p>
          </div>

          <ul className="flex flex-col gap-3">
            {coverageWatch.map((item) => (
              <li
                key={item.slotId}
                data-testid="desk-coverage-row"
                data-slot-id={item.slotId}
                data-messages={item.caregiverOutboxCount}
                className="rounded-md border border-line bg-paper p-4"
              >
                <a
                  href={`/desk/slot/${item.slotId}`}
                  className="inline-flex min-h-11 items-center text-lg font-semibold text-ink underline decoration-accent underline-offset-4"
                >
                  {item.caregiverFirstName} — {item.label}
                </a>
                <p className="mt-1 text-base text-ink-muted">
                  {formatWindowLabel(
                    item.windowStart,
                    item.windowEnd,
                    item.timeZone,
                  )}
                </p>
                <p className="mt-1 text-base text-ink-muted">
                  For {item.careRecipientFirstName}. Open for{" "}
                  {item.openForLabel}.
                </p>
                <p
                  data-testid="desk-coverage-row-count"
                  className="mt-2 text-base text-ink"
                >
                  {coverageMessageCountLine(item.caregiverOutboxCount)}
                </p>
                {item.caregiverOutboxCount === 0 ? (
                  <p
                    data-testid="desk-coverage-row-promise"
                    className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted"
                  >
                    {COVERAGE_SILENCE_PROMISE}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          <Link
            href="/desk/failures"
            className="inline-flex min-h-11 w-fit items-center rounded-md border border-boundary bg-surface px-5 py-2 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            See every time nobody has taken yet
          </Link>
        </section>
      ) : null}

      <SessionCalendarStrip overview={overview} />

      {pendingClaims.length > 0 ? (
        <section
          data-testid="desk-pending-claims"
          aria-labelledby="desk-pending-claims-heading"
          className="flex flex-col gap-3"
        >
          <div>
            <h2
              id="desk-pending-claims-heading"
              className="font-serif text-2xl text-ink"
            >
              Claims waiting for your confirmation
            </h2>
            <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
              A neighbour has said yes to these times. Confirming sends the
              family one message from the church&apos;s own template. Taking a
              claim back sends nothing.
            </p>
          </div>

          <ul className="flex flex-col gap-3">
            {pendingClaims.map((claim) => (
              <li
                key={claim.slotId}
                data-testid="desk-pending-claim"
                data-slot-id={claim.slotId}
                className="rounded-lg border border-line bg-surface p-4"
              >
                <a
                  href={`/desk/slot/${claim.slotId}`}
                  className="inline-flex min-h-11 items-center text-lg font-semibold text-ink underline decoration-accent underline-offset-4"
                >
                  {claim.volunteerFirstName ?? "A neighbour"} — {claim.label}
                </a>
                <p className="mt-1 text-base text-ink-muted">
                  {formatWindowLabel(
                    claim.windowStart,
                    claim.windowEnd,
                    claim.timeZone,
                  )}
                </p>
                <p className="mt-1 text-base text-ink-muted">
                  For {claim.careRecipientFirstName} (family:{" "}
                  {claim.caregiverFirstName})
                </p>
                <p
                  data-testid="desk-pending-claim-time"
                  className="mt-2 text-base text-ink"
                >
                  Claimed{" "}
                  {formatWindowLabel(claim.claimedAt, null, claim.timeZone)}.
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {asks.length === 0 ? (
        <section
          data-testid="desk-empty"
          aria-labelledby="desk-empty-heading"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <IconWell icon={CalendarOff} tone="accent" />
          <h2
            id="desk-empty-heading"
            className="mt-3 font-serif text-2xl text-ink"
          >
            Nothing is waiting for a person
          </h2>
          <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
            No asks are waiting for a coordinator right now. Next: open the
            Respite Morning board and see which places still need a neighbour.
          </p>
          <Link
            href="/circle"
            className="mt-4 inline-flex min-h-11 items-center rounded-md border border-boundary bg-surface px-5 py-2 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            Open the Respite Morning board
          </Link>
        </section>
      ) : (
        <>
          <p className="max-w-prose text-base leading-relaxed text-ink-muted">
            A call today and a need for professional help are pinned first.
            Everything else is oldest first. No ask is hidden behind a number.
          </p>

          <DeskQueueSection
            category="personal_care"
            rows={groups.personal_care}
            now={now}
          />
          <DeskQueueSection category="waiting" rows={groups.waiting} now={now} />
        </>
      )}

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        This queue is scoped to your own church. An ask from another church
        cannot be opened here, even by its id.
      </p>

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        <Link
          href="/desk/invite"
          className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          Invite a family by name
        </Link>{" "}
        — the first thing a family receives is a person&apos;s own sentence.
        Nothing is emailed or texted.
      </p>
    </RolePage>
  );
}

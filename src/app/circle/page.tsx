import { RolePage } from "@/components/role-page";
import { BOARD_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { formatApprovalLine } from "@/server/domain/ask-review";
import { formatWindowLabel } from "@/server/domain/slots";
import { getBoard, type BoardSlot } from "@/server/repositories/board";

export const dynamic = "force-dynamic";

const STATUS_COPY: Record<BoardSlot["status"], string> = {
  open: "Open — one neighbour can say yes.",
  claimed: "Claimed — waiting for a coordinator to confirm.",
  covered: "Covered.",
};

/**
 * The congregation board.
 *
 * It shows published times only: kind, human label, window, the gated
 * indicator, and a visible approval line naming the person and the time. It
 * never shows the caregiver's name, the person cared for, their words, or the
 * orientation note — those belong to the coordinator and, later, to the one
 * neighbour who claims a specific time.
 */
export default async function CirclePage() {
  const { person, session } = await requirePage(BOARD_ROLES);
  const board = await getBoard(session);

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Open times at Respite Morning"
      lead="You see the time and what it needs, never the family's story."
    >
      {!board || board.slots.length === 0 ? (
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
      ) : (
        <section
          aria-labelledby="board-heading"
          className="flex flex-col gap-4"
        >
          <div>
            <h2 id="board-heading" className="font-serif text-2xl text-ink">
              Times a coordinator has published
            </h2>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
              Each time names the person who approved it. Nothing appears here
              until a coordinator has read the family&apos;s words and published
              the time.
            </p>
          </div>

          <ul
            data-testid="board-list"
            className="flex flex-col gap-4"
            aria-label="Published times"
          >
            {board.slots.map((slot) => {
              const approvalLine = formatApprovalLine({
                approverFirstName: slot.approvedByName,
                approvedAt: slot.approvedAt,
                timeZone: board.timeZone,
              });

              return (
                <li
                  key={slot.id}
                  data-testid="board-slot"
                  data-slot-id={slot.id}
                  data-kind={slot.kind}
                  data-status={slot.status}
                  data-gated={slot.gated ? "true" : "false"}
                  className="rounded-lg border border-line bg-surface p-5"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-serif text-2xl text-ink">
                      {slot.label}
                    </h3>
                    <p className="inline-flex min-h-7 items-center rounded-full border border-line bg-paper px-3 text-base font-semibold text-ink">
                      {STATUS_COPY[slot.status]}
                    </p>
                  </div>

                  <p
                    data-testid="board-window"
                    className="mt-2 max-w-prose text-lg leading-relaxed text-ink"
                  >
                    {formatWindowLabel(
                      slot.windowStart,
                      slot.windowEnd,
                      board.timeZone,
                    )}
                  </p>

                  {slot.gated ? (
                    <p
                      data-testid="board-gated"
                      className="mt-2 max-w-prose text-base leading-relaxed text-ink"
                    >
                      This one needs the in-home checks before a neighbour can
                      say yes. A coordinator will explain what is needed.
                    </p>
                  ) : null}

                  {approvalLine ? (
                    <p
                      data-testid="board-approval-line"
                      className="mt-3 text-base font-semibold text-ink-muted"
                    >
                      {approvalLine}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </RolePage>
  );
}

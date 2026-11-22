import { BoardEmpty } from "@/components/board-empty";
import { BoardSlotCard } from "@/components/board-slot-card";
import { ClaimBanner } from "@/components/claim-banner";
import { RolePage } from "@/components/role-page";
import { BOARD_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { isClaimOutcome, isRuleCode } from "@/server/domain/claim";
import { getBoard } from "@/server/repositories/board";

export const dynamic = "force-dynamic";

/**
 * The congregation board.
 *
 * It shows published times only: the kind of help, the human label, the window,
 * the location, the shape of the place, a gated requirement where one applies,
 * the approval line naming the person and the time, and one claim action for a
 * neighbour who can take it. A claimed time is a calm human state; a covered
 * time is simply covered. A draft cannot reach this page: the repository's
 * status allow-list omits it and requires the approval instant.
 *
 * It never shows the family's name, the person they care for, their words, the
 * orientation note, a claimant's name, or any count. Neighbours see times, never
 * stories. A claim that comes back as a redirect reads one calm sentence here;
 * the closed code is validated, never echoed.
 */
export default async function CirclePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { person, session } = await requirePage(BOARD_ROLES);
  const [params, board] = await Promise.all([
    searchParams,
    getBoard(session),
  ]);

  const claimParam = typeof params.claim === "string" ? params.claim : null;
  const claimCode = isClaimOutcome(claimParam) ? claimParam : null;
  const ruleParam = typeof params.rule === "string" ? params.rule : null;
  const ruleCode = isRuleCode(ruleParam) ? ruleParam : null;

  // `requirePage(BOARD_ROLES)` admits only these three roles.
  const viewerRole: "volunteer" | "coordinator" | "deputy" =
    session.role === "volunteer"
      ? "volunteer"
      : session.role === "deputy"
        ? "deputy"
        : "coordinator";

  const openSlots = board?.slots.filter((slot) => slot.status === "open") ?? [];
  const takenSlots = board?.slots.filter((slot) => slot.status !== "open") ?? [];

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Open times at Respite Morning"
      lead="You see the time and what it needs, never the family's story."
    >
      <section
        data-testid="board-open"
        aria-labelledby="board-open-heading"
        className="flex flex-col gap-4"
      >
        {claimCode ? (
          <ClaimBanner
            code={claimCode}
            ruleCode={ruleCode}
            coordinatorFirstName={board?.coordinatorFirstName ?? null}
          />
        ) : null}
        <div>
          <h2 id="board-open-heading" className="font-serif text-2xl text-ink">
            Times you can take
          </h2>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
            Nothing appears here until a person has read the family&apos;s
            words, with one narrow exception: a signed church policy may publish
            a meal or an errand by itself, and that card says so. Every card
            names who published it.
          </p>
        </div>

        {openSlots.length > 0 ? (
          <ul
            data-testid="board-list"
            aria-label="Open times"
            className="flex flex-col gap-4"
          >
            {openSlots.map((slot) => (
              <BoardSlotCard
                key={slot.id}
                slot={slot}
                timeZone={board?.timeZone ?? "UTC"}
                viewerRole={viewerRole}
                coordinatorFirstName={board?.coordinatorFirstName ?? null}
              />
            ))}
          </ul>
        ) : (
          <BoardEmpty
            role={viewerRole}
            coordinatorFirstName={board?.coordinatorFirstName ?? null}
          />
        )}
      </section>

      {takenSlots.length > 0 ? (
        <section
          data-testid="board-taken"
          aria-labelledby="board-taken-heading"
          className="flex flex-col gap-4"
        >
          <div>
            <h2
              id="board-taken-heading"
              className="font-serif text-2xl text-ink"
            >
              Times that are already spoken for
            </h2>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
              They stay here in plain words, with nothing about the family and
              nothing about who said yes.
            </p>
          </div>
          <ul
            data-testid="board-taken-list"
            aria-label="Times that are already spoken for"
            className="flex flex-col gap-4"
          >
            {takenSlots.map((slot) => (
              <BoardSlotCard
                key={slot.id}
                slot={slot}
                timeZone={board?.timeZone ?? "UTC"}
                viewerRole={viewerRole}
                coordinatorFirstName={board?.coordinatorFirstName ?? null}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </RolePage>
  );
}

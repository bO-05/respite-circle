import { formatApprovalLine } from "@/server/domain/ask-review";
import {
  BOARD_ACTION_LABEL,
  boardClaimHint,
  boardClaimStateCopy,
  boardGatedLine,
  boardKindCopy,
  boardLockCopy,
} from "@/server/domain/board";
import { formatWindowLabel } from "@/server/domain/slots";
import type { BoardSlot } from "@/server/repositories/board";

export type BoardViewerRole = "volunteer" | "coordinator" | "deputy";

/**
 * One published time on the congregation board.
 *
 * The card carries the kind of help, the human label, the window, the location,
 * the shape of the place, a gated requirement if one applies, the approval line,
 * and exactly one primary action for a neighbour who can take it. It never
 * carries the family's name, the person they care for, a diagnosis, their
 * words, the orientation note, a claimant's name, or any count.
 *
 * The claim action is a plain HTML form posting to the claim route. The route
 * re-derives the session and makes the decision; this card is never the
 * enforcement.
 */

function ClaimArea({
  slot,
  viewerRole,
  coordinatorFirstName,
}: {
  slot: BoardSlot;
  viewerRole: BoardViewerRole;
  coordinatorFirstName: string | null;
}) {
  if (viewerRole !== "volunteer") {
    return (
      <p
        data-testid="board-desk-note"
        className="mt-4 max-w-prose text-base leading-relaxed text-ink-muted"
      >
        You are seeing this as the desk team. A neighbour claims the time from
        their own board, and a coordinator confirms it.
      </p>
    );
  }

  if (!slot.claim) return null;

  if (!slot.claim.eligible) {
    const lock = boardLockCopy(slot.claim.ruleCode, coordinatorFirstName);
    return (
      <div
        data-testid="board-lock"
        data-rule-code={slot.claim.ruleCode}
        className="mt-4 max-w-prose rounded-md border border-line bg-paper p-4"
      >
        <h4
          data-testid="board-lock-title"
          className="text-lg font-semibold leading-snug text-ink"
        >
          {lock.title}
        </h4>
        <p
          data-testid="board-lock-unlock"
          className="mt-1 text-base leading-relaxed text-ink"
        >
          {lock.unlock}
        </p>
      </div>
    );
  }

  const hintId = `board-claim-hint-${slot.id}`;

  return (
    <form
      action={`/api/slots/${slot.id}/claim`}
      method="post"
      data-testid="board-claim"
      className="mt-4 flex flex-col gap-2"
    >
      <button
        type="submit"
        aria-describedby={hintId}
        className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground"
      >
        {BOARD_ACTION_LABEL}
      </button>
      <p
        id={hintId}
        data-testid="board-claim-hint"
        className="max-w-prose text-base leading-relaxed text-ink-muted"
      >
        {boardClaimHint(coordinatorFirstName)}
      </p>
    </form>
  );
}

export function BoardSlotCard({
  slot,
  timeZone,
  viewerRole,
  coordinatorFirstName,
}: {
  slot: BoardSlot;
  timeZone: string;
  viewerRole: BoardViewerRole;
  coordinatorFirstName: string | null;
}) {
  const kind = boardKindCopy(slot.kind);
  const gatedLine = boardGatedLine(slot.kind);
  const isOpen = slot.status === "open";
  const approvalLine = formatApprovalLine({
    approverFirstName: slot.approvedByName,
    approvedAt: slot.approvedAt,
    timeZone,
  });
  const statusCopy = boardClaimStateCopy(slot.status, coordinatorFirstName);

  return (
    <li
      data-testid="board-slot"
      data-slot-id={slot.id}
      data-kind={slot.kind}
      data-status={slot.status}
      data-gated={slot.gated ? "true" : "false"}
      data-eligible={slot.claim ? String(slot.claim.eligible) : undefined}
      className="rounded-lg border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p
          data-testid="board-kind"
          className="inline-flex min-h-7 items-center rounded-full border border-line bg-paper px-3 text-base font-semibold text-ink"
        >
          {kind.word}
        </p>
        {statusCopy ? (
          <p
            data-testid="board-status"
            className={`inline-flex min-h-7 items-center rounded-full border px-3 text-base font-semibold text-ink ${
              slot.status === "covered"
                ? "border-green bg-green-soft"
                : "border-amber bg-amber-soft"
            }`}
          >
            {statusCopy}
          </p>
        ) : null}
      </div>

      <h3 className="mt-3 font-serif text-2xl leading-snug text-ink">
        {slot.label}
      </h3>

      <div className="mt-3 flex flex-col gap-1">
        <p
          data-testid="board-window"
          className="max-w-prose text-lg leading-relaxed text-ink"
        >
          {formatWindowLabel(slot.windowStart, slot.windowEnd, timeZone)}
        </p>
        <p
          data-testid="board-location"
          className="max-w-prose text-base leading-relaxed text-ink"
        >
          {kind.location}
        </p>
        <p
          data-testid="board-capacity"
          className="max-w-prose text-base leading-relaxed text-ink-muted"
        >
          {kind.capacity}
        </p>
      </div>

      {gatedLine ? (
        <p
          data-testid="board-gated"
          className="mt-3 max-w-prose text-base leading-relaxed text-ink"
        >
          {gatedLine}
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

      {isOpen ? (
        <ClaimArea
          slot={slot}
          viewerRole={viewerRole}
          coordinatorFirstName={coordinatorFirstName}
        />
      ) : (
        <p className="mt-4 max-w-prose text-base leading-relaxed text-ink-muted">
          {slot.status === "claimed"
            ? "A coordinator confirms every claim before the time is covered."
            : "This time is covered. It stays here in plain words, with nothing about the family."}
        </p>
      )}
    </li>
  );
}

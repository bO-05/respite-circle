import { formatApprovalLine } from "@/server/domain/ask-review";
import { AUTO_PUBLISH_BOARD_LABEL } from "@/server/domain/auto-publish";
import {
  BOARD_ACTION_LABEL,
  boardClaimedHint,
  boardClaimHint,
  boardClaimStateCopy,
  boardGatedLine,
  boardKindCopy,
  boardLockCopy,
  type BoardKind,
} from "@/server/domain/board";
import { STILL_LIFE, type StillLifePhoto } from "@/lib/photos";
import type { BoardSlot } from "@/server/repositories/board";
import { TimeCard } from "./time-card";

export type BoardViewerRole = "volunteer" | "coordinator" | "deputy";

/**
 * One still life per kind of help, and none where the set has no honest
 * match. A ride and an errand keep the kind's written word and its decorative
 * mark; inventing a photograph for them would say more than the app knows.
 * None of these photographs shows a person or a particular family.
 */
const BOARD_STILL_LIFE: Partial<Record<BoardKind, StillLifePhoto>> = {
  companion: STILL_LIFE.tea,
  home: STILL_LIFE.chair,
  meal: STILL_LIFE.soup,
};

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

function ClaimAction({
  slot,
  hintId,
}: {
  slot: BoardSlot;
  hintId: string;
}) {
  return (
    <form
      action={`/api/slots/${slot.id}/claim`}
      method="post"
      data-testid="board-claim"
      className="flex w-full sm:w-fit"
    >
      <button
        type="submit"
        aria-describedby={hintId}
        className="inline-flex min-h-11 min-w-11 w-full touch-manipulation items-center justify-center rounded-md bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground sm:w-auto"
      >
        {BOARD_ACTION_LABEL}
      </button>
    </form>
  );
}

function LockBlock({
  slot,
  coordinatorFirstName,
}: {
  slot: BoardSlot;
  coordinatorFirstName: string | null;
}) {
  if (!slot.claim || slot.claim.eligible) return null;
  const lock = boardLockCopy(slot.claim.ruleCode, coordinatorFirstName);

  return (
    <div
      data-testid="board-lock"
      data-rule-code={slot.claim.ruleCode}
      className="max-w-prose rounded-md border-t border-line bg-paper p-4"
    >
      <p
        data-testid="board-lock-title"
        className="text-lg font-semibold leading-snug text-ink"
      >
        {lock.title}
      </p>
      <p
        data-testid="board-lock-unlock"
        className="mt-1 text-base leading-relaxed text-ink"
      >
        {lock.unlock}
      </p>
    </div>
  );
}

function DeskNote() {
  return (
    <p
      data-testid="board-desk-note"
      className="max-w-prose text-base leading-relaxed text-ink-muted"
    >
      You are seeing this as the desk team. A neighbour takes the time from
      their own board, and a coordinator confirms it.
    </p>
  );
}

export function BoardSlotCard({
  slot,
  timeZone,
  viewerRole,
  coordinatorFirstName,
  headingLevel = 3,
  showDay = false,
}: {
  slot: BoardSlot;
  timeZone: string;
  viewerRole: BoardViewerRole;
  coordinatorFirstName: string | null;
  headingLevel?: 3 | 4;
  showDay?: boolean;
}) {
  const kind = boardKindCopy(slot.kind);
  const gatedLine = boardGatedLine(slot.kind);
  const isOpen = slot.status === "open";
  // An automatically published time carries no approving person, so it must
  // never render "Approved — a person". It names the switch instead.
  const autoPublished = slot.publishedVia === "auto_low_risk";
  const approvalLine = autoPublished
    ? null
    : formatApprovalLine({
        approverFirstName: slot.approvedByName,
        approvedAt: slot.approvedAt,
        timeZone,
      });
  const statusCopy = boardClaimStateCopy(slot.status, coordinatorFirstName);
  const status = statusCopy
    ? {
        label: statusCopy,
        tone: slot.status === "covered" ? ("green" as const) : ("amber" as const),
      }
    : null;

  const isVolunteer = viewerRole === "volunteer";
  const canTake = isOpen && isVolunteer && slot.claim?.eligible === true;
  const isLocked = isOpen && isVolunteer && slot.claim?.eligible === false;
  const hintId = `board-claim-hint-${slot.id}`;

  const hint = canTake
    ? boardClaimHint(coordinatorFirstName)
    : slot.status === "claimed"
      ? boardClaimedHint(coordinatorFirstName)
      : slot.status === "covered"
        ? "This time is covered. It stays here in plain words, with nothing about the family."
        : null;

  const hasDetails = gatedLine !== null || autoPublished || approvalLine;
  const details = hasDetails ? (
    <>
      {gatedLine ? (
        <p
          data-testid="board-gated"
          className="max-w-prose text-base leading-relaxed text-ink"
        >
          {gatedLine}
        </p>
      ) : null}
      {autoPublished ? (
        <p
          data-testid="board-auto-published"
          className="max-w-prose text-base font-semibold text-ink-muted"
        >
          {AUTO_PUBLISH_BOARD_LABEL}
        </p>
      ) : approvalLine ? (
        <p
          data-testid="board-approval-line"
          className="text-base font-semibold text-ink-muted"
        >
          {approvalLine}
        </p>
      ) : null}
    </>
  ) : null;

  return (
    <TimeCard
      testId="board-slot"
      dataAttributes={{
        "data-slot-id": slot.id,
        "data-kind": slot.kind,
        "data-status": slot.status,
        "data-gated": slot.gated ? "true" : "false",
        "data-eligible": slot.claim ? String(slot.claim.eligible) : undefined,
      }}
      kind={slot.kind}
      kindWord={kind.word}
      kindTestId="board-kind"
      photo={BOARD_STILL_LIFE[slot.kind] ?? null}
      photoTestId="board-still-life"
      label={slot.label}
      windowStart={slot.windowStart}
      windowEnd={slot.windowEnd}
      windowTestId="board-window"
      timeZone={timeZone}
      location={kind.location}
      locationTestId="board-location"
      capacity={kind.capacity}
      capacityTestId="board-capacity"
      status={status}
      statusTestId="board-status"
      action={canTake ? <ClaimAction slot={slot} hintId={hintId} /> : null}
      hint={hint}
      hintId={canTake ? hintId : undefined}
      hintTestId={canTake ? "board-claim-hint" : "board-card-hint"}
      details={details}
      extra={
        isLocked ? (
          <LockBlock slot={slot} coordinatorFirstName={coordinatorFirstName} />
        ) : isOpen && !isVolunteer ? (
          <DeskNote />
        ) : null
      }
      headingLevel={headingLevel}
      showDay={showDay}
    />
  );
}

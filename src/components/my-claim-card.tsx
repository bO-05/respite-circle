import Link from "next/link";
import { boardKindCopy } from "@/server/domain/board";
import {
  myClaimCardHint,
  myClaimStatusCopy,
  type MyClaimStatusTone,
} from "@/server/domain/my-claims";
import type { MyClaimSummary } from "@/server/repositories/my-claims";
import { TimeCard } from "./time-card";

/**
 * One of the volunteer's own times in the list.
 *
 * It carries the kind of help, the time block, the place, one calm status, one
 * hint and the way to the time's own page. It never carries the orientation
 * note, the family's name, the caregiver's words, a claimant's identity, or a
 * count. The note lives on the detail page and only after the coordinator has
 * approved the claim.
 */

export const MY_CLAIM_TONE_CLASS: Record<MyClaimStatusTone, string> = {
  amber: "border-amber bg-amber-soft",
  green: "border-green bg-green-soft",
  muted: "border-line bg-muted",
};

export function MyClaimCard({
  claim,
  timeZone,
  coordinatorFirstName,
  headingLevel = 3,
  showDay = false,
}: {
  claim: MyClaimSummary;
  timeZone: string;
  coordinatorFirstName: string | null;
  headingLevel?: 3 | 4;
  showDay?: boolean;
}) {
  const kind = boardKindCopy(claim.kind);
  const status = myClaimStatusCopy(claim.status, coordinatorFirstName);

  return (
    <TimeCard
      testId="my-claim"
      dataAttributes={{
        "data-slot-id": claim.id,
        "data-kind": claim.kind,
        "data-status": claim.status,
      }}
      kind={claim.kind}
      kindWord={kind.word}
      kindTestId="my-claim-kind"
      label={claim.label}
      windowStart={claim.windowStart}
      windowEnd={claim.windowEnd}
      windowTestId="my-claim-window"
      timeZone={timeZone}
      location={kind.location}
      locationTestId="my-claim-location"
      status={{ label: status.label, tone: status.tone }}
      statusTestId="my-claim-status"
      hint={myClaimCardHint(claim.status, coordinatorFirstName)}
      hintTestId="my-claim-hint"
      footer={
        <Link
          href={`/my-claims/${claim.id}`}
          className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-line bg-paper px-5 py-2 text-lg font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          View this time
        </Link>
      }
      headingLevel={headingLevel}
      showDay={showDay}
    />
  );
}

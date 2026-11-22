import Link from "next/link";
import { boardKindCopy } from "@/server/domain/board";
import {
  myClaimStatusCopy,
  type MyClaimStatusTone,
} from "@/server/domain/my-claims";
import { formatWindowLabel } from "@/server/domain/slots";
import type { MyClaimSummary } from "@/server/repositories/my-claims";

/**
 * One of the volunteer's own claims in the list.
 *
 * It carries the kind of help, the window, the place, and one calm status. It
 * never carries the orientation note, the family's name, the caregiver's words,
 * a claimant's identity, or a count. The note lives on the detail page and only
 * after the coordinator has approved the claim.
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
}: {
  claim: MyClaimSummary;
  timeZone: string;
  coordinatorFirstName: string | null;
}) {
  const kind = boardKindCopy(claim.kind);
  const status = myClaimStatusCopy(claim.status, coordinatorFirstName);

  return (
    <li
      data-testid="my-claim"
      data-slot-id={claim.id}
      data-kind={claim.kind}
      data-status={claim.status}
      className="rounded-lg border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p
          data-testid="my-claim-kind"
          className="inline-flex min-h-7 items-center rounded-full border border-line bg-paper px-3 text-base font-semibold text-ink"
        >
          {kind.word}
        </p>
        <p
          data-testid="my-claim-status"
          className={`inline-flex min-h-7 items-center rounded-full border px-3 text-base font-semibold text-ink ${
            MY_CLAIM_TONE_CLASS[status.tone]
          }`}
        >
          {status.label}
        </p>
      </div>

      <h2 className="mt-3 font-serif text-2xl leading-snug text-ink">
        {claim.label}
      </h2>

      <div className="mt-3 flex flex-col gap-1">
        <p
          data-testid="my-claim-window"
          className="max-w-prose text-lg leading-relaxed text-ink"
        >
          {formatWindowLabel(claim.windowStart, claim.windowEnd, timeZone)}
        </p>
        <p
          data-testid="my-claim-location"
          className="max-w-prose text-base leading-relaxed text-ink"
        >
          {kind.location}
        </p>
      </div>

      <Link
        href={`/my-claims/${claim.id}`}
        className="mt-4 inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground"
      >
        View this claim
      </Link>
    </li>
  );
}

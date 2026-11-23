import {
  CoverageCallForm,
  CoverageExpireForm,
  CoverageReofferForm,
} from "@/components/coverage-forms";
import {
  coverageCallLeadLine,
  coverageMessageCountLine,
  coverageOutcomeLabel,
  coverageReofferRefusal,
} from "@/server/domain/coverage";
import { formatWindowLabel } from "@/server/domain/slots";
import type {
  CoverageWatchItem,
  DeskSlotCoverage,
} from "@/server/repositories/coverage";

/**
 * One time in the coverage watch.
 *
 * The count is rendered from the live read, always with the sentence a
 * coordinator can repeat to a judge or a pastor: zero messages went to this
 * family about this time. When the church has sent messages for other times,
 * that total is shown beside it so the zero is visibly a decision rather than
 * a pipeline that cannot send.
 *
 * Every control is a form the server re-authorizes. This component is only
 * rendered for desk roles; no caregiver page imports it.
 */

const KIND_LABEL: Record<string, string> = {
  companion: "Companion place",
  home: "In-home visit",
  drive: "Drive",
  meal: "Meal",
  errand: "Errand",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft — not published",
  open: "Published and not taken yet",
  claimed: "Claimed — waiting for confirmation",
  covered: "Covered with the family",
  done: "Done",
  cancelled: "Cancelled",
  expired_unclaimed: "Closed without a claim",
};

function messageCountNote(count: number, churchCount: number): string {
  if (count !== 0) {
    return "This time has a message on the family's page, so it cannot close as unclaimed.";
  }
  if (churchCount > 0) {
    return `Elsewhere in this church, ${churchCount} ${
      churchCount === 1 ? "message has" : "messages have"
    } reached families, so the pipeline itself works. The silence on this time is deliberate.`;
  }
  return "The count is live from the church's outbox just now.";
}

export function CoverageCard({
  item,
  coordinatorName,
}: {
  item: CoverageWatchItem | DeskSlotCoverage;
  coordinatorName: string;
}) {
  const timeZone = item.timeZone;
  const count = item.caregiverOutboxCount;
  const statusLabel = STATUS_LABEL[item.status] ?? item.status;
  const proof = item.absenceProof;
  const reofferGuard = coverageReofferRefusal({
    status: item.status,
    calls: item.calls.length,
    reoffers: item.reofferCount,
  });

  return (
    <article
      data-testid="coverage-card"
      data-slot-id={item.slotId}
      data-status={item.status}
      data-messages={count}
      data-due={item.isDue ? "true" : "false"}
      data-open-hours={(item.openForMs / 3_600_000).toFixed(2)}
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
    >
      <div>
        {item.status === "open" ? (
          <p
            data-testid="coverage-lead"
            className="text-xl leading-relaxed text-ink"
          >
            {coverageCallLeadLine({
              coordinatorName,
              caregiverFirstName: item.caregiverFirstName,
            })}
          </p>
        ) : null}
        <p
          data-testid="coverage-who"
          className="mt-1 text-lg font-semibold text-ink"
        >
          For {item.caregiverFirstName}, about {item.careRecipientFirstName}
        </p>
        <p className="mt-1 text-base text-ink-muted">
          {KIND_LABEL[item.kind] ?? item.kind} · {item.label}
        </p>
        <p
          data-testid="coverage-window"
          className="mt-2 text-xl leading-relaxed text-ink"
        >
          {formatWindowLabel(item.windowStart, item.windowEnd, timeZone)}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-base text-ink-muted">
          Published{" "}
          <time dateTime={item.openSince.toISOString()}>
            {formatWindowLabel(item.openSince, null, timeZone)}
          </time>
          .
        </p>
        <p
          data-testid="coverage-open-for"
          className="text-base font-semibold text-ink"
        >
          Open for {item.openForLabel}.
        </p>
        <p
          data-testid="coverage-state"
          data-status={item.status}
          className="text-base text-ink-muted"
        >
          {statusLabel}.
        </p>
        {item.status === "open" ? (
          <p
            data-testid="coverage-due"
            data-due={item.isDue ? "true" : "false"}
            data-call-recorded={item.calls.length > 0 ? "true" : "false"}
            className="max-w-prose text-base leading-relaxed text-ink"
          >
            {item.calls.length > 0
              ? "A call is on record — offer this time again or close it."
              : item.isDue
                ? "This time needs a call now."
                : `This time enters the coverage watch on ${formatWindowLabel(
                    item.dueAt,
                    null,
                    timeZone,
                  )}.`}
          </p>
        ) : null}
      </div>

      <div className="rounded-md border border-amber bg-amber-soft px-4 py-3">
        <p
          data-testid="coverage-message-count"
          data-count={count}
          className="text-lg font-semibold leading-relaxed text-ink"
        >
          {coverageMessageCountLine(count)}
        </p>
        <p
          data-testid="coverage-pipeline-evidence"
          className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          {messageCountNote(count, item.churchOutboxCount)}
        </p>
      </div>

      {item.calls.length > 0 ? (
        <section aria-label="Calls recorded about this time">
          <h3 className="text-lg font-semibold text-ink">
            Calls recorded about this time
          </h3>
          <ul
            data-testid="coverage-calls"
            className="mt-2 flex flex-col gap-3"
          >
            {item.calls.map((call) => (
              <li
                key={call.id}
                data-testid="coverage-call"
                data-outcome={call.outcome}
                className="rounded-md border border-line bg-paper p-4"
              >
                <p className="text-base font-semibold text-ink">
                  {coverageOutcomeLabel(call.outcome)}
                  {call.coordinatorFirstName
                    ? ` — ${call.coordinatorFirstName}`
                    : ""}
                </p>
                <p className="mt-1 text-base text-ink-muted">
                  {formatWindowLabel(call.createdAt, null, timeZone)}
                </p>
                {call.note ? (
                  <blockquote className="mt-2 max-w-prose whitespace-pre-wrap break-words border-l-4 border-line px-3 py-1 text-base leading-relaxed text-ink">
                    {call.note}
                  </blockquote>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {item.status === "open" ? (
        <CoverageCallForm slotId={item.slotId} />
      ) : null}

      {item.status === "open" ? (
        <div className="flex flex-col gap-4 border-t border-line pt-4">
          <CoverageReofferForm
            slotId={item.slotId}
            disabledReason={reofferGuard.ok ? null : reofferGuard.message}
          />
          <CoverageExpireForm slotId={item.slotId} />
        </div>
      ) : null}

      {proof ? (
        <section
          data-testid="absence-proof"
          data-count={proof.caregiverOutboxCount}
          aria-labelledby={`absence-proof-heading-${item.slotId}`}
          className="flex flex-col gap-2 rounded-md border border-green bg-green-soft px-4 py-4"
        >
          <h3
            id={`absence-proof-heading-${item.slotId}`}
            className="font-serif text-xl text-ink"
          >
            The proof that nothing was sent
          </h3>
          <p
            data-testid="absence-proof-count"
            className="text-base font-semibold text-ink"
          >
            {coverageMessageCountLine(proof.caregiverOutboxCount)}
          </p>
          <p className="max-w-prose text-base leading-relaxed text-ink">
            This count came from a live query when the time closed. The query
            and its digest are stored with the proof, so anyone can check it.
          </p>
          <pre
            data-testid="absence-proof-query"
            className="overflow-x-auto rounded-md border border-line bg-paper p-3 text-sm leading-relaxed text-ink"
          >
            <code>{proof.queryText}</code>
          </pre>
          <p className="text-base text-ink-muted">
            SHA-256 digest:{" "}
            <code
              data-testid="absence-proof-digest"
              className="break-all text-ink"
            >
              {proof.digest}
            </code>
          </p>
          <p className="text-base text-ink-muted">
            Written{" "}
            <time dateTime={proof.createdAt.toISOString()}>
              {formatWindowLabel(proof.createdAt, null, timeZone)}
            </time>
            .
          </p>
          <p className="max-w-prose text-base leading-relaxed text-ink">
            No email or text message was created for this time, and the
            family&apos;s page shows nothing about it.
          </p>
        </section>
      ) : null}
    </article>
  );
}

/**
 * The slot page's coverage section. The card is the same one the coverage
 * watch shows, so the desk reads identical evidence from either screen.
 */
export function CoverageSection({
  coverage,
  coordinatorName,
}: {
  coverage: DeskSlotCoverage;
  coordinatorName: string;
}) {
  return (
    <section
      data-testid="desk-coverage"
      aria-labelledby="desk-coverage-heading"
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
    >
      <div>
        <h2
          id="desk-coverage-heading"
          className="font-serif text-2xl text-ink"
        >
          The coverage watch
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          If no neighbour takes this time, the family is sent nothing. A person
          calls, records what happened, and the app keeps the proof that no
          message exists.
        </p>
      </div>
      <CoverageCard item={coverage} coordinatorName={coordinatorName} />
    </section>
  );
}

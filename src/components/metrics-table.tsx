import Link from "next/link";
import {
  METRICS_FRAME,
  coordinatorMinutesMethod,
  formatMinutes,
  formatVolunteerHours,
  type MetricsRange,
} from "@/server/domain/metrics";
import type { ChurchMetrics } from "@/server/repositories/metrics";

/**
 * The metrics page's two pieces: the range form and the number list.
 *
 * Every number is a count or a measured duration for the stated range. Each
 * one carries the sentence that defines it, in the same card as the number, so
 * a reader cannot take a figure without its qualification. There is no score,
 * no ranking, no forecast, and no comparison with another church.
 */

export function MetricsRangeForm({ range }: { range: MetricsRange }) {
  return (
    <form
      method="get"
      action="/desk/metrics"
      data-testid="metrics-range-form"
      aria-labelledby="metrics-range-heading"
      className="rounded-lg border border-line bg-surface p-5"
    >
      <h2 id="metrics-range-heading" className="font-serif text-2xl text-ink">
        Choose a range
      </h2>
      <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
        Both dates are in the church&apos;s own time. The range includes the
        last day.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="metrics-from"
            className="text-base font-semibold text-ink"
          >
            First day
          </label>
          <input
            id="metrics-from"
            name="from"
            type="date"
            defaultValue={range.from}
            className="min-h-11 w-full rounded-md border border-line bg-paper px-3 py-2 text-lg text-ink"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="metrics-to"
            className="text-base font-semibold text-ink"
          >
            Last day
          </label>
          <input
            id="metrics-to"
            name="to"
            type="date"
            defaultValue={range.to}
            className="min-h-11 w-full rounded-md border border-line bg-paper px-3 py-2 text-lg text-ink"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-md border border-accent bg-accent px-5 py-2 text-base font-semibold text-paper"
        >
          Show this range
        </button>
        <Link
          href="/desk/metrics"
          className="inline-flex min-h-11 items-center text-base font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          Last 30 days
        </Link>
      </div>
    </form>
  );
}

type MetricCard = {
  testId: string;
  title: string;
  value: string;
  definition: string;
};

function countWord(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function cardsFor(metrics: ChurchMetrics): MetricCard[] {
  const coordinator = metrics.coordinator;

  let coordinatorValue: string;
  let coordinatorDefinition: string;

  if (coordinator.averageMinutes === null) {
    coordinatorValue = "Not measurable yet";
    coordinatorDefinition = `${coordinatorMinutesMethod()} No request in this range had two coordinator actions close enough to measure, so there is no number to show.`;
  } else {
    coordinatorValue = `${formatMinutes(coordinator.averageMinutes)} per request`;
    coordinatorDefinition = `${coordinatorMinutesMethod()} ${
      coordinator.requestsWithIntervals
    } of ${coordinator.requestsMeasured} requests had a second action close enough to measure; ${formatMinutes(
      coordinator.totalMinutes,
    )} measured in total.`;
  }

  return [
    {
      testId: "metric-households",
      title: "Households served",
      value: countWord(metrics.householdsServed, "family", "families"),
      definition:
        "Families with at least one covered or done time whose window falls in this range.",
    },
    {
      testId: "metric-asks",
      title: "Asks received",
      value: countWord(metrics.asks, "ask", "asks"),
      definition:
        "Asks a family sent in this range. A draft was never received, so it is not counted.",
    },
    {
      testId: "metric-published",
      title: "Times published",
      value: countWord(metrics.slotsPublished, "time", "times"),
      definition:
        "Times a coordinator published to the board in this range. Offering a time again after a call counts as another publication.",
    },
    {
      testId: "metric-claims",
      title: "Claims made",
      value: countWord(metrics.claims, "claim", "claims"),
      definition:
        "Times a neighbour said yes in this range, whether or not a coordinator confirmed the claim yet.",
    },
    {
      testId: "metric-covered",
      title: "Times covered",
      value: countWord(metrics.covered, "time", "times"),
      definition:
        "Claims a coordinator confirmed in this range. This is the only state that sends the family a message.",
    },
    {
      testId: "metric-calls",
      title: "Unclaimed → called",
      value: countWord(metrics.unclaimedCalled, "call", "calls"),
      definition:
        "Times a coordinator picked up the phone about an unclaimed time in this range. Every call is logged with its outcome.",
    },
    {
      testId: "metric-volunteer-hours",
      title: "Volunteer hours",
      value: formatVolunteerHours(metrics.volunteerSeconds),
      definition:
        "The length of the windows a neighbour claimed in this range. A claimed window counts before the claim is confirmed.",
    },
    {
      testId: "metric-coordinator-minutes",
      title: "Coordinator minutes per request",
      value: coordinatorValue,
      definition: coordinatorDefinition,
    },
  ];
}

export function MetricsList({ metrics }: { metrics: ChurchMetrics }) {
  const cards = cardsFor(metrics);

  return (
    <dl
      data-testid="metrics-list"
      className="grid gap-4 sm:grid-cols-2"
      aria-label="Church numbers for this range"
    >
      {cards.map((card) => (
        <div
          key={card.testId}
          data-testid={card.testId}
          className="rounded-lg border border-line bg-surface p-5"
        >
          <dt className="font-serif text-xl leading-tight text-ink">
            {card.title}
          </dt>
          <dd
            data-testid={`${card.testId}-value`}
            className="mt-2 text-3xl font-semibold tabular-nums text-ink"
          >
            {card.value}
          </dd>
          <dd className="mt-2 text-base leading-relaxed text-ink-muted">
            {card.definition}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The honest frame, kept next to the list rather than in a tooltip. */
export function MetricsFrameNote() {
  return (
    <p className="max-w-prose text-base leading-relaxed text-ink-muted">
      {METRICS_FRAME}
    </p>
  );
}

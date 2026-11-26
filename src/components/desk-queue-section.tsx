import Link from "next/link";
import {
  QUEUE_CATEGORY_HEADING,
  QUEUE_CATEGORY_NOTE,
  waitingLabel,
  type QueueCategory,
} from "@/server/domain/desk-queue";
import type { DeskQueueItem } from "@/server/repositories/coordinator";

/**
 * One group of the coordinator desk queue.
 *
 * The safety group is the first thing the page renders and the only group
 * drawn as an urgent panel with a larger heading: a safety hold is the first
 * thing a coordinator meets, not a twin of routine coverage. Personal care is
 * the second hold and carries its own tint; the ordinary queue stays plain.
 *
 * Every held card carries a labelled action of its own beside the person's
 * name, so the name link is never the only way into the ask.
 */

const PANEL: Record<QueueCategory, string> = {
  safety: "rounded-xl border-2 border-amber bg-amber-soft p-5 sm:p-6",
  personal_care: "rounded-lg border border-accent bg-accent-soft p-5",
  waiting: "",
};

const HEADING: Record<QueueCategory, string> = {
  safety: "font-serif text-3xl leading-tight text-ink",
  personal_care: "font-serif text-2xl text-ink",
  waiting: "font-serif text-2xl text-ink",
};

function QueueRow({ item, now }: { item: DeskQueueItem; now: Date }) {
  const held = item.category !== "waiting";

  return (
    <li
      data-testid="desk-row"
      data-ask-id={item.id}
      data-status={item.status}
      data-category={item.category}
      data-bilingual={item.bilingualNeeded ? "true" : "false"}
      data-created-at={item.createdAt.toISOString()}
      className="rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <a
          href={`/desk/ask/${item.id}`}
          className="inline-flex min-h-11 items-center text-lg font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          {item.caregiverFirstName}
          <span className="sr-only"> — read this ask</span>
        </a>
        {item.pinLabel ? (
          <span
            data-testid="desk-pin-label"
            className="inline-flex min-h-7 items-center rounded-full border border-accent px-3 text-sm font-semibold text-accent"
          >
            {item.pinLabel}
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-base text-ink-muted">
        For {item.careRecipientFirstName}
      </p>

      <p
        data-testid="desk-reason-summary"
        className="mt-3 text-lg leading-relaxed text-ink"
      >
        {item.reasonSummary}
      </p>

      <p
        data-testid="desk-waiting-time"
        className="mt-2 text-base text-ink-muted"
      >
        <time dateTime={item.createdAt.toISOString()}>
          {waitingLabel(item.createdAt, now)}
        </time>
      </p>

      {item.holdReason ? (
        <p
          data-testid="desk-hold-reason"
          className="mt-3 rounded-md border border-line bg-surface px-4 py-3 text-base leading-relaxed text-ink"
        >
          {item.holdReason}
        </p>
      ) : null}

      {held ? (
        <Link
          href={`/desk/ask/${item.id}`}
          data-testid="desk-hold-open"
          className="mt-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-base font-semibold text-paper"
        >
          Open this ask
          <span className="sr-only"> for {item.caregiverFirstName}</span>
        </Link>
      ) : null}
    </li>
  );
}

export function DeskQueueSection({
  category,
  rows,
  now,
}: {
  category: QueueCategory;
  rows: DeskQueueItem[];
  now: Date;
}) {
  if (rows.length === 0) return null;

  const safety = category === "safety";

  return (
    <section
      data-testid={`desk-category-${category}`}
      data-priority={safety ? "highest" : "routine"}
      aria-labelledby={`desk-heading-${category}`}
      className={`flex flex-col gap-3 ${PANEL[category]}`}
    >
      <div>
        {safety ? (
          <p
            data-testid="desk-safety-first"
            className="text-base font-semibold uppercase tracking-wider text-ink"
          >
            First on this desk
          </p>
        ) : null}
        <h2 id={`desk-heading-${category}`} className={HEADING[category]}>
          {QUEUE_CATEGORY_HEADING[category]}
        </h2>
        <p className="mt-1 max-w-prose text-base leading-relaxed text-ink">
          {QUEUE_CATEGORY_NOTE[category]}
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {rows.map((item) => (
          <QueueRow key={item.id} item={item} now={now} />
        ))}
      </ul>
    </section>
  );
}

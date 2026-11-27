import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ClipboardList, HeartHandshake, Phone } from "lucide-react";
import {
  QUEUE_CATEGORY_HEADING,
  QUEUE_CATEGORY_NOTE,
  safetyRowTitle,
  waitingLabel,
  type QueueCategory,
} from "@/server/domain/desk-queue";
import type { DeskQueueItem } from "@/server/repositories/coordinator";
import { cn } from "@/lib/utils";

/**
 * One group of the coordinator desk queue.
 *
 * The safety group is the first thing the page renders and the only group
 * drawn with the amber tone and a larger heading: a call today is the first
 * thing a coordinator meets, not a twin of routine coverage. Personal care is
 * the second group and carries its own tint; the ordinary queue stays plain.
 *
 * Round 5 draws each row as an action-first notice row. A safety row leads with
 * the call itself — "Call Priya today" — as a brick text link into the ask,
 * because the app never telephones anyone and a call-shaped filled button would
 * imply that it does. A personal-care row keeps its name as the way in, and its
 * own "Open this ask" link is forest rather than brick. Every held row still
 * carries a labelled action of its own beside the name link, so the name link
 * is never the only way into the ask.
 *
 * Each group carries one small decorative mark beside its heading: a phone for
 * the call, joined hands for professional help, a clipboard for the desk's
 * ordinary queue. The mark says nothing the heading does not, so it is
 * `aria-hidden` and never a control, and it is not set in a filled circle.
 */

const PANEL: Record<QueueCategory, string> = {
  safety: "rounded-md border-t-2 border-amber bg-amber-soft p-5 sm:p-6",
  personal_care: "rounded-md border-t-2 border-accent bg-accent-soft p-5",
  waiting: "",
};

const HEADING: Record<QueueCategory, string> = {
  safety: "font-serif text-3xl leading-tight text-ink",
  personal_care: "font-serif text-2xl text-ink",
  waiting: "font-serif text-2xl text-ink",
};

const CATEGORY_ICON: Record<QueueCategory, LucideIcon> = {
  safety: Phone,
  personal_care: HeartHandshake,
  waiting: ClipboardList,
};

function QueueRow({ item, now }: { item: DeskQueueItem; now: Date }) {
  const safety = item.category === "safety";
  // The safety row's first visible line is the action, not the category. The
  // ordinary queue and the personal-care group keep the family's name link.
  const title = safety
    ? safetyRowTitle(item.caregiverFirstName)
    : item.caregiverFirstName;

  return (
    <li
      data-testid="desk-row"
      data-ask-id={item.id}
      data-status={item.status}
      data-category={item.category}
      data-bilingual={item.bilingualNeeded ? "true" : "false"}
      data-created-at={item.createdAt.toISOString()}
      className="border-t border-line bg-surface px-4 py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <a
          href={`/desk/ask/${item.id}`}
          data-testid="desk-row-title"
          className={cn(
            "inline-flex min-h-11 items-center text-lg font-semibold underline decoration-2 underline-offset-4",
            safety ? "text-red decoration-red" : "text-ink decoration-accent",
          )}
        >
          {title}
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
          className="mt-3 rounded-md border-t border-line bg-surface px-4 py-3 text-base leading-relaxed text-ink"
        >
          {item.holdReason}
        </p>
      ) : null}

      {item.category !== "waiting" ? (
        <Link
          href={`/desk/ask/${item.id}`}
          data-testid="desk-hold-open"
          className={cn(
            "mt-2 inline-flex min-h-11 min-w-11 items-center text-base font-semibold underline underline-offset-4",
            safety
              ? "text-red decoration-red"
              : "text-accent decoration-accent",
          )}
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
  const Icon = CATEGORY_ICON[category];

  return (
    <section
      data-testid={`desk-category-${category}`}
      data-priority={safety ? "highest" : "routine"}
      aria-labelledby={`desk-heading-${category}`}
      className={`flex flex-col gap-3 ${PANEL[category]}`}
    >
      <div className="flex items-start gap-3">
        <Icon
          aria-hidden="true"
          className={cn(
            "mt-1 size-6 shrink-0",
            safety ? "text-red" : "text-accent",
          )}
        />
        <div>
          {safety ? (
            <p
              data-testid="desk-safety-first"
              className="font-serif italic font-medium text-[17px] text-accent"
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
      </div>

      <ul className="flex flex-col">
        {rows.map((item) => (
          <QueueRow key={item.id} item={item} now={now} />
        ))}
      </ul>
    </section>
  );
}

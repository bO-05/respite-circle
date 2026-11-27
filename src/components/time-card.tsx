import type { ReactNode } from "react";
import {
  Car,
  House,
  ShoppingBag,
  Users,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { formatSessionClock } from "@/server/domain/session-calendar";
import { churchDayFor } from "@/server/domain/day-groups";
import { formatWindowLabel } from "@/server/domain/slots";
import { partsInZone } from "@/server/domain/time-zone";
import { cn } from "@/lib/utils";

/**
 * One time, on the board and on "Your times".
 *
 * One part, two states: an open time a neighbour can take carries its one
 * primary action and one hint; a taken time carries one status pill instead.
 * The card is never both, so no card offers two answers to the same question.
 *
 * The visible time block is the clock time, and the full civil date stays on
 * the card for a screen reader. When the card is not under a day heading, the
 * day is also written in the time block, so a lone time never loses its date.
 * Nothing here carries the family's name, their words, the orientation note, a
 * claimant's name, or any count.
 */

export type TimeCardKind = "companion" | "home" | "drive" | "meal" | "errand";

const KIND_ICON: Record<TimeCardKind, LucideIcon> = {
  companion: Users,
  home: House,
  drive: Car,
  meal: Utensils,
  errand: ShoppingBag,
};

export type TimeCardTone = "amber" | "green" | "muted";

const TONE_CLASS: Record<TimeCardTone, string> = {
  amber: "border-amber bg-amber-soft",
  green: "border-green bg-green-soft",
  muted: "border-line bg-muted",
};

export type TimeCardStatus = {
  label: string;
  tone: TimeCardTone;
};

export type TimeCardProps = {
  /** `board-slot` or `my-claim`; the card's own hook, never a count. */
  testId: string;
  dataAttributes?: Record<string, string | undefined>;
  kind: string;
  kindWord: string;
  kindTestId: string;
  label: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  windowTestId: string;
  timeZone: string;
  location: string;
  locationTestId: string;
  capacity?: string | null;
  capacityTestId?: string;
  /** The one state of a taken time. Rendered only when there is no action. */
  status?: TimeCardStatus | null;
  statusTestId?: string;
  /** The one primary action of an open time. Never rendered beside a status. */
  action?: ReactNode;
  /** The way to this time's own page. Navigation, not a second answer. */
  footer?: ReactNode;
  hint?: string | null;
  hintId?: string;
  hintTestId?: string;
  /** The requirement line, the approval line, or the policy line. */
  details?: ReactNode;
  /** A lock explanation or the desk-team note, in place of the action. */
  extra?: ReactNode;
  headingLevel?: 3 | 4;
  /**
   * Set when the card is not under a day heading, so the day must travel with
   * it: the board only draws a rail when the section holds more than one day.
   */
  showDay?: boolean;
};

function isSameCivilDay(
  start: Date,
  end: Date,
  timeZone: string,
): boolean {
  const first = partsInZone(start, timeZone);
  const second = partsInZone(end, timeZone);
  return (
    first.year === second.year &&
    first.month === second.month &&
    first.day === second.day
  );
}

export function TimeCard({
  testId,
  dataAttributes,
  kind,
  kindWord,
  kindTestId,
  label,
  windowStart,
  windowEnd,
  windowTestId,
  timeZone,
  location,
  locationTestId,
  capacity,
  capacityTestId,
  status,
  statusTestId,
  action,
  footer,
  hint,
  hintId,
  hintTestId,
  details,
  extra,
  headingLevel = 3,
  showDay = false,
}: TimeCardProps) {
  const Icon = KIND_ICON[kind as TimeCardKind] ?? Users;
  const Heading = headingLevel === 3 ? "h3" : "h4";
  const windowLabel = formatWindowLabel(windowStart, windowEnd, timeZone);
  const startClock = windowStart
    ? formatSessionClock(windowStart, timeZone)
    : null;
  const endClock = windowEnd ? formatSessionClock(windowEnd, timeZone) : null;
  const dayLine =
    showDay && windowStart
      ? (() => {
          const day = churchDayFor(windowStart, timeZone);
          return `${day.weekday} ${day.day} ${day.month}`;
        })()
      : null;
  const clockBlock =
    startClock !== null &&
    (windowEnd === null ||
      (windowStart !== null && isSameCivilDay(windowStart, windowEnd, timeZone)));
  const pill = status && !action ? status : null;

  return (
    <li
      data-testid={testId}
      {...dataAttributes}
      className="rounded-lg border border-line bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
        <div className={cn("shrink-0", dayLine ? "sm:w-24" : "sm:w-20")}>
          {/*
            A time is a number a person has to read and compare across rows,
            so it is set in the sans with tabular figures — never in the serif
            heading face. `tabular-nums` applies to the whole block, so the
            start, the end and a travelling day line all line up.
          */}
          <p data-testid={windowTestId} className="tabular-nums text-ink">
            {clockBlock ? (
              <>
                <span className="sr-only">{windowLabel}</span>
                <span
                  aria-hidden="true"
                  className="flex items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0.5"
                >
                  {dayLine ? (
                    <span className="text-base leading-snug text-ink-muted">
                      {dayLine}
                    </span>
                  ) : null}
                  <span className="text-2xl leading-none">{startClock}</span>
                  {endClock ? (
                    <span className="text-base leading-snug text-ink-muted">
                      to {endClock}
                    </span>
                  ) : null}
                </span>
              </>
            ) : (
              <span className="text-base leading-relaxed">{windowLabel}</span>
            )}
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              data-testid={kindTestId}
              className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-line bg-paper px-3 text-base font-semibold text-ink"
            >
              <Icon aria-hidden="true" className="size-4 text-accent" />
              {kindWord}
            </p>
            {pill ? (
              <p
                data-testid={statusTestId}
                className={cn(
                  "inline-flex min-h-7 items-center rounded-full border px-3 text-base font-semibold text-ink",
                  TONE_CLASS[pill.tone],
                )}
              >
                {pill.label}
              </p>
            ) : null}
          </div>

          <Heading className="mt-3 font-serif text-2xl leading-snug text-ink">
            {label}
          </Heading>

          <div className="mt-3 flex flex-col gap-1">
            <p
              data-testid={locationTestId}
              className="max-w-prose text-base leading-relaxed text-ink"
            >
              {location}
            </p>
            {capacity ? (
              <p
                data-testid={capacityTestId}
                className="max-w-prose text-base leading-relaxed text-ink-muted"
              >
                {capacity}
              </p>
            ) : null}
          </div>

          {details ? <div className="mt-3">{details}</div> : null}
          {extra ? <div className="mt-4">{extra}</div> : null}
          {action ? <div className="mt-4">{action}</div> : null}
          {footer ? <div className="mt-3">{footer}</div> : null}

          {hint ? (
            <p
              id={hintId}
              data-testid={hintTestId}
              className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
            >
              {hint}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The round-4 visual primitives, kept in one place so the board, the demo, the
 * receipt and the home page cannot drift into four different shapes.
 *
 * Every icon in this app is decoration. An `IconWell` is `aria-hidden` in full
 * and always sits beside visible text that says the same thing, so no icon
 * carries meaning alone and no control is icon-only.
 *
 * These are plain function components with no hooks and no state, so they stay
 * usable from server components. `lucide-react` itself ships no `"use client"`.
 */

const WELL_TONE = {
  accent: "bg-accent-soft text-accent",
  amber: "bg-amber-soft text-amber",
  green: "bg-green-soft text-green",
  red: "bg-red-soft text-red",
} as const;

export type WellTone = keyof typeof WELL_TONE;

/**
 * A 24px lucide icon inside a 48px soft well. The well is the decorative unit;
 * the visible title beside it carries the meaning.
 */
export function IconWell({
  icon: Icon,
  tone = "accent",
  className,
}: {
  icon: LucideIcon;
  tone?: WellTone;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-12 shrink-0 items-center justify-center rounded-full",
        WELL_TONE[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-6" />
    </span>
  );
}

/**
 * A person's initials in a soft well, beside their visible full name.
 *
 * The chip is decoration: the name is always written out next to it, so a
 * screen reader would only hear the same person twice if it were announced.
 * It never stands alone as the only label for a card, a link or an action.
 */
export function InitialsChip({
  firstName,
  lastName,
  className,
}: {
  firstName: string;
  lastName: string;
  className?: string;
}) {
  const initials =
    `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`.toUpperCase();

  return (
    <span
      aria-hidden="true"
      data-testid="initials-chip"
      className={cn(
        "inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-base font-semibold tracking-wide text-ink",
        className,
      )}
    >
      {initials}
    </span>
  );
}

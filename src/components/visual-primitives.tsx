import { cn } from "@/lib/utils";

/**
 * The one visual primitive the signed-in surfaces still share.
 *
 * Round 5 removed the round-4 icon well: an icon in a filled circle is the
 * template tell this round deletes, and every surface now draws its own mark
 * as a plain decorative icon beside written words. The initials chip stays,
 * because a person's initials in a soft circle are a name, not an icon.
 */

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

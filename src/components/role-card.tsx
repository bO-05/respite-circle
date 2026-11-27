import type { LucideIcon } from "lucide-react";
import { InitialsChip } from "@/components/visual-primitives";

/**
 * One person on the demo access page.
 *
 * Round 5 makes the doors a typographic list rather than a grid of identical
 * rounded cards: an initials chip beside the person's written name, the role
 * they hold with one small decorative role mark, one sentence about what their
 * side of the demo shows, and one full-width way in. Nothing here counts people
 * or places, and no row is only an icon or only a name.
 *
 * The row is a list item because the demo groups people by role; the list is
 * the page. Its hairline comes from the caller's `divide-y`, so the row itself
 * carries no border and no card surface.
 */
export type RoleCardProps = {
  firstName: string;
  lastName: string;
  /** The person's role, in the app's own words ("Deputy coordinator"). */
  roleLabel: string;
  /** A decorative mark for the role; the written role beside it carries it. */
  icon?: LucideIcon;
  /** One true sentence about what this person's session shows. */
  showLine: string;
  /** `/enter/<token>`; the link is the row's only action. */
  href: string;
  /** `demo-link-<role>`; kept where the access tests already look. */
  testId: string;
};

export function RoleCard({
  firstName,
  lastName,
  roleLabel,
  icon: Icon,
  showLine,
  href,
  testId,
}: RoleCardProps) {
  return (
    <li
      data-testid="role-card"
      className="flex flex-col gap-3 py-5 first:pt-0"
    >
      <div className="flex items-start gap-4">
        <InitialsChip firstName={firstName} lastName={lastName} />
        <div className="min-w-0 flex-1">
          <p
            data-testid="role-card-name"
            className="font-serif text-2xl leading-snug text-ink"
          >
            {firstName} {lastName}
          </p>
          <p
            data-testid="role-card-role"
            className="mt-1 flex items-center gap-1.5 text-base leading-snug text-ink-muted"
          >
            {Icon ? (
              <Icon aria-hidden="true" className="size-4 shrink-0 text-accent" />
            ) : null}
            {roleLabel}
          </p>
          <p
            data-testid="role-card-show-line"
            className="mt-2 text-base leading-relaxed text-ink"
          >
            {showLine}
          </p>
        </div>
      </div>

      <a
        href={href}
        data-testid={testId}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground"
      >
        Enter as {firstName}
      </a>
    </li>
  );
}

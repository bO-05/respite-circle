import { InitialsChip } from "@/components/visual-primitives";

/**
 * One person on the demo access page.
 *
 * The card is the door, so the whole shape is the same for every role: an
 * initials chip beside the person's written name, the role they hold, one
 * sentence about what their side of the demo shows, and one full-width way in.
 * Nothing here counts people or places, and no card is only an icon or only a
 * name.
 *
 * The card is a list item because the demo groups people by role; the grid of
 * cards is the list.
 */
export type RoleCardProps = {
  firstName: string;
  lastName: string;
  /** The person's role, in the app's own words ("Deputy coordinator"). */
  roleLabel: string;
  /** One true sentence about what this person's session shows. */
  showLine: string;
  /** `/enter/<token>`; the link is the card's only action. */
  href: string;
  /** `demo-link-<role>`; kept where the access tests already look. */
  testId: string;
};

export function RoleCard({
  firstName,
  lastName,
  roleLabel,
  showLine,
  href,
  testId,
}: RoleCardProps) {
  return (
    <li
      data-testid="role-card"
      className="flex flex-col rounded-lg border border-line bg-surface p-5"
    >
      <div className="flex items-center gap-3">
        <InitialsChip firstName={firstName} lastName={lastName} />
        <div className="min-w-0">
          <p
            data-testid="role-card-name"
            className="text-xl font-semibold leading-snug text-ink"
          >
            {firstName} {lastName}
          </p>
          <p
            data-testid="role-card-role"
            className="text-base leading-snug text-ink-muted"
          >
            {roleLabel}
          </p>
        </div>
      </div>

      <p
        data-testid="role-card-show-line"
        className="mt-3 flex-1 text-base leading-relaxed text-ink"
      >
        {showLine}
      </p>

      <a
        href={href}
        data-testid={testId}
        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground"
      >
        Enter as {firstName}
      </a>
    </li>
  );
}

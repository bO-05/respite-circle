import { formatWindowLabel } from "@/server/domain/slots";
import type { CaregiverInvite } from "@/server/repositories/invites";

/**
 * The invitation the caregiver received, in the church's own words.
 *
 * The banner is the first thing a family sees on the intake page after an
 * invitation is sent; the list is the kept history on the care page. Both
 * render the stored body unchanged, name the person who wrote it, and say
 * plainly that nothing was emailed or texted.
 */

function sentLine(invite: CaregiverInvite): string {
  return formatWindowLabel(invite.createdAt, null, invite.timeZone);
}

export function CaregiverInviteBanner({
  invite,
}: {
  invite: CaregiverInvite;
}) {
  return (
    <aside
      data-testid="ask-invite"
      data-invite-id={invite.id}
      aria-labelledby="ask-invite-heading"
      className="rounded-md border-t border-accent-soft bg-accent-soft p-5"
    >
      <h2
        id="ask-invite-heading"
        className="font-serif text-2xl leading-snug text-ink"
      >
        An invitation from {invite.authorFirstName}
      </h2>
      <blockquote
        data-testid="ask-invite-body"
        className="mt-3 max-w-prose whitespace-pre-wrap break-words border-l-4 border-accent bg-paper px-4 py-3 text-xl leading-relaxed text-ink"
      >
        {invite.body}
      </blockquote>
      <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
        Written by {invite.authorFirstName} {invite.authorLastName} and sent{" "}
        <time dateTime={invite.createdAt.toISOString()}>
          {sentLine(invite)}
        </time>
        . It is kept in the app; nothing was emailed or texted.
      </p>
    </aside>
  );
}

export function CaregiverInviteList({
  invites,
}: {
  invites: readonly CaregiverInvite[];
}) {
  if (invites.length === 0) return null;

  return (
    <section
      data-testid="care-invites"
      aria-labelledby="care-invites-heading"
      className="flex flex-col gap-4 rounded-md border-t border-line bg-surface p-5"
    >
      <div>
        <h2 id="care-invites-heading" className="font-serif text-2xl text-ink">
          An invitation from your church
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          The words a person wrote to you when you were invited. They are kept
          exactly as they were sent.
        </p>
      </div>

      <ul className="flex flex-col gap-4">
        {invites.map((invite) => (
          <li
            key={invite.id}
            data-testid="care-invite"
            data-invite-id={invite.id}
            className="rounded-md border border-line bg-paper p-4"
          >
            <p className="text-base font-semibold text-ink">
              From {invite.authorFirstName} {invite.authorLastName}
            </p>
            <blockquote
              data-testid="care-invite-body"
              className="mt-2 max-w-prose whitespace-pre-wrap break-words text-lg leading-relaxed text-ink"
            >
              {invite.body}
            </blockquote>
            <p className="mt-3 text-base leading-relaxed text-ink-muted">
              Sent{" "}
              <time dateTime={invite.createdAt.toISOString()}>
                {sentLine(invite)}
              </time>
              .
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

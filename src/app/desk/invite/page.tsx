import Link from "next/link";
import { headers } from "next/headers";
import { AccessLinkList } from "@/components/access-link-list";
import { InviteComposer } from "@/components/invite-composer";
import { RolePage } from "@/components/role-page";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { resolveAccessLinkOrigin } from "@/server/domain/access-links";
import { formatWindowLabel } from "@/server/domain/slots";
import { listChurchAccessLinks } from "@/server/repositories/access-links";
import {
  listInvitableFamilies,
  listRecentInvites,
} from "@/server/repositories/invites";

export const dynamic = "force-dynamic";

/**
 * The invitation composer.
 *
 * A coordinator chooses one family in their own church, edits the church's
 * sentence if they wish, and sends it. The row keeps the body, the author, and
 * the instant it was written. It is in-app only: no email, no SMS, no board
 * post, no broadcast. The family reads it the first time they open their link.
 *
 * The same screen hands over the sign-in link itself. Every family has one
 * already, and the coordinator is the one who passes it on, the way they
 * already reach that person. The list is scoped to the active families of the
 * viewer's own church — never the desk's own link, never a volunteer's — and is
 * read through the same desk role and church scope as the composer, so a
 * caregiver or another church's session never sees a token.
 */
export default async function DeskInvitePage() {
  const { person, session } = await requirePage(DESK_ROLES);

  const [families, recent, links, headerList] = await Promise.all([
    listInvitableFamilies(session),
    listRecentInvites(session),
    listChurchAccessLinks(session),
    headers(),
  ]);

  const origin = resolveAccessLinkOrigin({
    host: headerList.get("host"),
    forwardedHost: headerList.get("x-forwarded-host"),
    forwardedProto: headerList.get("x-forwarded-proto"),
    configuredUrl: process.env.NEXT_PUBLIC_APP_URL,
    httpsOnly: Boolean(process.env.VERCEL),
  });

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Invite a family"
      lead="The first thing a family receives is one person's sentence. Choose the family, change any words you like, and send it."
    >
      {families.length === 0 ? (
        <section
          data-testid="invite-empty"
          aria-labelledby="invite-empty-heading"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2 id="invite-empty-heading" className="font-serif text-2xl text-ink">
            No family is ready to invite yet
          </h2>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
            A caregiver in your church needs a family record before an
            invitation can name someone. A person adds the family first, then
            the words can be written here.
          </p>
          <Link
            href="/desk"
            className="mt-4 inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            Back to the coordinator desk
          </Link>
        </section>
      ) : (
        <InviteComposer
          families={families}
          coordinatorFirstName={person.firstName}
        />
      )}

      <AccessLinkList links={links} origin={origin} />

      <section
        aria-labelledby="invite-recent-heading"
        data-testid="invite-recent"
        className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
      >
        <div>
          <h2
            id="invite-recent-heading"
            className="font-serif text-2xl text-ink"
          >
            Invitations you sent
          </h2>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
            Each one keeps its words, the person who wrote it, and the date.
            Nothing is sent again by the app.
          </p>
        </div>

        {recent.length === 0 ? (
          <p
            data-testid="invite-recent-empty"
            className="max-w-prose text-base leading-relaxed text-ink-muted"
          >
            No invitation has been sent yet. The first one appears here after a
            person writes and sends it.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {recent.map((sent) => (
              <li
                key={sent.id}
                data-testid="invite-sent-row"
                data-invite-id={sent.id}
                data-seen={sent.seenAt ? "true" : "false"}
                className="rounded-md border border-line bg-paper p-4"
              >
                <p className="text-lg font-semibold leading-snug text-ink">
                  {sent.caregiverFirstName} {sent.caregiverLastName}
                  <span className="font-normal text-ink-muted">
                    {" "}
                    — for {sent.careRecipientFirstName}
                  </span>
                </p>
                <blockquote
                  data-testid="invite-sent-body"
                  className="mt-3 max-w-prose whitespace-pre-wrap break-words border-l-4 border-accent bg-surface px-4 py-3 text-lg leading-relaxed text-ink"
                >
                  {sent.body}
                </blockquote>
                <p className="mt-3 text-base leading-relaxed text-ink-muted">
                  Written by {sent.authorFirstName} {sent.authorLastName} and
                  sent{" "}
                  <time dateTime={sent.createdAt.toISOString()}>
                    {formatWindowLabel(sent.createdAt, null, sent.timeZone)}
                  </time>
                  .
                </p>
                <p
                  data-testid="invite-seen-state"
                  className="mt-1 text-base leading-relaxed text-ink-muted"
                >
                  {sent.seenAt ? (
                    <>
                      Opened by the family{" "}
                      <time dateTime={sent.seenAt.toISOString()}>
                        {formatWindowLabel(sent.seenAt, null, sent.timeZone)}
                      </time>
                      .
                    </>
                  ) : (
                    "Not opened yet."
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="invite-delivery-heading"
        data-testid="invite-delivery"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2
          id="invite-delivery-heading"
          className="font-serif text-2xl text-ink"
        >
          How it reaches the family
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          It is kept in this app, addressed to one person. Nothing is emailed,
          texted, posted to the neighbour board, or sent to anyone else. The
          family reads it when they open their own link.
        </p>
      </section>
    </RolePage>
  );
}

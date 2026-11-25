import { ROLE_LABEL } from "@/server/auth/policy";
import {
  ACCESS_LINK_DEMO_WARNING,
  ACCESS_LINK_HOME_LINE,
  ACCESS_LINK_SCOPE_LINE,
  ACCESS_LINK_SEND_LINE,
  accessLinkUrl,
} from "@/server/domain/access-links";
import type { ChurchAccessLink } from "@/server/repositories/access-links";
import { AccessLinkCopy } from "./access-link-copy";

/**
 * The invite screen's list of sign-in links for the families the desk may
 * invite.
 *
 * One row per active family in the coordinator's own church, each with the
 * link that person already holds and a copy control. The list is scoped by the
 * repository: never the desk's own link, never a volunteer's, never another
 * church's. The links are built on the server from the request's own origin, so
 * a copied URL opens the same app the coordinator is reading.
 *
 * The warning says the three things a holder needs to know — these are demo
 * links, the link is personal and keeps working, and a holder is signed in as
 * that person — and the line under the list names the page's scope.
 */
export function AccessLinkList({
  links,
  origin,
}: {
  links: readonly ChurchAccessLink[];
  origin: string;
}) {
  return (
    <section
      aria-labelledby="access-links-heading"
      data-testid="access-links"
      className="rounded-lg border border-line bg-surface p-5"
    >
      <h2 id="access-links-heading" className="font-serif text-2xl text-ink">
        Sign-in links for the families you invite
      </h2>
      <p
        data-testid="access-links-warning"
        className="mt-3 max-w-prose rounded-md border border-amber bg-amber-soft px-4 py-3 text-base leading-relaxed text-ink"
      >
        {ACCESS_LINK_DEMO_WARNING}
      </p>
      <p
        data-testid="access-links-send-line"
        className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted"
      >
        {ACCESS_LINK_SEND_LINE}
      </p>

      {links.length === 0 ? (
        <p
          data-testid="access-links-empty"
          className="mt-4 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          No family in your church has a link yet. A person adds the first
          family record, and the link appears here.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {links.map((link) => {
            const url = accessLinkUrl(origin, link.accessToken);
            if (!url) return null;

            const name = `${link.firstName} ${link.lastName}`;

            return (
              <li
                key={link.personId}
                data-testid="access-link-row"
                data-person-id={link.personId}
                data-role={link.role}
                className="rounded-md border border-line bg-paper p-4"
              >
                <p className="text-lg font-semibold leading-snug text-ink">
                  {name}
                  <span className="font-normal text-ink-muted">
                    {" "}
                    · {ROLE_LABEL[link.role]}
                  </span>
                </p>
                <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
                  {ACCESS_LINK_HOME_LINE[link.role]}
                </p>
                <AccessLinkCopy
                  url={url}
                  firstName={link.firstName}
                  personName={name}
                />
              </li>
            );
          })}
        </ul>
      )}

      <p
        data-testid="access-links-scope-line"
        className="mt-4 max-w-prose text-base leading-relaxed text-ink-muted"
      >
        {ACCESS_LINK_SCOPE_LINE}
      </p>
    </section>
  );
}

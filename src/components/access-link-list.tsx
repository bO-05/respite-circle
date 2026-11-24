import { ROLE_LABEL } from "@/server/auth/policy";
import {
  ACCESS_LINK_HOME_LINE,
  ACCESS_LINK_SEND_LINE,
  accessLinkUrl,
} from "@/server/domain/access-links";
import type { ChurchAccessLink } from "@/server/repositories/access-links";
import { AccessLinkCopy } from "./access-link-copy";

/**
 * The invite screen's list of sign-in links.
 *
 * One row per active person in the coordinator's own church, each with the
 * link that person already holds and a copy control. The links are built on the
 * server from the request's own origin, so a copied URL opens the same app the
 * coordinator is reading, and the page carries one plain sentence about who
 * sends the link and how.
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
        Sign-in links for your church
      </h2>
      <p
        data-testid="access-links-send-line"
        className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
      >
        {ACCESS_LINK_SEND_LINE}
      </p>

      {links.length === 0 ? (
        <p
          data-testid="access-links-empty"
          className="mt-4 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          No one in your church has a link yet. A person adds the first record,
          and the link appears here.
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

      <p className="mt-4 max-w-prose text-base leading-relaxed text-ink-muted">
        Every person in your church has one link of their own. It is the only
        thing that signs them in, so give it to that person and no one else.
      </p>
    </section>
  );
}

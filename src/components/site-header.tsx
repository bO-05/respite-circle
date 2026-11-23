import Link from "next/link";
import { ROLE_LABEL, roleHome } from "@/server/auth/policy";
import { readSession } from "@/server/auth/read-session";
import { SITE_NAME } from "@/lib/site-navigation";
import { RoleNav } from "./role-nav";

/**
 * The shape of the room: brand, role navigation, and who is signed in.
 *
 * Only the signed cookie picks the navigation. A caregiver never receives the
 * desk links in their HTML, so hiding a control is not the only thing standing
 * between roles. The header reads no private data and does not query a name;
 * the page's own guard loads that.
 */
export async function SiteHeader() {
  const session = await readSession();
  const home = session ? roleHome(session.role) : "/";

  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <Link
            href={home}
            className="inline-flex min-h-11 items-center font-serif text-2xl font-semibold text-ink"
          >
            {SITE_NAME}
          </Link>
          {session ? (
            <p className="text-base text-ink-muted">
              Signed in as {ROLE_LABEL[session.role]}
            </p>
          ) : (
            <p className="text-base text-ink-muted">
              A church-run break for a family that cares for someone
            </p>
          )}
        </div>

        {session ? (
          <RoleNav role={session.role} />
        ) : (
          <nav aria-label="Main">
            <ul className="flex flex-wrap items-center gap-x-2">
              <li>
                <Link
                  href="/enter"
                  className="inline-flex min-h-11 items-center rounded-md px-3 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
                >
                  Enter with your link
                </Link>
              </li>
            </ul>
          </nav>
        )}
      </div>
    </header>
  );
}

import Link from "next/link";
import { ROLE_LABEL, roleHome } from "@/server/auth/policy";
import { readSession } from "@/server/auth/read-session";
import { BrandMark } from "./brand-mark";
import { RoleNav } from "./role-nav";

/**
 * The shape of the room: brand, role navigation, and who is signed in.
 *
 * Only the signed cookie picks the navigation. A caregiver never receives the
 * desk links in their HTML, so hiding a control is not the only thing standing
 * between roles. The header reads no private data and does not query a name;
 * the page's own guard loads that.
 *
 * The mark is decorative (`aria-hidden`, no role, no title), so the home
 * link's accessible name stays exactly "Respite Circle". It sits outside
 * `main`, where every icon is a lucide import.
 */
export async function SiteHeader() {
  const session = await readSession();
  const home = session ? roleHome(session.role) : "/";

  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <Link
            href={home}
            className="inline-flex min-h-11 items-center gap-2.5 font-serif text-2xl font-semibold text-ink"
          >
            <BrandMark className="h-7 w-7 shrink-0 text-accent" />
            <span>
              Respite{" "}
              <em className="font-medium italic text-accent">Circle</em>
            </span>
          </Link>
          {session ? (
            <p className="text-base text-ink-muted">
              Signed in as {ROLE_LABEL[session.role]}
            </p>
          ) : (
            // At 360 a second header line costs the first screen ~26px, and the
            // hero directly below already says what this product is. The
            // tagline stays where there is room for it.
            <p className="hidden text-base text-ink-muted sm:block">
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

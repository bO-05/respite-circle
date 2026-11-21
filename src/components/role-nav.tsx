"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeNavHref, navForRole } from "@/lib/site-navigation";
import { cn } from "@/lib/utils";
import type { Role } from "@/server/auth/policy";

/**
 * The role's own navigation and nothing else. The active page is marked with
 * `aria-current="page"` plus an underline, never colour alone. Each link is a
 * 44px target and the list wraps instead of scrolling at 360px.
 */
export function RoleNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const current = activeNavHref(role, pathname);

  return (
    <nav aria-label="Your pages">
      <ul className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {navForRole(role).map((item) => {
          const active = item.href === current;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-md px-3 text-base font-semibold text-ink",
                  "underline decoration-transparent underline-offset-4 hover:decoration-accent",
                  active && "text-accent decoration-accent",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

import type { Role } from "@/server/auth/policy";

/**
 * The one place a route gets its human name. Titles belong to the app shell,
 * never to a guarded page: Next resolves a page's `metadata` export before the
 * page guard runs, so a refused caregiver would still read the hidden route's
 * name in the tab title. The shell calls `titleForPath` with the role it has
 * already authorized, and a route the role cannot open falls back to the bare
 * site name instead of the hidden label.
 *
 * This module is pure and client-safe so the nav and the document title can be
 * unit-tested without a browser, a database, or the Next runtime.
 */

export const SITE_NAME = "Respite Circle";

export const SAMPLE_DATA_STAMP =
  "Fictional church, fictional families. Sample data.";

export const AI_CHIP_LABEL = "AI: sees fields, writes nothing";

export type NavItem = {
  readonly href: string;
  readonly label: string;
};

/**
 * Role-scoped navigation. A signed-in person sees this list and nothing else.
 * Every href here is a page whose own guard accepts the roles that see it,
 * which `tests/unit/site-navigation.test.ts` enforces.
 */
export const ROLE_NAV: Record<Role, readonly NavItem[]> = {
  caregiver: [
    { href: "/ask", label: "Ask" },
    { href: "/care", label: "Care" },
    { href: "/promises", label: "Promises" },
  ],
  coordinator: [
    { href: "/desk", label: "Desk" },
    { href: "/desk/sessions", label: "Sessions" },
    { href: "/circle", label: "Board" },
    { href: "/promises", label: "Promises" },
    { href: "/desk/metrics", label: "Metrics" },
  ],
  deputy: [
    { href: "/desk", label: "Desk" },
    { href: "/desk/sessions", label: "Sessions" },
    { href: "/circle", label: "Board" },
    { href: "/promises", label: "Promises" },
    { href: "/desk/metrics", label: "Metrics" },
  ],
  volunteer: [
    { href: "/circle", label: "Board" },
    { href: "/my-claims", label: "My claims" },
  ],
  pastor: [{ href: "/desk/metrics", label: "Metrics" }],
};

export function navForRole(role: Role): readonly NavItem[] {
  return ROLE_NAV[role];
}

type TitleRule = {
  readonly match: RegExp;
  readonly label: string;
};

const CAREGIVER_TITLES: readonly TitleRule[] = [
  { match: /^\/ask\/[^/]+$/, label: "Your ask" },
  { match: /^\/ask$/, label: "Tell us about your week" },
  { match: /^\/care$/, label: "What's covered for your family" },
  { match: /^\/promises$/, label: "Our promises" },
];

const VOLUNTEER_TITLES: readonly TitleRule[] = [
  { match: /^\/my-claims\/[^/]+$/, label: "Your claim" },
  { match: /^\/my-claims$/, label: "Your claims" },
  { match: /^\/circle$/, label: "Respite Morning board" },
];

const DESK_TITLES: readonly TitleRule[] = [
  { match: /^\/desk\/ask\/[^/]+$/, label: "Ask review" },
  { match: /^\/desk\/slot\/[^/]+$/, label: "Slot review" },
  { match: /^\/desk\/failures$/, label: "Coverage watch" },
  { match: /^\/desk\/sessions$/, label: "Respite Morning sessions" },
  { match: /^\/desk\/audit$/, label: "Decision log" },
  { match: /^\/desk\/policy$/, label: "Church policy" },
  { match: /^\/desk\/metrics$/, label: "Church numbers" },
  { match: /^\/desk$/, label: "Coordinator desk" },
  { match: /^\/circle$/, label: "Respite Morning board" },
  { match: /^\/promises$/, label: "Our promises" },
];

const PASTOR_TITLES: readonly TitleRule[] = [
  { match: /^\/desk\/metrics$/, label: "Church numbers" },
];

const TITLE_RULES: Record<Role, readonly TitleRule[]> = {
  caregiver: CAREGIVER_TITLES,
  volunteer: VOLUNTEER_TITLES,
  coordinator: DESK_TITLES,
  deputy: DESK_TITLES,
  pastor: PASTOR_TITLES,
};

function normalizePath(pathname: string): string {
  const withoutQuery = pathname.split("?")[0]?.split("#")[0] ?? "";
  if (withoutQuery.length <= 1) return withoutQuery || "/";
  return withoutQuery.replace(/\/+$/, "");
}

/** A stable title for the current route, or the bare site name when the role
 * may not open it. Never returns a label from another role's area. */
export function titleForPath(pathname: string, role: Role): string {
  const normalized = normalizePath(pathname);
  for (const rule of TITLE_RULES[role]) {
    if (rule.match.test(normalized)) {
      return `${rule.label} — ${SITE_NAME}`;
    }
  }
  return SITE_NAME;
}

export function isNavItemActive(href: string, pathname: string): boolean {
  const normalized = normalizePath(pathname);
  return normalized === href || normalized.startsWith(`${href}/`);
}

/** The most specific matching nav item, so /desk/metrics highlights Metrics
 * rather than Desk. */
export function activeNavHref(role: Role, pathname: string): string | null {
  const matches = navForRole(role)
    .filter((item) => isNavItemActive(item.href, pathname))
    .map((item) => item.href)
    .sort((a, b) => b.length - a.length);

  return matches[0] ?? null;
}

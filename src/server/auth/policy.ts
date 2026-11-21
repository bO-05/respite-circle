/**
 * Pure authentication policy: the closed role set, role homes, and the
 * authorization predicates every private page, action, and query uses.
 *
 * This module imports nothing. It is safe to unit-test without a database,
 * cookies, or the Next runtime.
 */

export const ROLES = [
  "caregiver",
  "coordinator",
  "deputy",
  "volunteer",
  "pastor",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * One signed-in person gets exactly one role. When a person carries more than
 * one role, the desk roles win, then caregiving, then volunteering. The seed
 * gives every person a single role; this order only makes the choice
 * deterministic if that changes.
 */
export const ROLE_PRECEDENCE = [
  "coordinator",
  "deputy",
  "caregiver",
  "volunteer",
  "pastor",
] as const satisfies readonly Role[];

export const ROLE_HOME: Record<Role, string> = {
  caregiver: "/ask",
  coordinator: "/desk",
  deputy: "/desk",
  volunteer: "/circle",
  pastor: "/desk/metrics",
};

export const ROLE_LABEL: Record<Role, string> = {
  caregiver: "Caregiver",
  coordinator: "Coordinator",
  deputy: "Deputy coordinator",
  volunteer: "Volunteer",
  pastor: "Pastor (read-only)",
};

/** The desk belongs to the coordinator and the deputy only. */
export const DESK_ROLES = ["coordinator", "deputy"] as const satisfies readonly Role[];

/**
 * The desk area's outer shell. The read-only pastor's one page
 * (`/desk/metrics`) sits under it, so the shell must let them in; every desk
 * page still names the narrower roles it serves.
 */
export const DESK_AREA_ROLES = [
  "coordinator",
  "deputy",
  "pastor",
] as const satisfies readonly Role[];

/** The congregation board is for volunteers and the desk team. */
export const BOARD_ROLES = [
  "volunteer",
  "coordinator",
  "deputy",
] as const satisfies readonly Role[];

/** Caregiver screens are for the caregiver whose session it is. */
export const CAREGIVER_ROLES = ["caregiver"] as const satisfies readonly Role[];

/** `/my-claims` is a volunteer's own list, never a directory of volunteers. */
export const CLAIMS_ROLES = ["volunteer"] as const satisfies readonly Role[];

/** The identity fields every guard needs; the cookie adds issued/expiry times. */
export type Actor = {
  personId: string;
  role: Role;
  churchId: string;
};

export type AuthFailure = "unauthenticated" | "forbidden";

/**
 * A refused request. `status` is what a route handler returns; a page redirects
 * to `/enter` or `/unauthorized` instead. Never include private data in a
 * message that reaches the client.
 */
export class AuthError extends Error {
  readonly failure: AuthFailure;

  constructor(failure: AuthFailure, message?: string) {
    super(
      message ??
        (failure === "unauthenticated"
          ? "Open your access link to sign in."
          : "This area isn't part of your role."),
    );
    this.name = "AuthError";
    this.failure = failure;
  }

  get status(): 401 | 403 {
    return this.failure === "unauthenticated" ? 401 : 403;
  }
}

/**
 * A record exists but belongs to another church. Callers turn this into a 404
 * for reads and a refusal for writes, so the response never confirms that the
 * other church's record exists.
 */
export class ChurchScopeError extends Error {
  constructor() {
    super("That record belongs to another church.");
    this.name = "ChurchScopeError";
  }
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function roleHome(role: Role): string {
  return ROLE_HOME[role];
}

/** Resolve one of a person's stored roles to the single role used in a session. */
export function resolvePrimaryRole(roles: readonly string[]): Role | null {
  const held = new Set(roles.filter(isRole));
  for (const role of ROLE_PRECEDENCE) {
    if (held.has(role)) return role;
  }
  return null;
}

export function canAccessRoles(
  role: Role,
  allowed: readonly Role[],
): boolean {
  return allowed.includes(role);
}

/** Throw a 403 unless the actor holds one of the allowed roles. */
export function requireRoleSession(
  actor: Pick<Actor, "role">,
  allowed: readonly Role[],
): void {
  if (!canAccessRoles(actor.role, allowed)) {
    throw new AuthError("forbidden");
  }
}

export function isSameChurch(
  actor: Pick<Actor, "churchId">,
  churchId: string,
): boolean {
  return actor.churchId === churchId;
}

/**
 * Every coordinator read and write passes through this before touching an
 * id-addressed record. A mismatch is a scope failure, not a 404 in itself;
 * repositories return null so the route can call `notFound()`.
 */
export function assertSameChurch(
  actor: Pick<Actor, "churchId">,
  churchId: string,
): void {
  if (!isSameChurch(actor, churchId)) {
    throw new ChurchScopeError();
  }
}

export function isOwnPerson(
  actor: Pick<Actor, "personId">,
  personId: string,
): boolean {
  return actor.personId === personId;
}

/** A volunteer's claim, note, or profile is readable only by that volunteer. */
export function assertOwnPerson(
  actor: Pick<Actor, "personId">,
  personId: string,
): void {
  if (!isOwnPerson(actor, personId)) {
    throw new AuthError("forbidden", "That record belongs to someone else.");
  }
}

/**
 * `/demo` exists only when the operator explicitly turns demo mode on.
 * Accepted true values: `true` and `1`, case-insensitive.
 */
export function isDemoModeEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const value = env.RC_DEMO_MODE?.trim().toLowerCase();
  return value === "true" || value === "1";
}

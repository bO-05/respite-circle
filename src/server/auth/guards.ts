import { and, eq } from "drizzle-orm";
import { forbidden, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { cache } from "react";
import { db } from "@/db/client";
import { person } from "@/db/schema";
import {
  AuthError,
  canAccessRoles,
  ChurchScopeError,
  isRole,
  type Role,
} from "./policy";
import { readSession } from "./read-session";
import type { Session } from "./session";

/**
 * Server-side guards. Every private page, server action, and route handler
 * resolves the session here — hiding a link in the UI is never enforcement.
 *
 * Pages redirect to `/enter` when no session exists and render the real 403
 * forbidden page when a signed-in person asks for another role's area. Route
 * handlers and actions get a JSON response or an AuthError, never a redirect
 * that a fetch caller would silently follow.
 */

export { readSession };

export type SessionPerson = {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
  churchId: string;
};

export type Authorized = {
  session: Session;
  person: SessionPerson;
};

/**
 * Confirm the signed identity still describes an active person in the same
 * church, and that the session's role is still one the person holds.
 *
 * Wrapped in React `cache()` and keyed on primitives so an area layout and its
 * page share one query per request instead of paying two Neon round trips.
 */
const loadSessionPersonCached = cache(
  async (
    personId: string,
    churchId: string,
    role: Role,
  ): Promise<SessionPerson | null> => {
    const rows = await db
      .select({
        id: person.id,
        firstName: person.firstName,
        lastName: person.lastName,
        roles: person.roles,
        churchId: person.churchId,
      })
      .from(person)
      .where(
        and(
          eq(person.id, personId),
          eq(person.churchId, churchId),
          eq(person.active, true),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const roles = row.roles.filter(isRole);
    if (!roles.includes(role)) return null;

    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      role,
      churchId: row.churchId,
    };
  },
);

export async function loadSessionPerson(
  session: Session,
): Promise<SessionPerson | null> {
  return loadSessionPersonCached(
    session.personId,
    session.churchId,
    session.role,
  );
}

/**
 * Page guard. Redirects to the entry page when there is no session, and
 * renders the real 403 page (`app/forbidden.tsx`) when a signed-in person asks
 * for an area their role does not hold. Calling `forbidden()` before any JSX
 * is returned keeps the response a true 403 instead of a streamed 200.
 *
 * `allowed` omitted means "any signed-in person".
 */
export async function requirePage(
  allowed?: readonly Role[],
): Promise<Authorized> {
  const session = await readSession();

  if (!session) {
    redirect("/enter");
  }

  if (allowed && !canAccessRoles(session.role, allowed)) {
    forbidden();
  }

  const personRow = await loadSessionPerson(session);
  if (!personRow) {
    redirect("/enter?error=expired");
  }

  return { session, person: personRow };
}

/**
 * Server action guard. Throws AuthError instead of redirecting so the action
 * can return a calm message to its own form.
 */
export async function requireAction(
  allowed?: readonly Role[],
): Promise<Authorized> {
  const session = await readSession();

  if (!session) {
    throw new AuthError("unauthenticated");
  }

  if (allowed && !canAccessRoles(session.role, allowed)) {
    throw new AuthError("forbidden");
  }

  const personRow = await loadSessionPerson(session);
  if (!personRow) {
    throw new AuthError("unauthenticated");
  }

  return { session, person: personRow };
}

export type ApiAuthorized =
  | { ok: true; session: Session; person: SessionPerson }
  | { ok: false; response: NextResponse };

/**
 * Route handler guard. Returns 401 for no/expired session, 403 for a role
 * outside the allowed set, and 503 if the sign-in record cannot be checked.
 */
export async function requireApi(
  allowed?: readonly Role[],
): Promise<ApiAuthorized> {
  const session = await readSession();

  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Open your access link to sign in." },
        { status: 401 },
      ),
    };
  }

  if (allowed && !canAccessRoles(session.role, allowed)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This area isn't part of your role." },
        { status: 403 },
      ),
    };
  }

  let personRow: SessionPerson | null;
  try {
    personRow = await loadSessionPerson(session);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sign-in could not be checked. Try again." },
        { status: 503 },
      ),
    };
  }

  if (!personRow) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Your access link has expired. Open it again." },
        { status: 401 },
      ),
    };
  }

  return { ok: true, session, person: personRow };
}

/** Map an AuthError or cross-church refusal to a safe JSON response. */
export function authErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof ChurchScopeError) {
    return NextResponse.json(
      { error: "That record is not available." },
      { status: 404 },
    );
  }

  return null;
}

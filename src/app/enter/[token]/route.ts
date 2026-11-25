import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { person } from "@/db/schema";
import { resolvePrimaryRole, roleHome } from "@/server/auth/policy";
import {
  issueSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/server/auth/session";

/**
 * Personal access link. The token is a bearer credential stored on the person
 * row, and it is reusable: opening the link signs exactly that person in and
 * lands on the home for their single session role, and the same link signs
 * them in again in another browser or another week. Nothing is consumed,
 * rotated, or expired here. No password, no email, no third-party auth.
 */

export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

/**
 * Redirect with a relative Location. Building an absolute URL from
 * `request.url` can switch hosts (for example 127.0.0.1 to localhost), which
 * would leave the session cookie on a different host than the role home.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { ...NO_CACHE_HEADERS, Location: path },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const invalid = redirectTo("/enter?error=invalid");

  if (!token || token.length > 200) return invalid;

  let rows: {
    id: string;
    roles: string[];
    churchId: string;
  }[];

  try {
    rows = await db
      .select({
        id: person.id,
        roles: person.roles,
        churchId: person.churchId,
      })
      .from(person)
      .where(and(eq(person.accessToken, token), eq(person.active, true)))
      .limit(1);
  } catch {
    return NextResponse.json(
      { error: "Sign-in is unavailable right now. Try again in a moment." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const row = rows[0];
  if (!row) return invalid;

  const role = resolvePrimaryRole(row.roles);
  if (!role) return invalid;

  let issued: ReturnType<typeof issueSession>;
  try {
    issued = issueSession({
      personId: row.id,
      role,
      churchId: row.churchId,
    });
  } catch {
    return NextResponse.json(
      { error: "Sign-in is unavailable right now. Try again in a moment." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const response = redirectTo(roleHome(role));

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: issued.token,
    ...sessionCookieOptions(
      issued.session.expiresAt,
      request.nextUrl.protocol === "https:" || Boolean(process.env.VERCEL),
    ),
  });

  return response;
}

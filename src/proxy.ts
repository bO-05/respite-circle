import { NextResponse, type NextRequest } from "next/server";

/**
 * The coordinator's read of a family's words is a GET.
 *
 * Next renders a page route for a plain POST, which would let a form post look
 * like a successful "edit" even though nothing is stored. This Proxy answers
 * every non-read method on the ask review page with 405 before rendering, so a
 * coordinator (or a test) sees an explicit refusal.
 *
 * A Server Action carries a `Next-Action` header and passes through: the draft
 * slot editor and the approval controls will legitimately POST to this page.
 * None of those future actions may write `ask.verbatim_text`; the column-scoped
 * `ask_verbatim_immutable` trigger remains the enforcement, and no repository
 * exposes a verbatim write.
 */
export function proxy(request: NextRequest) {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return NextResponse.next();
  }

  if (request.headers.has("next-action")) {
    return NextResponse.next();
  }

  return new NextResponse(
    "This page is read-only. The family's words cannot be edited here.",
    {
      status: 405,
      headers: {
        Allow: "GET, HEAD, OPTIONS",
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}

export const config = {
  matcher: "/desk/ask/:path*",
};

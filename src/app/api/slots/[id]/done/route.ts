import { NextResponse } from "next/server";
import { authErrorResponse, requireApi } from "@/server/auth/guards";
import type { DoneRefusalCode } from "@/server/domain/my-claims";
import { markClaimDone } from "@/server/repositories/my-claims";

/**
 * Mark a confirmed claim done.
 *
 * The repository holds the row, re-applies the pure done predicate (confirmed,
 * after the window, not already done), and writes the audit row in the same
 * transaction. The route only translates the closed outcome into a redirect or
 * JSON; it never decides eligibility from the request.
 */

export const dynamic = "force-dynamic";

export const DONE_HTTP_STATUS: Record<DoneRefusalCode, 404 | 409> = {
  not_found: 404,
  not_covered: 409,
  too_early: 409,
  already_done: 409,
};

const UNAVAILABLE_SENTENCE =
  "We couldn't close that just now. Please try again, or speak to your coordinator after a Sunday service.";

function wantsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function redirectToClaim(slotId: string, code: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: `/my-claims/${encodeURIComponent(slotId)}?done=${code}`,
    },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  try {
    const result = await markClaimDone(auth.session, id);

    if (wantsHtml(request)) {
      return redirectToClaim(id, result.code);
    }

    if (result.ok) {
      return NextResponse.json(
        { ok: true, code: result.code, message: result.message },
        { status: 200 },
      );
    }

    return NextResponse.json(
      { ok: false, code: result.code, message: result.message },
      { status: DONE_HTTP_STATUS[result.code] },
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("claim done failed");
    return NextResponse.json(
      { ok: false, code: "unavailable", message: UNAVAILABLE_SENTENCE },
      { status: 503 },
    );
  }
}

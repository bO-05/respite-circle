import { NextResponse } from "next/server";
import { authErrorResponse, requireApi } from "@/server/auth/guards";
import { claimHttpStatus } from "@/server/domain/claim";
import { claimSlot } from "@/server/repositories/claims";

/**
 * The atomic claim. A route handler, never a server action: the board posts a
 * plain HTML form here, and two parallel plain HTTP posts must be testable.
 *
 * The signed session is the identity, so the id in the URL is the only thing a
 * request can choose. Every refusal is a closed code with one human sentence;
 * SQL text, stack traces, and every id but the slot never reach the response.
 *
 * A browser form post is answered with a relative 303 back to `/circle`, where
 * the board renders the calm banner and re-reads the slot from the database. An
 * API client (the parallel-claim proof) gets JSON with the real status:
 * 200 claimed, 409 taken, 403 locked, 404 missing.
 */

export const dynamic = "force-dynamic";

const UNAVAILABLE_SENTENCE =
  "We couldn't take that just now. Please try again, or speak to your coordinator after a Sunday service.";

function wantsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function redirectToBoard(code: string, ruleCode: string | null): Response {
  const params = new URLSearchParams({ claim: code });
  if (ruleCode) params.set("rule", ruleCode);
  // A relative Location: Next normalises the request host, and an absolute
  // redirect can land on a host that does not own the session cookie.
  return new Response(null, {
    status: 303,
    headers: { location: `/circle?${params.toString()}` },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  // Any signed-in person reaches `claimSlot` so a wrong-role attempt is audited;
  // the repository refuses and records it. No session is a 401 with no actor to
  // attribute an audit row to.
  const auth = await requireApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  try {
    const result = await claimSlot(auth.session, id);

    if (wantsHtml(request)) {
      return redirectToBoard(result.code, result.ok ? null : result.ruleCode);
    }

    if (result.ok) {
      return NextResponse.json(
        {
          ok: true,
          code: result.code,
          slotId: result.slotId,
          status: result.status,
          message: result.message,
        },
        { status: claimHttpStatus(result.code) },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: result.code,
        message: result.message,
        ...(result.ruleCode ? { ruleCode: result.ruleCode } : {}),
      },
      { status: claimHttpStatus(result.code) },
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    // The database's own words could carry a constraint or a query; they never
    // reach the volunteer.
    console.error("claim failed");
    return NextResponse.json(
      { ok: false, code: "unavailable", message: UNAVAILABLE_SENTENCE },
      { status: 503 },
    );
  }
}

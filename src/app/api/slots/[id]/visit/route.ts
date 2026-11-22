import { NextResponse } from "next/server";
import { authErrorResponse, requireApi } from "@/server/auth/guards";
import {
  isVisitAction,
  type VisitRefusalCode,
} from "@/server/domain/my-claims";
import { recordVisitCheckpoint } from "@/server/repositories/my-claims";

/**
 * Check in or out of a confirmed home visit.
 *
 * The signed session is the identity; the URL id only chooses a row the
 * volunteer already claimed. The repository holds the slot row, re-reads the
 * volunteer's own checkpoints, and writes the append-only audit row in the same
 * transaction, so a double click cannot produce a second checkpoint.
 *
 * A browser form post is answered with a relative 303 back to the claim, where
 * a closed flash code renders one calm sentence. An API client gets JSON with
 * the real status and the same sentence. No SQL, stack, or another person's id
 * ever reaches the response.
 */

export const dynamic = "force-dynamic";

export const VISIT_HTTP_STATUS: Record<VisitRefusalCode, 400 | 403 | 404 | 409> = {
  not_found: 404,
  not_home: 409,
  not_covered: 409,
  already_checked_in: 409,
  not_checked_in: 409,
  already_checked_out: 409,
};

const UNAVAILABLE_SENTENCE =
  "We couldn't record that just now. Please try again, or speak to your coordinator after a Sunday service.";

function wantsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function redirectToClaim(slotId: string, code: string): Response {
  // A relative Location: an absolute redirect can land on a host that does not
  // own the session cookie.
  return new Response(null, {
    status: 303,
    headers: {
      location: `/my-claims/${encodeURIComponent(slotId)}?visit=${code}`,
    },
  });
}

async function readAction(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await request.formData();
    return form.get("action");
  }

  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "action" in body) {
      return (body as { action: unknown }).action;
    }
  } catch {
    return null;
  }

  return null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const action = await readAction(request);

  if (!isVisitAction(action)) {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_action",
        message: "Choose check in or check out.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await recordVisitCheckpoint(auth.session, id, action);

    if (wantsHtml(request)) {
      return redirectToClaim(id, result.code);
    }

    if (result.ok) {
      return NextResponse.json(
        {
          ok: true,
          code: result.code,
          message: result.message,
          checkedInAt: result.checkedInAt.toISOString(),
          checkedOutAt: result.checkedOutAt?.toISOString() ?? null,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      { ok: false, code: result.code, message: result.message },
      { status: VISIT_HTTP_STATUS[result.code] },
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("visit checkpoint failed");
    return NextResponse.json(
      { ok: false, code: "unavailable", message: UNAVAILABLE_SENTENCE },
      { status: 503 },
    );
  }
}

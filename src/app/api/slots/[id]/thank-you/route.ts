import { NextResponse } from "next/server";
import { authErrorResponse, requireApi } from "@/server/auth/guards";
import { CAREGIVER_ROLES } from "@/server/auth/policy";
import {
  recordCaregiverThankYou,
  type ThankYouRefusalCode,
} from "@/server/repositories/closure";

/**
 * Keep one optional thank-you on a time that is done.
 *
 * The repository re-derives the caregiver's ownership from the session, holds
 * the slot row, and writes at most one append-only audit row. This route only
 * reads the note (an HTML form or a JSON body), translates the closed outcome
 * into a redirect or JSON, and never decides eligibility from the request.
 *
 * Nothing here creates a notification, a reminder, or a follow-up.
 */

export const dynamic = "force-dynamic";

const THANK_YOU_HTTP_STATUS: Record<ThankYouRefusalCode, 400 | 404 | 409> = {
  not_found: 404,
  not_done: 409,
  already_thanked: 409,
  too_long: 400,
};

const UNAVAILABLE_SENTENCE =
  "We couldn't keep that just now. Please try again, or speak to your coordinator after a Sunday service.";

function wantsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

async function readNote(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";

  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    return body && typeof body === "object" ? body.note : null;
  }

  const form = await request.formData().catch(() => null);
  return form?.get("note") ?? null;
}

function redirectToCare(code: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location: `/care?thanks=${encodeURIComponent(code)}` },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApi(CAREGIVER_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const note = await readNote(request);

  try {
    const result = await recordCaregiverThankYou(auth.session, id, note);

    if (wantsHtml(request)) {
      return redirectToCare(result.code);
    }

    if (result.ok) {
      return NextResponse.json(
        {
          ok: true,
          code: result.code,
          stored: result.stored,
          message: result.message,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      { ok: false, code: result.code, message: result.message },
      { status: THANK_YOU_HTTP_STATUS[result.code] },
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("caregiver thank-you failed");
    return NextResponse.json(
      { ok: false, code: "unavailable", message: UNAVAILABLE_SENTENCE },
      { status: 503 },
    );
  }
}

import { NextResponse } from "next/server";
import { authErrorResponse, requireApi } from "@/server/auth/guards";
import { CAREGIVER_ROLES } from "@/server/auth/policy";
import { submitAsk } from "@/server/services/ask-intake";

/**
 * The only write path for a caregiver's ask.
 *
 * Caregivers only: the signed session is the identity, never a form field. The
 * body is `{ text, consent, revisionOf? }`; validation, policy resolution, the
 * revision rule, and the decision run all live in the service so a future
 * screen cannot grow a second, weaker path.
 *
 * The caregiver gets 201 only after the ask and its first revision are
 * committed. A model failure never turns into a 500: the ask is already in the
 * coordinator queue and the caregiver still receives a calm receipt.
 */

export const dynamic = "force-dynamic";

const INVALID_BODY =
  "We couldn't read that submission. Please write your words in the box and try again.";

export async function POST(request: Request) {
  const auth = await requireApi(CAREGIVER_ROLES);
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json(
      { ok: false, code: "invalid", message: INVALID_BODY },
      { status: 400 },
    );
  }

  const body = payload as Record<string, unknown>;

  try {
    const result = await submitAsk({
      actor: auth.session,
      text: body.text,
      consent: body.consent,
      revisionOf: body.revisionOf,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, code: result.code, message: result.message },
        { status: result.httpStatus },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        askId: result.askId,
        revisionId: result.revisionId,
        status: result.status,
        decisionsRan: result.decisionsRan,
        decisionsPersisted: result.decisionsPersisted,
      },
      { status: 201 },
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    // No error text reaches the client: it could carry a query parameter.
    console.error("ask intake failed");
    return NextResponse.json(
      {
        ok: false,
        code: "unavailable",
        message:
          "We couldn't take that just now. Please try again, or call the church office and a person will write it down.",
      },
      { status: 503 },
    );
  }
}

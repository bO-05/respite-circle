import { NextResponse } from "next/server";
import { authErrorResponse, requireApi } from "@/server/auth/guards";
import { DESK_ROLES } from "@/server/auth/policy";
import { isSlotKind } from "@/server/domain/slots";
import { addDraftSlot } from "@/server/repositories/draft-slots";

/**
 * The coordinator's manual add-a-time API.
 *
 * This exists so the "personal care never becomes a slot" rule is provable over
 * plain HTTP as well as on the screen. The endpoint takes `{ kind }` and calls
 * the same repository the desk form calls, so there is one refusal path:
 *
 *   201  a draft was created (still invisible to every neighbour)
 *   400  the kind is not companion, home, drive, or meal
 *   403  the session is not a coordinator or deputy
 *   404  the ask id is malformed or outside this church
 *   409  refused: a held ask, personal care in the answers, a missing
 *        driver policy, or an incomplete calendar — the body carries the
 *        human sentence and nothing is written
 *
 * A draft created here is never published by this route.
 */

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NOT_FOUND = "That ask is not available.";

const UNAVAILABLE =
  "We couldn't add that just now. Nothing was created. Please try again.";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApi(DESK_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { ok: false, code: "not_found", message: NOT_FOUND },
      { status: 404 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  const kind =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).kind
      : undefined;

  if (!isSlotKind(kind)) {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_kind",
        message: "Choose companion, home, drive, or meal.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await addDraftSlot(auth.session, { askId: id, kind });

    if (!result.ok) {
      // A held ask, personal care in the answers, a missing driver
      // policy, or an incomplete calendar. One calm sentence, no SQL, nothing
      // written.
      return NextResponse.json(
        { ok: false, code: "refused", message: result.message },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        askId: result.askId,
        slotId: result.slotId,
        message: result.message,
      },
      { status: 201 },
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    console.error("manual draft slot failed");
    return NextResponse.json(
      { ok: false, code: "unavailable", message: UNAVAILABLE },
      { status: 503 },
    );
  }
}

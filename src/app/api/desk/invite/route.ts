import { NextResponse } from "next/server";
import { authErrorResponse, requireApi } from "@/server/auth/guards";
import { DESK_ROLES } from "@/server/auth/policy";
import { createInvite, type CreateInviteCode } from "@/server/repositories/invites";

/**
 * The invitation write path for a plain HTTP client.
 *
 * The browser uses the server action on `/desk/invite`; this handler exists so
 * the same repository can be exercised by a real signed cookie (and so a
 * hand-edited request has one guarded door rather than none). The session is
 * the identity: a caregiver or volunteer gets 403 before any read, and a
 * caregiver id from another church gets a generic 403 with zero writes.
 *
 * No email, SMS, or broadcast exists behind this route. It writes one in-app
 * invitation row and its audit event only.
 */

export const dynamic = "force-dynamic";

const INVALID_BODY =
  "We couldn't read that invitation. Please write the message in the app and try again.";

const UNAVAILABLE =
  "We couldn't save that invitation just now. Please try again, or call the church office and a person will write it down.";

function httpStatusFor(code: CreateInviteCode): number {
  if (code === "invalid_body") return 400;
  if (code === "family_not_ready") return 409;
  return 403;
}

type InvitePayload = { caregiverId: string; body: string };

async function readPayload(request: Request): Promise<InvitePayload | null> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    return {
      caregiverId:
        typeof record.caregiverId === "string" ? record.caregiverId : "",
      body: typeof record.body === "string" ? record.body : "",
    };
  }

  try {
    const form = await request.formData();
    const caregiverId = form.get("caregiverId");
    const body = form.get("body");

    return {
      caregiverId: typeof caregiverId === "string" ? caregiverId : "",
      body: typeof body === "string" ? body : "",
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const auth = await requireApi(DESK_ROLES);
  if (!auth.ok) return auth.response;

  const payload = await readPayload(request);
  if (!payload) {
    return NextResponse.json(
      { ok: false, code: "invalid_body", message: INVALID_BODY },
      { status: 400 },
    );
  }

  try {
    const result = await createInvite(auth.session, payload);

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, code: result.code, message: result.message },
        { status: httpStatusFor(result.code) },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        channel: "in_app",
        inviteId: result.invite.id,
        caregiverId: result.invite.caregiverId,
        createdAt: result.invite.createdAt.toISOString(),
        message: result.message,
      },
      { status: 201 },
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    // A database message could carry a constraint or a query; it never reaches
    // the coordinator.
    console.error("invite write failed");
    return NextResponse.json(
      { ok: false, code: "unavailable", message: UNAVAILABLE },
      { status: 503 },
    );
  }
}

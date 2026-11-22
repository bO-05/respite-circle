import { db as appDb } from "@/db/client";
import type { Actor } from "@/server/auth/policy";
import {
  canApproveAsk,
  canSendBackAsk,
  validateSendBackNote,
  type SendBackNoteValidation,
} from "@/server/domain/ask-review";
import {
  approveAsk,
  resolveHeldDraftAndPublish,
  sendBackAsk,
  type ApproveOutcome,
  type PublishHeldOutcome,
  type SendBackOutcome,
} from "@/server/repositories/ask-review";
import {
  getDeskAsk,
  type AppDatabase,
} from "@/server/repositories/coordinator";

/**
 * The coordinator's two decisions about an ask.
 *
 * The summary read (identity, status, created time — never the words) comes
 * from `getDeskAsk`, which is the desk's summary reader. The words reader stays
 * `getCoordinatorAskWords` in `repositories/asks.ts`; the page uses that one
 * for the verbatim block. Keeping the two apart is deliberate: a summary can
 * never carry a caregiver's story into a queue, a message, or an audit row.
 *
 * The pre-check below is for a calm sentence, not for enforcement. The
 * repository re-checks the status inside the row lock, so a second tab or a
 * second coordinator cannot approve or send back the same ask twice.
 */

export type ApproveResult =
  | ApproveOutcome
  | { ok: false; reason: "not_found" | "not_waiting"; message: string };

export async function approveAskForCoordinator(
  actor: Actor,
  askId: string,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<ApproveResult> {
  const summary = await getDeskAsk(actor, askId, database);
  if (!summary) {
    return { ok: false, reason: "not_found", message: "That ask is not available." };
  }

  const guard = canApproveAsk(summary.status);
  if (!guard.ok) {
    return { ok: false, reason: "not_waiting", message: guard.message };
  }

  return approveAsk(actor, askId, database, now);
}

export type SendBackResult =
  | SendBackOutcome
  | { ok: false; reason: "not_found" | "not_waiting" | "invalid_note"; message: string };

export async function sendBackAskForCoordinator(
  actor: Actor,
  input: { askId: string; note: unknown },
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<SendBackResult> {
  const summary = await getDeskAsk(actor, input.askId, database);
  if (!summary) {
    return { ok: false, reason: "not_found", message: "That ask is not available." };
  }

  const guard = canSendBackAsk(summary.status);
  if (!guard.ok) {
    return { ok: false, reason: "not_waiting", message: guard.message };
  }

  const note: SendBackNoteValidation = validateSendBackNote(input.note);
  if (!note.ok) {
    return { ok: false, reason: "invalid_note", message: note.message };
  }

  return sendBackAsk(actor, input, database, now);
}

export type PublishHeldResult = PublishHeldOutcome;

export async function resolveHeldDraftForCoordinator(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
): Promise<PublishHeldResult> {
  return resolveHeldDraftAndPublish(actor, slotId, database);
}

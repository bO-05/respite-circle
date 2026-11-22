import { and, eq, sql } from "drizzle-orm";
import { ask, auditEvent, slot } from "@/db/schema";
import type { Actor } from "@/server/auth/policy";
import { canCloseAsk } from "@/server/domain/closure";
import type { AppDatabase } from "./coordinator";

/**
 * The ask's own life, derived from its published times.
 *
 * An ask becomes `closed` when none of its times is still live (open, claimed,
 * or covered) and at least one has finished (done, cancelled, or expired
 * unclaimed). The rule lives in `canCloseAsk`; this module only applies it.
 *
 * The ask row is locked before the count, so two volunteers closing the last
 * two times at the same moment serialize on one row: the first sees the other
 * time still live and does nothing, the second sees both finished and closes
 * the ask exactly once. Drafts that were never offered are not counted — a
 * time no neighbour could see was never an obligation.
 *
 * No notification row is ever written here. Closing an ask is a quiet data
 * fact, not a message.
 */

export type AskClosureCause = "slot_done" | "session_cancelled" | "slot_expired";

export type AskClosureOutcome = {
  closed: boolean;
  askId: string;
  askStatus: string | null;
};

export async function closeAskIfFinished(
  database: AppDatabase,
  input: {
    churchId: string;
    askId: string;
    actor: Actor | null;
    cause: AskClosureCause;
  },
  now: Date,
): Promise<AskClosureOutcome> {
  const [locked] = await database
    .select({ id: ask.id, status: ask.status })
    .from(ask)
    .where(and(eq(ask.id, input.askId), eq(ask.churchId, input.churchId)))
    .limit(1)
    .for("update");

  if (!locked) {
    return { closed: false, askId: input.askId, askStatus: null };
  }

  if (locked.status !== "approved") {
    return { closed: false, askId: locked.id, askStatus: locked.status };
  }

  const [counts] = await database
    .select({
      live: sql<number>`count(*) FILTER (WHERE ${slot.status} IN ('open', 'claimed', 'covered'))::int`,
      closed: sql<number>`count(*) FILTER (WHERE ${slot.status} IN ('done', 'cancelled', 'expired_unclaimed'))::int`,
    })
    .from(slot)
    .where(
      and(eq(slot.churchId, input.churchId), eq(slot.askId, input.askId)),
    );

  const live = Number(counts?.live ?? 0);
  const closedSlots = Number(counts?.closed ?? 0);

  if (!canCloseAsk({ live, closed: closedSlots })) {
    return { closed: false, askId: locked.id, askStatus: locked.status };
  }

  const updated = await database
    .update(ask)
    .set({ status: "closed", updatedAt: now })
    .where(
      and(
        eq(ask.id, input.askId),
        eq(ask.churchId, input.churchId),
        eq(ask.status, "approved"),
      ),
    )
    .returning({ id: ask.id });

  if (!updated[0]) {
    return { closed: false, askId: locked.id, askStatus: locked.status };
  }

  await database.insert(auditEvent).values({
    churchId: input.churchId,
    actorType: input.actor ? "human" : "system",
    actorId: input.actor?.personId ?? null,
    action: "ask_closed",
    entity: "ask",
    entityId: input.askId,
    detail: {
      cause: input.cause,
      liveSlots: live,
      closedSlots,
      at: now.toISOString(),
    },
    createdAt: now,
  });

  return { closed: true, askId: locked.id, askStatus: "closed" };
}

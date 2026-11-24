import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import {
  ask,
  auditEvent,
  careRecipient,
  church,
  person,
  policy,
  slot,
  slotCandidate,
  volunteer,
} from "@/db/schema";
import { resolveNow } from "@/lib/clock";
import {
  DESK_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import {
  canClaim,
  civilDateKey,
  type VolunteerGatingFacts,
} from "@/server/domain/gating";
import type { SlotKind, SlotTier } from "@/server/domain/slots";
import type { AppDatabase } from "@/server/repositories/coordinator";

/**
 * Evaluate every active volunteer against every draft time, and record one
 * `slot_candidate` row for each pair.
 *
 * This is the write side of VAL-DESK-008. It runs when plain code constructs
 * the drafts, when a coordinator adds or edits a draft, and when the coordinator
 * presses "Check again" on the panel. Re-evaluation is an upsert keyed by
 * `(slot_id, volunteer_id)`, so a changed volunteer file changes the recorded
 * explanation in place and never appends a second row for the same person.
 *
 * No model is involved. The rule is `canClaim()` — the same pure function the
 * future claim path uses — so the desk's explanation of a refusal and the
 * enforcement of that refusal cannot drift apart.
 */

export type CandidateEvaluationInput = {
  churchId: string;
  slotIds: string[];
  now?: Date;
};

export type CandidateEvaluationResult = {
  slots: number;
  volunteers: number;
  rows: number;
  eligible: number;
  ineligible: number;
};

const EMPTY_RESULT: CandidateEvaluationResult = {
  slots: 0,
  volunteers: 0,
  rows: 0,
  eligible: 0,
  ineligible: 0,
};

type Commitment = {
  windowStart: Date | null;
  windowEnd: Date | null;
};

type CommitmentJson = { start: string | null; end: string | null };

function activeVolunteerPredicate(churchId: string) {
  return and(
    eq(person.churchId, churchId),
    eq(person.active, true),
    sql`${person.roles} @> '["volunteer"]'::jsonb`,
  );
}

/**
 * Write (or refresh) one row per active volunteer per draft slot.
 *
 * Slots that are not drafts, or belong to another church, are ignored — the
 * query is scoped by `church_id` and `status = 'draft'`, so a stale id can never
 * leak another church's volunteer list into this panel.
 */
export async function evaluateCandidatesForSlots(
  database: AppDatabase,
  input: CandidateEvaluationInput,
): Promise<CandidateEvaluationResult> {
  const now = input.now ?? resolveNow();
  const slotIds = [...new Set(input.slotIds)];
  if (slotIds.length === 0) return EMPTY_RESULT;

  const slotRows = await database
    .select({
      id: slot.id,
      kind: slot.kind,
      tier: slot.tier,
      gated: slot.gated,
      windowStart: slot.windowStart,
      windowEnd: slot.windowEnd,
      recipientId: ask.careRecipientId,
      recipientCaregiverId: careRecipient.createdByCaregiverId,
      transportEnabled: policy.transportEnabled,
      timeZone: church.timezone,
    })
    .from(slot)
    .innerJoin(ask, eq(ask.id, slot.askId))
    .innerJoin(policy, eq(policy.id, ask.policyVersionId))
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .innerJoin(church, eq(church.id, slot.churchId))
    .where(
      and(
        eq(slot.churchId, input.churchId),
        inArray(slot.id, slotIds),
        eq(slot.status, "draft"),
      ),
    )
    .orderBy(asc(slot.createdAt), asc(slot.id));

  if (slotRows.length === 0) return EMPTY_RESULT;

  // One round trip for every fact the gate needs: the volunteer file, the
  // familiar-face attestations, and the places they already hold. The Neon round
  // trip is ~325 ms, so fanning out into three queries would roughly double the
  // time a coordinator waits after saving a draft.
  const volunteerRows = await database
    .select({
      personId: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      driverOk: volunteer.driverOk,
      checklistCompletedAt: volunteer.checklistCompletedAt,
      referencesContacted: volunteer.referencesContacted,
      trainingExpiresOn: volunteer.trainingExpiresOn,
      backgroundRenewsOn: volunteer.backgroundRenewsOn,
      familiarRecipientIds: sql<string[]>`COALESCE((
        SELECT jsonb_agg(ff.care_recipient_id)
          FROM familiar_face AS ff
         WHERE ff.volunteer_id = ${person.id}
           AND ff.revoked_at IS NULL
      ), '[]'::jsonb)`,
      commitments: sql<CommitmentJson[]>`COALESCE((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'start', held.window_start,
                   'end', held.window_end
                 )
               )
          FROM slot AS held
         WHERE held.church_id = ${input.churchId}
           AND held.claimed_by = ${person.id}
           AND held.status IN ('claimed','covered','done')
           AND held.window_start IS NOT NULL
           AND held.window_end IS NOT NULL
      ), '[]'::jsonb)`,
    })
    .from(volunteer)
    .innerJoin(person, eq(person.id, volunteer.personId))
    .where(activeVolunteerPredicate(input.churchId))
    .orderBy(asc(person.firstName), asc(person.lastName), asc(person.id));

  const commitments = new Map<string, Commitment[]>();
  for (const row of volunteerRows) {
    commitments.set(
      row.personId,
      (row.commitments ?? [])
        .filter((entry) => entry.start && entry.end)
        .map((entry) => ({
          windowStart: new Date(entry.start as string),
          windowEnd: new Date(entry.end as string),
        })),
    );
  }

  type Pending = {
    slotId: string;
    volunteerId: string;
    eligible: boolean;
    ruleCode: ReturnType<typeof canClaim>["ruleCode"];
    fixHint: string | null;
    owner: ReturnType<typeof canClaim>["owner"];
    createdAt: Date;
  };

  const pending: Pending[] = [];
  let eligible = 0;

  for (const draft of slotRows) {
    const dayKey = draft.windowStart
      ? civilDateKey(draft.windowStart, draft.timeZone)
      : null;

    for (const personRow of volunteerRows) {
      const held = commitments.get(personRow.personId) ?? [];

      const servingThatDay = dayKey
        ? held.filter(
            (entry) =>
              entry.windowStart &&
              civilDateKey(entry.windowStart, draft.timeZone) === dayKey,
          ).length
        : 0;

      const windowOverlapsCommitment =
        draft.windowStart && draft.windowEnd
          ? held.some(
              (entry) =>
                entry.windowStart &&
                entry.windowEnd &&
                entry.windowStart < draft.windowEnd! &&
                draft.windowStart! < entry.windowEnd,
            )
          : false;

      const facts: VolunteerGatingFacts = {
        personId: personRow.personId,
        firstName: personRow.firstName,
        checklistCompletedAt: personRow.checklistCompletedAt,
        referencesContacted: personRow.referencesContacted,
        trainingExpiresOn: personRow.trainingExpiresOn,
        backgroundRenewsOn: personRow.backgroundRenewsOn,
        driverOk: personRow.driverOk,
        familiarForRecipient: (personRow.familiarRecipientIds ?? []).includes(
          draft.recipientId,
        ),
        servingThatDay,
        windowOverlapsCommitment,
        isCaregiverForRecipient:
          personRow.personId === draft.recipientCaregiverId,
      };

      const verdict = canClaim(
        facts,
        {
          kind: draft.kind as SlotKind,
          tier: draft.tier as SlotTier,
          gated: draft.gated,
          windowStart: draft.windowStart,
          windowEnd: draft.windowEnd,
        },
        { transportEnabled: draft.transportEnabled },
        { now, timeZone: draft.timeZone },
      );

      if (verdict.eligible) eligible += 1;

      pending.push({
        slotId: draft.id,
        volunteerId: personRow.personId,
        eligible: verdict.eligible,
        ruleCode: verdict.ruleCode,
        fixHint: verdict.fixHint,
        owner: verdict.owner,
        createdAt: now,
      });
    }
  }

  if (pending.length > 0) {
    await database
      .insert(slotCandidate)
      .values(pending)
      .onConflictDoUpdate({
        target: [slotCandidate.slotId, slotCandidate.volunteerId],
        set: {
          eligible: sql`excluded.eligible`,
          ruleCode: sql`excluded.rule_code`,
          fixHint: sql`excluded.fix_hint`,
          owner: sql`excluded.owner`,
          createdAt: sql`excluded.created_at`,
        },
      });
  }

  return {
    slots: slotRows.length,
    volunteers: volunteerRows.length,
    rows: pending.length,
    eligible,
    ineligible: pending.length - eligible,
  };
}

export type ReevaluationResult = {
  ok: boolean;
  message: string;
  counts?: CandidateEvaluationResult;
};

/**
 * Drop candidate rows whose volunteer is no longer active in this church.
 *
 * It runs on the explicit check, not on every draft edit: a deactivated
 * volunteer's row is filtered out of the panel read, so leaving it until the
 * next check never shows a wrong explanation — and the hot save path stays one
 * round trip shorter.
 */
export async function pruneInactiveCandidates(
  database: AppDatabase,
  input: { churchId: string; slotIds: string[] },
): Promise<void> {
  if (input.slotIds.length === 0) return;

  await database
    .delete(slotCandidate)
    .where(
      and(
        inArray(slotCandidate.slotId, input.slotIds),
        sql`NOT EXISTS (
          SELECT 1
            FROM person AS active_person
           WHERE active_person.id = ${slotCandidate.volunteerId}
             AND active_person.church_id = ${input.churchId}
             AND active_person.active = true
             AND active_person.roles @> '["volunteer"]'::jsonb
        )`,
      ),
    );
}

function plural(count: number, singular: string, pluralWord: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${pluralWord}`;
}

/**
 * The coordinator's explicit "Check again". Re-derives the desk role and the
 * church scope, refuses an ask that is no longer waiting, and records the run in
 * the append-only audit log.
 */
export async function reevaluateExclusions(
  actor: Actor,
  askId: string,
  database: AppDatabase = appDb,
  now: Date = resolveNow(),
): Promise<ReevaluationResult> {
  requireRoleSession(actor, DESK_ROLES);

  const askRows = await database
    .select({ id: ask.id, status: ask.status })
    .from(ask)
    .where(and(eq(ask.id, askId), eq(ask.churchId, actor.churchId)))
    .limit(1);

  const askRow = askRows[0];
  if (!askRow) {
    return { ok: false, message: "That ask is not available." };
  }

  if (askRow.status !== "waiting_coordinator") {
    return {
      ok: false,
      message:
        "This ask is no longer waiting for a coordinator. Only draft times are checked here.",
    };
  }

  const draftRows = await database
    .select({ id: slot.id })
    .from(slot)
    .where(
      and(
        eq(slot.askId, askRow.id),
        eq(slot.churchId, actor.churchId),
        eq(slot.status, "draft"),
      ),
    );

  if (draftRows.length === 0) {
    return {
      ok: true,
      message:
        "There are no draft times to check yet. Add a time, then check again.",
      counts: EMPTY_RESULT,
    };
  }

  const counts = await evaluateCandidatesForSlots(database, {
    churchId: actor.churchId,
    slotIds: draftRows.map((row) => row.id),
    now,
  });

  await pruneInactiveCandidates(database, {
    churchId: actor.churchId,
    slotIds: draftRows.map((row) => row.id),
  });

  await database.insert(auditEvent).values({
    churchId: actor.churchId,
    actorType: "human",
    actorId: actor.personId,
    action: "candidates_evaluated",
    entity: "ask",
    entityId: askRow.id,
    detail: {
      slots: counts.slots,
      volunteers: counts.volunteers,
      eligible: counts.eligible,
      ineligible: counts.ineligible,
    },
  });

  if (counts.volunteers === 0) {
    return {
      ok: true,
      message:
        "No active volunteers are recorded for this church, so there is nobody to check yet.",
      counts,
    };
  }

  return {
    ok: true,
    message: `Checked ${plural(
      counts.volunteers,
      "active volunteer",
      "active volunteers",
    )} against ${plural(counts.slots, "draft time", "draft times")}. ${plural(
      counts.eligible,
      "person could be asked",
      "people could be asked",
    )}; ${plural(
      counts.ineligible,
      "person needs something first",
      "people need something first",
    )}.`,
    counts,
  };
}

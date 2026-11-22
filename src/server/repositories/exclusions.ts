import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import {
  ask,
  askStatusEnum,
  church,
  person,
  slot,
  slotCandidate,
  volunteer,
} from "@/db/schema";
import {
  DESK_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import {
  RULE_CODE_COPY,
  type CandidateOwner,
  type RuleCode,
} from "@/server/domain/gating";
import type { SlotKind, SlotTier } from "@/server/domain/slots";
import type { AppDatabase } from "./coordinator";

/**
 * The coordinator-only "why not proposed" panel.
 *
 * Read-only, church-scoped, and desk-only: there is no caregiver or volunteer
 * read of `slot_candidate` in this module or anywhere else. Rows are ordered
 * alphabetically by the volunteer's name and carry no score, count, or priority;
 * the panel explains a gate, it never ranks a person.
 */

export type AskStatus = (typeof askStatusEnum.enumValues)[number];

export type ExclusionCandidateRow = {
  volunteerId: string;
  firstName: string;
  lastName: string;
  eligible: boolean;
  ruleCode: RuleCode;
  ruleTitle: string;
  fixHint: string | null;
  owner: CandidateOwner | null;
  ownerLabel: string;
};

export type ExclusionSlotView = {
  slotId: string;
  kind: SlotKind;
  tier: SlotTier;
  label: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  gated: boolean;
  holdReason: string | null;
  rows: ExclusionCandidateRow[];
  eligibleCount: number;
  ineligibleCount: number;
};

export type ExclusionPanel = {
  askId: string;
  askStatus: AskStatus;
  timeZone: string;
  slots: ExclusionSlotView[];
  /** Active volunteers in this church, whether or not a row exists yet. */
  activeVolunteerCount: number;
  /** Draft slots whose rows are missing at least one active volunteer. */
  staleSlotCount: number;
  evaluatedAt: Date | null;
};

const OWNER_LABELS: Record<CandidateOwner, string> = {
  coordinator: "Coordinator",
  church: "Church policy",
  volunteer: "Volunteer",
};

function isOwner(value: string | null): value is CandidateOwner {
  return value === "coordinator" || value === "church" || value === "volunteer";
}

function isRuleCode(value: string): value is RuleCode {
  return value in RULE_CODE_COPY;
}

function activeVolunteerPredicate(churchId: string) {
  return and(
    eq(person.churchId, churchId),
    eq(person.active, true),
    sql`${person.roles} @> '["volunteer"]'::jsonb`,
  );
}

export async function getExclusionPanel(
  actor: Actor,
  askId: string,
  database: AppDatabase = appDb,
): Promise<ExclusionPanel | null> {
  requireRoleSession(actor, DESK_ROLES);

  const askRows = await database
    .select({
      id: ask.id,
      status: ask.status,
      timeZone: church.timezone,
    })
    .from(ask)
    .innerJoin(church, eq(church.id, ask.churchId))
    .where(and(eq(ask.id, askId), eq(ask.churchId, actor.churchId)))
    .limit(1);

  const askRow = askRows[0];
  if (!askRow) return null;

  const [slotRows, volunteerCountRows] = await Promise.all([
    database
      .select({
        id: slot.id,
        kind: slot.kind,
        tier: slot.tier,
        label: slot.label,
        windowStart: slot.windowStart,
        windowEnd: slot.windowEnd,
        gated: slot.gated,
        holdReason: slot.holdReason,
      })
      .from(slot)
      .where(
        and(
          eq(slot.askId, askRow.id),
          eq(slot.churchId, actor.churchId),
          eq(slot.status, "draft"),
        ),
      )
      .orderBy(asc(slot.createdAt), asc(slot.id)),
    database
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(volunteer)
      .innerJoin(person, eq(person.id, volunteer.personId))
      .where(activeVolunteerPredicate(actor.churchId)),
  ]);

  const slotIds = slotRows.map((row) => row.id);

  const candidateRows =
    slotIds.length > 0
      ? await database
          .select({
            slotId: slotCandidate.slotId,
            volunteerId: slotCandidate.volunteerId,
            firstName: person.firstName,
            lastName: person.lastName,
            eligible: slotCandidate.eligible,
            ruleCode: slotCandidate.ruleCode,
            fixHint: slotCandidate.fixHint,
            owner: slotCandidate.owner,
            createdAt: slotCandidate.createdAt,
          })
          .from(slotCandidate)
          .innerJoin(person, eq(person.id, slotCandidate.volunteerId))
          .where(
            and(
              inArray(slotCandidate.slotId, slotIds),
              activeVolunteerPredicate(actor.churchId),
            ),
          )
          // Alphabetical, never by eligibility. A gate is a reason, not a rank.
          .orderBy(
            asc(person.firstName),
            asc(person.lastName),
            asc(person.id),
          )
      : [];

  const activeVolunteerCount = Number(volunteerCountRows[0]?.count ?? 0);
  let evaluatedAt: Date | null = null;

  const bySlot = new Map<string, ExclusionCandidateRow[]>();
  for (const candidate of candidateRows) {
    if (!isRuleCode(candidate.ruleCode)) continue;
    const owner = isOwner(candidate.owner) ? candidate.owner : null;
    const row: ExclusionCandidateRow = {
      volunteerId: candidate.volunteerId,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      eligible: candidate.eligible,
      ruleCode: candidate.ruleCode,
      ruleTitle: RULE_CODE_COPY[candidate.ruleCode].title,
      fixHint: candidate.fixHint,
      owner,
      ownerLabel: owner ? OWNER_LABELS[owner] : "—",
    };
    const list = bySlot.get(candidate.slotId) ?? [];
    list.push(row);
    bySlot.set(candidate.slotId, list);

    if (!evaluatedAt || candidate.createdAt > evaluatedAt) {
      evaluatedAt = candidate.createdAt;
    }
  }

  let staleSlotCount = 0;
  const slots: ExclusionSlotView[] = slotRows.map((row) => {
    const rows = bySlot.get(row.id) ?? [];
    if (rows.length < activeVolunteerCount) staleSlotCount += 1;
    const eligibleCount = rows.filter((entry) => entry.eligible).length;

    return {
      slotId: row.id,
      kind: row.kind as SlotKind,
      tier: row.tier as SlotTier,
      label: row.label,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
      gated: row.gated,
      holdReason: row.holdReason,
      rows,
      eligibleCount,
      ineligibleCount: rows.length - eligibleCount,
    };
  });

  return {
    askId: askRow.id,
    askStatus: askRow.status,
    timeZone: askRow.timeZone,
    slots,
    activeVolunteerCount,
    staleSlotCount,
    evaluatedAt,
  };
}

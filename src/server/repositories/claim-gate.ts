import { sql, type SQL } from "drizzle-orm";
import { CHECKLIST_VALID_MONTHS, DAILY_SERVING_LIMIT } from "@/server/domain/gating";

/**
 * The whole gate, inside the claim statement.
 *
 * The claim is one `UPDATE slot ... WHERE id = $1 AND status = 'open' AND
 * claimed_by IS NULL AND <this predicate> RETURNING id`. Under Postgres
 * `READ COMMITTED` the row lock serialises concurrent claims, so exactly one of
 * them can match; the losers re-read a row that is no longer `open` and get zero
 * rows. There is no advisory lock and no application mutex.
 *
 * The first clause is a window rule, not an eligibility rule: the time has not
 * started. `canClaim` answers "may this person take this place"; this also
 * answers "is this place still on offer at all". The board stops listing a
 * started time, so a perfect volunteer's request for one must match no row.
 *
 * The remaining clauses mirror `canClaim` in `src/server/domain/gating.ts` rule
 * for rule, in the same order:
 *
 *   1. an active volunteer file in this church
 *   2. never the family's own caregiver
 *   3. a drive only while the church's driver policy is signed
 *   4. no existing place overlapping this window
 *   5. fewer than two places on this local calendar day
 *   6. `home`: an active familiar-face attestation OR a current checklist
 *      (two references, current training, current background check)
 *   7. `drive`: a driver record
 *
 * The text is a fixed template with bound parameters; only the values vary, so
 * no request data is ever concatenated into SQL. The integration suite compares
 * this predicate with `canClaim` case by case so the board's explanation and
 * the enforcement cannot drift.
 */
export type ClaimGateInput = {
  personId: string;
  churchId: string;
  now: Date;
};

export function claimGatePredicate(input: ClaimGateInput): SQL {
  const { personId, churchId } = input;
  // A Date is not serialisable inside a raw sql fragment by this driver
  // pair; the ISO string is an unambiguous timestamptz literal with a bound
  // parameter, never concatenated text.
  const nowIso = input.now.toISOString();

  return sql`(
    (
      slot.window_start IS NULL
      OR slot.window_start > ${nowIso}::timestamptz
    )
    AND EXISTS (
      SELECT 1
        FROM volunteer AS gate_volunteer
        JOIN person AS gate_person ON gate_person.id = gate_volunteer.person_id
       WHERE gate_volunteer.person_id = ${personId}
         AND gate_person.church_id = ${churchId}
         AND gate_person.active = TRUE
    )
    AND NOT EXISTS (
      SELECT 1
        FROM ask AS gate_ask
        JOIN care_recipient AS gate_recipient
          ON gate_recipient.id = gate_ask.care_recipient_id
       WHERE gate_ask.id = slot.ask_id
         AND gate_recipient.created_by_caregiver_id = ${personId}
    )
    AND (
      slot.kind <> 'drive'
      OR EXISTS (
        SELECT 1
          FROM ask AS gate_drive_ask
          JOIN policy AS gate_drive_policy
            ON gate_drive_policy.id = gate_drive_ask.policy_version_id
         WHERE gate_drive_ask.id = slot.ask_id
           AND gate_drive_policy.transport_enabled = TRUE
      )
    )
    AND NOT EXISTS (
      SELECT 1
        FROM slot AS gate_held
       WHERE gate_held.church_id = ${churchId}
         AND gate_held.claimed_by = ${personId}
         AND gate_held.status IN ('claimed', 'covered', 'done')
         AND gate_held.id <> slot.id
         AND gate_held.window_start IS NOT NULL
         AND gate_held.window_end IS NOT NULL
         AND slot.window_start IS NOT NULL
         AND slot.window_end IS NOT NULL
         AND gate_held.window_start < slot.window_end
         AND slot.window_start < gate_held.window_end
    )
    AND (
      slot.window_start IS NULL
      OR (
        SELECT COUNT(*)
          FROM slot AS gate_day
         WHERE gate_day.church_id = ${churchId}
           AND gate_day.claimed_by = ${personId}
           AND gate_day.status IN ('claimed', 'covered', 'done')
           AND gate_day.window_start IS NOT NULL
           AND (
             gate_day.window_start AT TIME ZONE (
               SELECT gate_church.timezone
                 FROM church AS gate_church
                WHERE gate_church.id = ${churchId}
             )
           )::date = (
             slot.window_start AT TIME ZONE (
               SELECT gate_church.timezone
                 FROM church AS gate_church
                WHERE gate_church.id = ${churchId}
             )
           )::date
      ) < (${DAILY_SERVING_LIMIT}::int)
    )
    AND (
      slot.kind <> 'home'
      OR EXISTS (
        SELECT 1
          FROM familiar_face AS gate_familiar
          JOIN ask AS gate_home_ask ON gate_home_ask.id = slot.ask_id
         WHERE gate_familiar.volunteer_id = ${personId}
           AND gate_familiar.care_recipient_id = gate_home_ask.care_recipient_id
           AND gate_familiar.revoked_at IS NULL
      )
      OR EXISTS (
        SELECT 1
          FROM volunteer AS gate_checklist
         WHERE gate_checklist.person_id = ${personId}
           AND gate_checklist.checklist_completed_at IS NOT NULL
           AND gate_checklist.checklist_completed_at
                 + (INTERVAL '1 month' * (${CHECKLIST_VALID_MONTHS}::int))
                 > ${nowIso}::timestamptz
           AND gate_checklist.references_contacted >= 2
           AND gate_checklist.training_expires_on IS NOT NULL
           AND gate_checklist.training_expires_on >= (
             (${nowIso}::timestamptz AT TIME ZONE (
               SELECT gate_church.timezone
                 FROM church AS gate_church
                WHERE gate_church.id = ${churchId}
             ))::date
           )
           AND gate_checklist.background_renews_on IS NOT NULL
           AND gate_checklist.background_renews_on >= (
             (${nowIso}::timestamptz AT TIME ZONE (
               SELECT gate_church.timezone
                 FROM church AS gate_church
                WHERE gate_church.id = ${churchId}
             ))::date
           )
      )
    )
    AND (
      slot.kind <> 'drive'
      OR EXISTS (
        SELECT 1
          FROM volunteer AS gate_driver
         WHERE gate_driver.person_id = ${personId}
           AND gate_driver.driver_ok = TRUE
      )
    )
  )`;
}

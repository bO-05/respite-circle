import type { SeedDb } from "./seed-core";
import { readAllTableCounts, type TableCounts } from "./counts";
import {
  expectedSeedCounts,
  seedAccessTokens,
  seedCareRecipients,
  seedCaregivers,
  seedChurch,
  seedCrisisScript,
  seedLocalCrisisLine,
  seedPeople,
  seedPolicy,
  seedQuestionSet,
  seedReferralResources,
  seedSafeguardingPromises,
  seedSessionTemplate,
  seedSessions,
  seedVolunteers,
} from "./seed-data";

/**
 * The seed verifier, shared by the CLI (`npm run db:verify`), the reset
 * endpoint, and the integration suite. Read-only: it never writes a row.
 */
export type VerifySeedResult = {
  counts: TableCounts;
  failures: string[];
  ok: boolean;
};

/**
 * Assert the demo cast is present and correct. Read-only; returns every
 * missing or wrong row so the caller can fail with one clear message.
 */
export async function verifySeed(db: SeedDb): Promise<VerifySeedResult> {
  const failures: string[] = [];
  const counts = await readAllTableCounts(db);

  for (const [table, expected] of Object.entries(expectedSeedCounts)) {
    const actual = counts[table] ?? 0;
    if (actual !== expected) {
      failures.push(`${table}: expected ${expected} row(s), found ${actual}`);
    }
  }

  const churches = await db.$client<{ name: string }[]>`SELECT name FROM church`;
  if (!churches.some((row) => row.name === seedChurch.name)) {
    failures.push(`missing church: ${seedChurch.name}`);
  }

  const people = await db.$client<
    { id: string; first_name: string; last_name: string; roles: string[]; access_token: string }[]
  >`SELECT id, first_name, last_name, roles, access_token FROM person`;

  for (const expected of seedPeople) {
    const found = people.find((row) => row.id === expected.id);
    if (!found) {
      failures.push(`missing person: ${expected.firstName} ${expected.lastName}`);
      continue;
    }
    for (const role of expected.roles) {
      if (!found.roles.includes(role)) {
        failures.push(
          `person ${expected.firstName} ${expected.lastName} is missing role "${role}"`,
        );
      }
    }
    if (found.access_token !== expected.accessToken) {
      failures.push(
        `person ${expected.firstName} ${expected.lastName} has an unexpected access token`,
      );
    }
  }

  const tokens = new Set(Object.values(seedAccessTokens));
  for (const token of tokens) {
    if (!people.some((row) => row.access_token === token)) {
      const owner = seedPeople.find((p) => p.accessToken === token);
      failures.push(
        `missing demo access link for ${owner?.firstName ?? "an expected person"} ${owner?.lastName ?? ""}`.trim(),
      );
    }
  }

  const caregiverRows = await db.$client<{ person_id: string }[]>`
    SELECT person_id FROM caregiver
  `;
  for (const expected of seedCaregivers) {
    if (!caregiverRows.some((row) => row.person_id === expected.personId)) {
      failures.push(`missing caregiver row for ${expected.personId}`);
    }
  }

  const recipients = await db.$client<
    { id: string; first_name: string; relation: string }[]
  >`SELECT id, first_name, relation FROM care_recipient`;
  for (const expected of seedCareRecipients) {
    const found = recipients.find((row) => row.id === expected.id);
    if (!found) {
      failures.push(
        `missing care recipient: ${expected.firstName} (${expected.relation})`,
      );
    }
  }

  const volunteerRows = await db.$client<{ person_id: string }[]>`
    SELECT person_id FROM volunteer
  `;
  for (const expected of seedVolunteers) {
    if (!volunteerRows.some((row) => row.person_id === expected.personId)) {
      failures.push(`missing volunteer row for ${expected.personId}`);
    }
  }

  type PolicyVerificationRow = {
    id: string;
    version: number;
    safeguarding_promises: string[];
    question_set: Array<{
      id: string;
      text: string;
      answerType: string;
      options?: string[];
      samples?: number;
    }>;
    crisis_script: string;
    local_crisis_line: string | null;
    referral_resources: Array<{ name: string; detail: string }>;
    familiar_face_default: boolean;
    reminder_window_hours: number;
    call_threshold_hours: number;
    call_after_open_hours: number;
    transport_enabled: boolean;
    auto_publish_low_risk: boolean;
    signed_off_by: string | null;
    signed_off_at: Date | null;
  };

  // A church that has saved an edit holds version 1 plus later versions, so
  // this verifier requires version 1 and tolerates the rest. The count is
  // reported (see `printCounts`) but never pinned to one.
  const policies = await db.$client<PolicyVerificationRow[]>`
    SELECT id, version, safeguarding_promises, question_set, crisis_script,
           local_crisis_line, referral_resources, familiar_face_default,
           reminder_window_hours, call_threshold_hours, call_after_open_hours,
           transport_enabled, auto_publish_low_risk,
           signed_off_by, signed_off_at
      FROM policy
     WHERE version = 1 AND church_id = ${seedChurch.id}
  `;
  const seededPolicy = policies[0];

  if (!seededPolicy) {
    failures.push("missing policy version 1");
  } else {
    const questionIds = seededPolicy.question_set.map((question) => question.id);
    if (questionIds.join(",") !== seedQuestionSet.map((q) => q.id).join(",")) {
      failures.push(
        "policy version 1 must carry the nine typed questions Q1â€“Q9 in order",
      );
    }
    for (const question of seededPolicy.question_set) {
      if (!question.text?.trim()) {
        failures.push(`policy question ${question.id} is missing its text`);
      }
      if (question.answerType !== "yesno" && question.answerType !== "pick") {
        failures.push(
          `policy question ${question.id} has an unexpected type: ${question.answerType}`,
        );
      }
    }

    if (
      JSON.stringify(seededPolicy.safeguarding_promises) !==
      JSON.stringify(seedSafeguardingPromises)
    ) {
      failures.push(
        "policy version 1 promises do not match the approved wording",
      );
    }
    if (seededPolicy.crisis_script !== seedCrisisScript) {
      failures.push("policy version 1 crisis script is missing or has changed");
    }
    if (seededPolicy.local_crisis_line !== seedLocalCrisisLine) {
      failures.push("policy version 1 local crisis line is missing");
    }

    const referralNames = seededPolicy.referral_resources.map(
      (resource) => resource.name,
    );
    for (const resource of seedReferralResources) {
      if (!referralNames.includes(resource.name)) {
        failures.push(
          `policy version 1 is missing the ${resource.name} referral`,
        );
      }
    }

    if (!seededPolicy.familiar_face_default) {
      failures.push("policy familiar_face_default must be true");
    }
    if (seededPolicy.reminder_window_hours !== seedPolicy.reminderWindowHours) {
      failures.push(
        `policy reminder_window_hours must be ${seedPolicy.reminderWindowHours}`,
      );
    }
    if (seededPolicy.call_threshold_hours !== seedPolicy.callThresholdHours) {
      failures.push(
        `policy call_threshold_hours must be ${seedPolicy.callThresholdHours}`,
      );
    }
    if (seededPolicy.call_after_open_hours !== seedPolicy.callAfterOpenHours) {
      failures.push(
        `policy call_after_open_hours must be ${seedPolicy.callAfterOpenHours}`,
      );
    }
    if (seededPolicy.transport_enabled !== seedPolicy.transportEnabled) {
      failures.push(
        `policy transport_enabled must be ${seedPolicy.transportEnabled}`,
      );
    }
    if (seededPolicy.auto_publish_low_risk) {
      failures.push("policy auto_publish_low_risk must be false");
    }
    if (!seededPolicy.signed_off_by?.trim()) {
      failures.push("policy version 1 needs a named sign-off");
    }
    if (!seededPolicy.signed_off_at) {
      failures.push("policy version 1 needs a sign-off timestamp");
    }
  }

  const templates = await db.$client<
    { weekday: number; start_time: string; end_time: string }[]
  >`SELECT weekday,
           to_char(start_time, 'HH24:MI') AS start_time,
           to_char(end_time, 'HH24:MI') AS end_time
      FROM session_template`;
  const template = templates.find(
    (row) =>
      row.weekday === seedSessionTemplate.weekday &&
      row.start_time === "10:00" &&
      row.end_time === "14:00",
  );
  if (!template) {
    failures.push("missing Respite Morning template (Tuesday 10:00â€“14:00)");
  }

  const sessions = await db.$client<
    {
      id: string;
      starts_at: Date;
      iso_dow: number;
      local_start: string;
      local_end: string;
    }[]
  >`SELECT id,
           starts_at,
           EXTRACT(ISODOW FROM starts_at AT TIME ZONE 'America/New_York')::int AS iso_dow,
           to_char(starts_at AT TIME ZONE 'America/New_York', 'HH24:MI') AS local_start,
           to_char(ends_at AT TIME ZONE 'America/New_York', 'HH24:MI') AS local_end
      FROM session
     ORDER BY starts_at`;

  for (const expected of seedSessions) {
    const found = sessions.find((row) => row.id === expected.id);
    if (!found) {
      failures.push(`missing session: ${expected.startsAt.toISOString()}`);
      continue;
    }
    if (found.iso_dow !== 2) {
      failures.push(`session ${expected.id} is not a Tuesday`);
    }
    if (found.local_start !== "10:00" || found.local_end !== "14:00") {
      failures.push(`session ${expected.id} is not 10:00â€“14:00 church time`);
    }
    if (new Date(found.starts_at).getTime() !== expected.startsAt.getTime()) {
      failures.push(`session ${expected.id} does not start when expected`);
    }
  }

  return { counts, failures, ok: failures.length === 0 };
}

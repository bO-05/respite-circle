import { drizzle } from "drizzle-orm/postgres-js";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { loadEnvLocal } from "../src/db/env";
import * as schema from "../src/db/schema";
import type { SeedDb } from "../src/db/seed";
import {
  expectedSeedCounts,
  seedAccessTokens,
  seedCareRecipients,
  seedCaregivers,
  seedChurch,
  seedPeople,
  seedSessions,
  seedSessionTemplate,
  seedVolunteers,
} from "../src/db/seed-data";
import { requireDirectUrl } from "../src/db/target";

export const COUNTED_TABLES = [
  "absence_proof",
  "ask",
  "ask_revision",
  "audit_event",
  "call_log",
  "care_recipient",
  "caregiver",
  "church",
  "decision",
  "familiar_face",
  "invite",
  "notification",
  "person",
  "policy",
  "session",
  "session_template",
  "slot",
  "slot_candidate",
  "volunteer",
] as const;

export type TableCounts = Record<string, number>;

export async function readAllTableCounts(db: SeedDb): Promise<TableCounts> {
  const rows = await db.$client<{ table_name: string; row_count: number }[]>`
    SELECT 'absence_proof' AS table_name, COUNT(*)::int AS row_count FROM absence_proof
    UNION ALL SELECT 'ask', COUNT(*)::int FROM ask
    UNION ALL SELECT 'ask_revision', COUNT(*)::int FROM ask_revision
    UNION ALL SELECT 'audit_event', COUNT(*)::int FROM audit_event
    UNION ALL SELECT 'call_log', COUNT(*)::int FROM call_log
    UNION ALL SELECT 'care_recipient', COUNT(*)::int FROM care_recipient
    UNION ALL SELECT 'caregiver', COUNT(*)::int FROM caregiver
    UNION ALL SELECT 'church', COUNT(*)::int FROM church
    UNION ALL SELECT 'decision', COUNT(*)::int FROM decision
    UNION ALL SELECT 'familiar_face', COUNT(*)::int FROM familiar_face
    UNION ALL SELECT 'invite', COUNT(*)::int FROM invite
    UNION ALL SELECT 'notification', COUNT(*)::int FROM notification
    UNION ALL SELECT 'person', COUNT(*)::int FROM person
    UNION ALL SELECT 'policy', COUNT(*)::int FROM policy
    UNION ALL SELECT 'session', COUNT(*)::int FROM session
    UNION ALL SELECT 'session_template', COUNT(*)::int FROM session_template
    UNION ALL SELECT 'slot', COUNT(*)::int FROM slot
    UNION ALL SELECT 'slot_candidate', COUNT(*)::int FROM slot_candidate
    UNION ALL SELECT 'volunteer', COUNT(*)::int FROM volunteer
    ORDER BY table_name
  `;

  return Object.fromEntries(rows.map((row) => [row.table_name, row.row_count]));
}

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

  const policies = await db.$client<
    { version: number; auto_publish_low_risk: boolean }[]
  >`SELECT version, auto_publish_low_risk FROM policy ORDER BY version`;
  if (!policies.some((row) => row.version === 1)) {
    failures.push("missing policy version 1");
  }
  if (policies.some((row) => row.auto_publish_low_risk)) {
    failures.push("policy auto_publish_low_risk must be false");
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
    failures.push("missing Respite Morning template (Tuesday 10:00–14:00)");
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
      failures.push(`session ${expected.id} is not 10:00–14:00 church time`);
    }
    if (new Date(found.starts_at).getTime() !== expected.startsAt.getTime()) {
      failures.push(`session ${expected.id} does not start when expected`);
    }
  }

  return { counts, failures, ok: failures.length === 0 };
}

function printCounts(counts: TableCounts): void {
  console.log("Row counts:");
  for (const table of COUNTED_TABLES) {
    console.log(`  ${table.padEnd(18, " ")} ${counts[table] ?? 0}`);
  }
}

async function main(): Promise<void> {
  loadEnvLocal();

  const url = requireDirectUrl(
    "DATABASE_URL_UNPOOLED",
    process.env.DATABASE_URL_UNPOOLED,
  );

  const client = postgres(url, {
    max: 1,
    prepare: false,
    ssl: "require",
    onnotice: () => undefined,
  });

  try {
    const db = drizzle(client, { schema }) as SeedDb;
    const result = await verifySeed(db);
    printCounts(result.counts);

    if (!result.ok) {
      console.error("");
      console.error("Seed verification failed:");
      for (const failure of result.failures) {
        console.error(`  - ${failure}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("");
    console.log(
      `Seed verified: ${seedChurch.name}, the full fictional cast, policy version 1, and four Respite Morning sessions are present.`,
    );
  } finally {
    await client.end();
  }
}

function isDirectRun(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(entry).href === metaUrl;
}

if (isDirectRun(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

import postgres from "postgres";
import { loadEnvLocal } from "../src/db/env";
import { databaseNameFromUrl, assertE2eTarget } from "../src/db/target";
import {
  GENERATED_PROSE_MARKER,
  matchesNotificationTemplate,
  notificationTemplateFor,
  renderConfirmation,
  renderReminder,
} from "../src/server/domain/notifications";

/**
 * The outbox template match report (VAL-CONFIRM-006).
 *
 * Reads every caregiver notification and proves each body reconstructs one of
 * the church's own human templates. It also prints whether the body is exactly
 * what the template would render now from the time's own facts, so a renamed
 * person or an edited window is visible without pretending the sentence was
 * model output.
 *
 * Read-only. It never sends, writes, or repairs anything.
 *
 *   npm run outbox:verify
 *   $env:RC_DB_BRANCH='e2e'; npm run outbox:verify:e2e
 */

type OutboxRow = {
  id: string;
  kind: string;
  template_code: string;
  body: string;
  slot_kind: string;
  window_start: Date | null;
  window_end: Date | null;
  timezone: string;
  volunteer_first_name: string | null;
  recipient_first_name: string | null;
};

type RowReport = {
  id: string;
  kind: string;
  templateCode: string;
  body: string;
  known: boolean;
  shape: boolean;
  exact: boolean;
  canary: boolean;
};

function renderExpected(row: OutboxRow): string | null {
  if (!row.volunteer_first_name || !row.recipient_first_name) return null;

  const input = {
    kind: row.slot_kind,
    volunteerFirstName: row.volunteer_first_name,
    careRecipientFirstName: row.recipient_first_name,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    timeZone: row.timezone,
  };

  const rendered = row.template_code.startsWith("reminder.")
    ? renderReminder(input)
    : row.template_code.startsWith("confirmation.")
      ? renderConfirmation(input)
      : null;

  return rendered?.body ?? null;
}

async function main(): Promise<void> {
  loadEnvLocal();

  const e2e = process.argv.includes("--e2e");
  const url = e2e
    ? assertE2eTarget()
    : process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

  if (!url) {
    console.error(
      "DATABASE_URL is not set. Add the Neon connection string to .env.local.",
    );
    process.exitCode = 1;
    return;
  }

  const client = postgres(url, {
    max: 1,
    prepare: false,
    ssl: "require",
    onnotice: () => undefined,
  });

  try {
    const rows = await client<OutboxRow[]>`
      SELECT n.id,
             n.kind,
             n.template_code,
             n.body,
             s.kind AS slot_kind,
             s.window_start,
             s.window_end,
             c.timezone,
             v.first_name AS volunteer_first_name,
             r.first_name AS recipient_first_name
        FROM notification n
        JOIN slot s ON s.id = n.slot_id
        JOIN ask a ON a.id = s.ask_id
        JOIN church c ON c.id = n.church_id
        JOIN care_recipient r ON r.id = a.care_recipient_id
        LEFT JOIN person v ON v.id = s.claimed_by
       ORDER BY n.created_at, n.id
    `;

    const reports: RowReport[] = rows.map((row) => {
      const expected = renderExpected(row);
      return {
        id: row.id,
        kind: row.kind,
        templateCode: row.template_code,
        body: row.body,
        known: notificationTemplateFor(row.template_code) !== null,
        shape: matchesNotificationTemplate(row.template_code, row.body),
        exact: expected !== null && expected === row.body,
        canary: row.body.includes(GENERATED_PROSE_MARKER),
      };
    });

    console.log(
      `Outbox template match report — database "${databaseNameFromUrl(url)}"`,
    );
    console.log(`E2E target: ${e2e ? "yes" : "no"}`);
    console.log(`Rows: ${reports.length}`);

    for (const report of reports) {
      const verdict = report.shape ? "match" : "NO MATCH";
      console.log(
        `  ${report.templateCode} (${report.kind}): template=${verdict} exact=${
          report.exact ? "match" : "changed"
        } known=${report.known ? "yes" : "NO"}${report.canary ? " CANARY" : ""}`,
      );
      console.log(`    "${report.body}"`);
    }

    const unknownCodes = reports.filter((report) => !report.known).length;
    const mismatched = reports.filter((report) => !report.shape).length;
    const canaries = reports.filter((report) => report.canary).length;
    const drifted = reports.filter(
      (report) => report.shape && !report.exact,
    ).length;

    console.log(
      `Summary: ${reports.length - mismatched}/${reports.length} rows match a human template; ` +
        `${unknownCodes} unknown code(s); ${canaries} model-output marker(s); ` +
        `${drifted} exact-render difference(s).`,
    );

    if (mismatched > 0 || unknownCodes > 0 || canaries > 0) {
      console.error(
        "Outbox verification failed: every caregiver body must be a human template with no model output.",
      );
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

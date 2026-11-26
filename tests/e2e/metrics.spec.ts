import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { parseMetricsRange } from "../../src/server/domain/metrics";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-METRICS-001 through -003 on the real surface.
 *
 * A fixture church holds one November month: two asks from one family, three
 * published times, two claims, two covered times, one unclaimed time with a
 * logged call, and five coordinator actions across two requests. Grace reads
 * the page for 1–30 November 2026 and every displayed number is checked
 * against a SQL query written here, in this spec, rather than in the
 * repository under test. The coordinator-minutes card names its method and
 * cap. Nothing on the page is a percentage, a market figure, or a forecast of
 * improvement, and the pastor's read-only view carries no family name.
 *
 * The fixture is insert-only where the table is append-only (ask, ask_revision,
 * audit_event). Mutable rows (slot, call_log) are cleared and rebuilt so a
 * rerun cannot double-count.
 */

const FIXTURE_CHURCH = "d4000000-0000-4000-8000-000000000001";
const FIXTURE_COORDINATOR = "d4000000-0000-4000-8000-000000000002";
const FIXTURE_PASTOR = "d4000000-0000-4000-8000-000000000003";
const FIXTURE_CAREGIVER = "d4000000-0000-4000-8000-000000000004";
const FIXTURE_VOLUNTEER = "d4000000-0000-4000-8000-000000000005";
const FIXTURE_RECIPIENT = "d4000000-0000-4000-8000-000000000006";
const FIXTURE_POLICY = "d4000000-0000-4000-8000-000000000007";

const ASK_A = "d4000000-0000-4000-8000-000000000010";
const ASK_B = "d4000000-0000-4000-8000-000000000011";
const ASK_DRAFT = "d4000000-0000-4000-8000-000000000012";
const ASK_OUTSIDE = "d4000000-0000-4000-8000-000000000013";

const SLOT_COVERED_A = "d4000000-0000-4000-8000-000000000020";
const SLOT_COVERED_B = "d4000000-0000-4000-8000-000000000021";
const SLOT_OPEN = "d4000000-0000-4000-8000-000000000022";
const SLOT_DRAFT = "d4000000-0000-4000-8000-000000000023";
const SLOT_OUTSIDE = "d4000000-0000-4000-8000-000000000024";

const AUDIT_A1 = "d4000000-0000-4000-8000-000000000030";
const AUDIT_A2 = "d4000000-0000-4000-8000-000000000031";
const AUDIT_A3 = "d4000000-0000-4000-8000-000000000032";
const AUDIT_B1 = "d4000000-0000-4000-8000-000000000033";
const AUDIT_B2 = "d4000000-0000-4000-8000-000000000034";

const COORDINATOR_TOKEN = "e2e-metrics-coordinator";
const PASTOR_TOKEN = "e2e-metrics-pastor";

const TIME_ZONE = "America/New_York";

const RANGE = parseMetricsRange(
  { from: "2026-11-01", to: "2026-11-30" },
  { timeZone: TIME_ZONE, now: new Date("2026-12-01T15:00:00.000Z") },
);

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "audit-log",
);

async function signIn(
  browser: Browser,
  token: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.goto(`/enter/${token}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("signed-in-person")).toBeVisible();
  return { context, page };
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

async function ensureFixture(db: E2eDatabase): Promise<void> {
  await db.client`
    INSERT INTO church (id, name, timezone, demo_mode)
    VALUES (${FIXTURE_CHURCH}, 'Metrics Fellowship', ${TIME_ZONE}, false)
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO person (id, church_id, first_name, last_name, roles, access_token)
    VALUES
      (${FIXTURE_COORDINATOR}, ${FIXTURE_CHURCH}, 'Grace', 'Numbers', '["coordinator"]'::jsonb, ${COORDINATOR_TOKEN}),
      (${FIXTURE_PASTOR}, ${FIXTURE_CHURCH}, 'Ada', 'Numbers', '["pastor"]'::jsonb, ${PASTOR_TOKEN}),
      (${FIXTURE_CAREGIVER}, ${FIXTURE_CHURCH}, 'Marta', 'Numbers', '["caregiver"]'::jsonb, 'e2e-metrics-caregiver'),
      (${FIXTURE_VOLUNTEER}, ${FIXTURE_CHURCH}, 'Ruth', 'Numbers', '["volunteer"]'::jsonb, 'e2e-metrics-volunteer')
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO caregiver (person_id)
    VALUES (${FIXTURE_CAREGIVER})
    ON CONFLICT (person_id) DO NOTHING
  `;
  await db.client`
    INSERT INTO volunteer (person_id)
    VALUES (${FIXTURE_VOLUNTEER})
    ON CONFLICT (person_id) DO NOTHING
  `;
  await db.client`
    INSERT INTO care_recipient (id, church_id, first_name, relation, created_by_caregiver_id)
    VALUES (${FIXTURE_RECIPIENT}, ${FIXTURE_CHURCH}, 'June', 'Mother', ${FIXTURE_CAREGIVER})
    ON CONFLICT (id) DO NOTHING
  `;
  await db.client`
    INSERT INTO policy (
      id, church_id, version, crisis_script, signed_off_by, signed_off_at
    )
    VALUES (
      ${FIXTURE_POLICY}, ${FIXTURE_CHURCH}, 1,
      'Call the church office. In an emergency call the local crisis line.',
      'Ada Numbers', ${"2026-10-01T15:00:00.000Z"}::timestamptz
    )
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO ask (
      id, church_id, caregiver_id, care_recipient_id, verbatim_text, status,
      policy_version_id, created_at
    )
    VALUES
      (${ASK_A}, ${FIXTURE_CHURCH}, ${FIXTURE_CAREGIVER}, ${FIXTURE_RECIPIENT},
        'A November ask from the fixture family.', 'approved', ${FIXTURE_POLICY},
        ${"2026-11-05T15:00:00.000Z"}::timestamptz),
      (${ASK_B}, ${FIXTURE_CHURCH}, ${FIXTURE_CAREGIVER}, ${FIXTURE_RECIPIENT},
        'A second November ask from the same family.', 'approved', ${FIXTURE_POLICY},
        ${"2026-11-06T16:00:00.000Z"}::timestamptz),
      (${ASK_DRAFT}, ${FIXTURE_CHURCH}, ${FIXTURE_CAREGIVER}, ${FIXTURE_RECIPIENT},
        'A draft the family never sent.', 'draft', ${FIXTURE_POLICY},
        ${"2026-11-07T15:00:00.000Z"}::timestamptz),
      (${ASK_OUTSIDE}, ${FIXTURE_CHURCH}, ${FIXTURE_CAREGIVER}, ${FIXTURE_RECIPIENT},
        'An ask from October.', 'approved', ${FIXTURE_POLICY},
        ${"2026-10-20T15:00:00.000Z"}::timestamptz)
    ON CONFLICT (id) DO NOTHING
  `;

  // Mutable rows are rebuilt so a rerun sees the same month, not twice it.
  await db.client`
    DELETE FROM call_log
     WHERE slot_id IN (SELECT id FROM slot WHERE church_id = ${FIXTURE_CHURCH}::uuid)
  `;
  await db.client`
    DELETE FROM slot WHERE church_id = ${FIXTURE_CHURCH}::uuid
  `;

  await db.client`
    INSERT INTO slot (
      id, ask_id, church_id, kind, tier, label, window_start, window_end,
      status, claimed_by, claimed_at, approved_by, approved_at,
      claim_confirmed_by, claim_confirmed_at
    )
    VALUES
      (
        ${SLOT_COVERED_A}, ${ASK_A}, ${FIXTURE_CHURCH}, 'companion', 'public_event',
        'Companion place at Respite Morning',
        ${"2026-11-15T15:00:00.000Z"}::timestamptz,
        ${"2026-11-15T19:00:00.000Z"}::timestamptz,
        'covered', ${FIXTURE_VOLUNTEER}, ${"2026-11-09T15:00:00.000Z"}::timestamptz,
        ${FIXTURE_COORDINATOR}, ${"2026-11-08T15:00:00.000Z"}::timestamptz,
        ${FIXTURE_COORDINATOR}, ${"2026-11-10T15:00:00.000Z"}::timestamptz
      ),
      (
        ${SLOT_COVERED_B}, ${ASK_B}, ${FIXTURE_CHURCH}, 'meal', 'doorstep',
        'A reheatable meal',
        ${"2026-11-16T15:00:00.000Z"}::timestamptz,
        ${"2026-11-16T17:00:00.000Z"}::timestamptz,
        'covered', ${FIXTURE_VOLUNTEER}, ${"2026-11-11T15:00:00.000Z"}::timestamptz,
        ${FIXTURE_COORDINATOR}, ${"2026-11-08T16:00:00.000Z"}::timestamptz,
        ${FIXTURE_COORDINATOR}, ${"2026-11-12T15:00:00.000Z"}::timestamptz
      ),
      (
        ${SLOT_OPEN}, ${ASK_A}, ${FIXTURE_CHURCH}, 'home', 'in_home',
        'A Saturday morning at home',
        ${"2026-11-20T15:00:00.000Z"}::timestamptz,
        ${"2026-11-20T17:00:00.000Z"}::timestamptz,
        'open', NULL, NULL,
        ${FIXTURE_COORDINATOR}, ${"2026-11-08T17:00:00.000Z"}::timestamptz,
        NULL, NULL
      ),
      (
        ${SLOT_DRAFT}, ${ASK_B}, ${FIXTURE_CHURCH}, 'errand', 'doorstep',
        'An errand', ${"2026-11-21T15:00:00.000Z"}::timestamptz,
        ${"2026-11-21T17:00:00.000Z"}::timestamptz,
        'draft', NULL, NULL, NULL, NULL, NULL, NULL
      ),
      (
        ${SLOT_OUTSIDE}, ${ASK_OUTSIDE}, ${FIXTURE_CHURCH}, 'companion', 'public_event',
        'A companion place last month',
        ${"2026-10-25T14:00:00.000Z"}::timestamptz,
        ${"2026-10-25T18:00:00.000Z"}::timestamptz,
        'covered', ${FIXTURE_VOLUNTEER}, ${"2026-10-22T15:00:00.000Z"}::timestamptz,
        ${FIXTURE_COORDINATOR}, ${"2026-10-21T15:00:00.000Z"}::timestamptz,
        ${FIXTURE_COORDINATOR}, ${"2026-10-23T15:00:00.000Z"}::timestamptz
      )
  `;

  await db.client`
    INSERT INTO call_log (slot_id, coordinator_id, outcome, note, created_at)
    VALUES (
      ${SLOT_OPEN}, ${FIXTURE_COORDINATOR}, 'left_message',
      'Left a message with the family.',
      ${"2026-11-14T15:00:00.000Z"}::timestamptz
    )
  `;

  await db.client`
    INSERT INTO audit_event (
      id, church_id, actor_type, actor_id, action, entity, entity_id, detail,
      created_at
    )
    VALUES
      (${AUDIT_A1}, ${FIXTURE_CHURCH}, 'human', ${FIXTURE_COORDINATOR},
        'ask_submitted', 'ask', ${ASK_A}, '{}'::jsonb,
        ${"2026-11-05T15:00:00.000Z"}::timestamptz),
      (${AUDIT_A2}, ${FIXTURE_CHURCH}, 'human', ${FIXTURE_COORDINATOR},
        'ask_approved', 'ask', ${ASK_A}, '{}'::jsonb,
        ${"2026-11-05T15:05:00.000Z"}::timestamptz),
      (${AUDIT_A3}, ${FIXTURE_CHURCH}, 'human', ${FIXTURE_COORDINATOR},
        'draft_slot_edited', 'ask', ${ASK_A}, '{}'::jsonb,
        ${"2026-11-05T15:40:00.000Z"}::timestamptz),
      (${AUDIT_B1}, ${FIXTURE_CHURCH}, 'human', ${FIXTURE_COORDINATOR},
        'ask_submitted', 'ask', ${ASK_B}, '{}'::jsonb,
        ${"2026-11-06T15:00:00.000Z"}::timestamptz),
      (${AUDIT_B2}, ${FIXTURE_CHURCH}, 'human', ${FIXTURE_COORDINATOR},
        'ask_approved', 'ask', ${ASK_B}, '{}'::jsonb,
        ${"2026-11-06T15:04:00.000Z"}::timestamptz)
    ON CONFLICT (id) DO NOTHING
  `;
}

type CrossCheck = {
  households: number;
  asks: number;
  published: number;
  claims: number;
  covered: number;
  calls: number;
  volunteer_seconds: number;
};

/**
 * Written from the page's stated definitions, not from the repository query:
 * one row per metric, each a separate aggregate over this church's rows and
 * the stated range.
 */
async function crossCheck(
  db: E2eDatabase,
  start: Date,
  endExclusive: Date,
): Promise<CrossCheck> {
  const [row] = await db.client<CrossCheck[]>`
    SELECT
      (
        SELECT count(DISTINCT a.caregiver_id)::int
          FROM slot s
          JOIN ask a ON a.id = s.ask_id
         WHERE s.church_id = ${FIXTURE_CHURCH}::uuid
           AND s.status IN ('covered', 'done')
           AND s.window_start >= ${start.toISOString()}::timestamptz
           AND s.window_start < ${endExclusive.toISOString()}::timestamptz
      ) AS households,
      (
        SELECT count(*)::int
          FROM ask a
         WHERE a.church_id = ${FIXTURE_CHURCH}::uuid
           AND a.status <> 'draft'
           AND a.created_at >= ${start.toISOString()}::timestamptz
           AND a.created_at < ${endExclusive.toISOString()}::timestamptz
      ) AS asks,
      (
        SELECT count(*)::int
          FROM slot s
         WHERE s.church_id = ${FIXTURE_CHURCH}::uuid
           AND s.approved_at >= ${start.toISOString()}::timestamptz
           AND s.approved_at < ${endExclusive.toISOString()}::timestamptz
      ) AS published,
      (
        SELECT count(*)::int
          FROM slot s
         WHERE s.church_id = ${FIXTURE_CHURCH}::uuid
           AND s.claimed_at >= ${start.toISOString()}::timestamptz
           AND s.claimed_at < ${endExclusive.toISOString()}::timestamptz
      ) AS claims,
      (
        SELECT count(*)::int
          FROM slot s
         WHERE s.church_id = ${FIXTURE_CHURCH}::uuid
           AND s.claim_confirmed_at >= ${start.toISOString()}::timestamptz
           AND s.claim_confirmed_at < ${endExclusive.toISOString()}::timestamptz
      ) AS covered,
      (
        SELECT count(DISTINCT c.slot_id)::int
          FROM call_log c
          JOIN slot s ON s.id = c.slot_id
         WHERE s.church_id = ${FIXTURE_CHURCH}::uuid
           AND c.created_at >= ${start.toISOString()}::timestamptz
           AND c.created_at < ${endExclusive.toISOString()}::timestamptz
      ) AS calls,
      (
        SELECT COALESCE(sum(EXTRACT(EPOCH FROM (s.window_end - s.window_start))), 0)::int
          FROM slot s
         WHERE s.church_id = ${FIXTURE_CHURCH}::uuid
           AND s.status IN ('claimed', 'covered', 'done')
           AND s.window_start >= ${start.toISOString()}::timestamptz
           AND s.window_start < ${endExclusive.toISOString()}::timestamptz
      ) AS volunteer_seconds
  `;

  return row;
}

test.describe.configure({ timeout: 240_000 });

test.describe.serial("VAL-METRICS-001…003 — the church numbers", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    db = await openE2eDatabase();
    await ensureFixture(db);
  });

  test.afterAll(async () => {
    if (!db) return;
    await db.client`
      DELETE FROM call_log
       WHERE slot_id IN (SELECT id FROM slot WHERE church_id = ${FIXTURE_CHURCH}::uuid)
    `;
    await db.client`DELETE FROM slot WHERE church_id = ${FIXTURE_CHURCH}::uuid`;
    await db.client.end();
  });

  test("VAL-METRICS-001 and VAL-METRICS-002 — matches a direct SQL cross-check for the stated range", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, COORDINATOR_TOKEN);

    try {
      await page.goto("/desk/metrics?from=2026-11-01&to=2026-11-30");
      await expect(
        page.getByRole("heading", { level: 1, name: "Church numbers" }),
      ).toBeVisible();

      const range = page.getByTestId("metrics-range");
      await expect(range).toContainText("1 November 2026");
      await expect(range).toContainText("30 November 2026");
      await expect(range).toContainText(TIME_ZONE);
      await expect(range).not.toContainText("last 30 days");

      const expected = await crossCheck(db, RANGE.start, RANGE.endExclusive);

      // The independent SQL, read against the fixture by hand.
      expect(expected).toEqual({
        households: 1,
        asks: 2,
        published: 3,
        claims: 2,
        covered: 2,
        calls: 1,
        volunteer_seconds: 6 * 3600,
      });

      // And every number the page shows equals the SQL's number.
      await expect(page.getByTestId("metric-households-value")).toHaveText(
        `${expected.households} ${expected.households === 1 ? "family" : "families"}`,
      );
      await expect(page.getByTestId("metric-asks-value")).toHaveText(
        `${expected.asks} asks`,
      );
      await expect(page.getByTestId("metric-published-value")).toHaveText(
        `${expected.published} times`,
      );
      await expect(page.getByTestId("metric-claims-value")).toHaveText(
        `${expected.claims} claims`,
      );
      // VAL-R3LANG-003 — the gloss "claim" is replaced in the card title.
      await expect(page.getByTestId("metric-claims")).toContainText(
        "Times neighbours said yes",
      );
      await expect(page.getByTestId("metric-covered-value")).toHaveText(
        `${expected.covered} times`,
      );
      await expect(page.getByTestId("metric-calls-value")).toHaveText(
        `${expected.calls} call`,
      );
      await expect(
        page.getByTestId("metric-volunteer-hours-value"),
      ).toHaveText("6 hours");

      // Coordinator minutes are measured, and the card says how.
      const minutesCard = page.getByTestId("metric-coordinator-minutes");
      await expect(
        minutesCard.getByTestId("metric-coordinator-minutes-value"),
      ).toHaveText("4.5 min per request");
      await expect(minutesCard).toContainText(
        "Measured from the audit trail",
      );
      await expect(minutesCard).toContainText("20 minutes or less");
      await expect(minutesCard).toContainText(
        "2 of 2 requests had a second action close enough to measure; 9 min measured in total.",
      );
      await expect(minutesCard).not.toContainText("estimate");

      await shot(page, "metrics-stated-range");

      // A narrower range drops the October row and the later publication, and
      // the page follows.
      await page.goto("/desk/metrics?from=2026-11-09&to=2026-11-12");
      await expect(page.getByTestId("metric-asks-value")).toHaveText("0 asks");
      await expect(page.getByTestId("metric-published-value")).toHaveText(
        "0 times",
      );
      await expect(page.getByTestId("metric-claims-value")).toHaveText(
        "2 claims",
      );
      await expect(page.getByTestId("metric-covered-value")).toHaveText(
        "2 times",
      );
      await expect(page.getByTestId("metric-calls-value")).toHaveText(
        "0 calls",
      );
      await expect(
        page.getByTestId("metric-coordinator-minutes-value"),
      ).toHaveText("Not measurable yet");
    } finally {
      await context.close();
    }
  });

  test("VAL-METRICS-001 — states its default range and explains a refused range", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, COORDINATOR_TOKEN);

    try {
      await page.goto("/desk/metrics");
      await expect(page.getByTestId("metrics-range")).toContainText(
        "This is the last 30 days, ending today.",
      );

      await page.goto("/desk/metrics?from=2026-11-30&to=2026-11-01");
      await expect(page.getByTestId("metrics-range-notice")).toHaveText(
        "The start date is after the end date. Showing the last 30 days instead.",
      );
      await expect(page.getByTestId("metrics-range")).toContainText(
        "This is the last 30 days, ending today.",
      );

      await shot(page, "metrics-invalid-range");

      // A hand-edited date is refused the same calm way.
      await page.goto("/desk/metrics?from=not-a-date&to=2026-11-30");
      await expect(page.getByTestId("metrics-range-notice")).toHaveText(
        "One of those dates isn't a date we can read. Showing the last 30 days instead.",
      );
    } finally {
      await context.close();
    }
  });

  test("VAL-METRICS-003 — shows no market, percentage, or improvement claim", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, COORDINATOR_TOKEN);

    try {
      await page.goto("/desk/metrics?from=2026-11-01&to=2026-11-30");
      const text = await page.locator("body").innerText();

      expect(text).not.toMatch(/\b(TAM|SAM|ARR|ROI)\b/);
      expect(text).not.toContain("%");
      expect(text).not.toMatch(
        /percentage|market size|market share|addressable|improvement|return on investment|growth rate|projected|projection/i,
      );
      expect(text).not.toContain("Marta");
      expect(text).not.toContain("June");
      expect(text).not.toContain("Numbers family");

      // Every number carries its own definition in the same card.
      for (const id of [
        "metric-households",
        "metric-asks",
        "metric-published",
        "metric-claims",
        "metric-covered",
        "metric-calls",
        "metric-volunteer-hours",
        "metric-coordinator-minutes",
      ]) {
        const card = page.getByTestId(id);
        await expect(card.locator("dd")).toHaveCount(2);
      }
    } finally {
      await context.close();
    }
  });

  test("VAL-METRICS-001 — gives the pastor the same read-only numbers and no family names", async ({
    browser,
  }) => {
    const { context, page } = await signIn(browser, PASTOR_TOKEN);

    try {
      await page.goto("/desk/metrics?from=2026-11-01&to=2026-11-30");
      await expect(
        page.getByRole("heading", { level: 1, name: "Church numbers" }),
      ).toBeVisible();
      await expect(
        page.getByText("This is a read-only view.", { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "See who decided what in the decision log" }),
      ).toHaveCount(0);

      await expect(page.getByTestId("metric-households-value")).toHaveText(
        "1 family",
      );
      await expect(page.getByTestId("metric-asks-value")).toHaveText("2 asks");
      await expect(
        page.getByTestId("metric-coordinator-minutes-value"),
      ).toHaveText("4.5 min per request");

      const text = await page.locator("body").innerText();
      expect(text).not.toContain("Marta");
      expect(text).not.toContain("June");

      await shot(page, "metrics-pastor-read-only");
    } finally {
      await context.close();
    }
  });
});

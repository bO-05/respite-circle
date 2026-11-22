import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-AUDIT-001 through -004 on the real surface.
 *
 * A fixture church holds one AI decision, four human decisions (including one
 * whose stored detail contains a thank-you note), and one app action. Grace
 * sees three separate lists with the same five facts per row, filters by
 * entity and by person, and never sees the note's words. There is no edit or
 * delete control and no API route for an audit row; a direct UPDATE through a
 * second client is refused by the database, and the row is unchanged when the
 * page is reloaded.
 *
 * The fixture is insert-only: `ask` and `audit_event` are append-only and a
 * spec's own afterAll cannot delete them. Stable ids plus ON CONFLICT DO
 * NOTHING keep a rerun honest.
 */

const FIXTURE_CHURCH = "d3000000-0000-4000-8000-000000000001";
const FIXTURE_COORDINATOR = "d3000000-0000-4000-8000-000000000002";
const FIXTURE_CAREGIVER = "d3000000-0000-4000-8000-000000000003";
const FIXTURE_ASK = "d3000000-0000-4000-8000-000000000004";
const FIXTURE_SLOT = "d3000000-0000-4000-8000-000000000005";

const FIXTURE_COORDINATOR_TOKEN = "e2e-audit-coordinator";
const FIXTURE_CAREGIVER_TOKEN = "e2e-audit-caregiver";

const AI_EVENT = "d3000000-0000-4000-8000-000000000010";
const SUBMITTED_EVENT = "d3000000-0000-4000-8000-000000000011";
const APPROVED_EVENT = "d3000000-0000-4000-8000-000000000012";
const HELD_EVENT = "d3000000-0000-4000-8000-000000000013";
const THANKED_EVENT = "d3000000-0000-4000-8000-000000000014";
const SYSTEM_EVENT = "d3000000-0000-4000-8000-000000000015";

const TIME_ZONE = "America/New_York";

const THE_WORDS =
  "I have not had a Saturday morning to myself since March. Mum is fine with people she knows, she just cannot be alone.";

const NOTE_CANARY =
  "THANK-YOU CANARY: the soup was lovely and the visit meant a great deal.";

/** The digest the AI's row carries; a real run would compute this from input. */
const INPUT_DIGEST =
  "9f2c1d4e6a8b0c3d5e7f1a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d";

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
    INSERT INTO church (id, name, timezone)
    VALUES (${FIXTURE_CHURCH}, 'Audit Fellowship', ${TIME_ZONE})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO person (id, church_id, first_name, last_name, roles, access_token)
    VALUES
      (${FIXTURE_COORDINATOR}, ${FIXTURE_CHURCH}, 'Grace', 'Log', '["coordinator"]'::jsonb, ${FIXTURE_COORDINATOR_TOKEN}),
      (${FIXTURE_CAREGIVER}, ${FIXTURE_CHURCH}, 'Marta', 'Log', '["caregiver"]'::jsonb, ${FIXTURE_CAREGIVER_TOKEN})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO audit_event (
      id, church_id, actor_type, actor_id, action, entity, entity_id, detail,
      created_at
    )
    VALUES
      (
        ${AI_EVENT}, ${FIXTURE_CHURCH}, 'ai', ${FIXTURE_CAREGIVER},
        'ai_decision', 'ask', ${FIXTURE_ASK},
        ${JSON.stringify({
          inputDigest: INPUT_DIGEST,
          provider: "mistral",
          model: "mistral-small-latest",
          latencyMs: 812,
          questionCount: 9,
          abstainedCount: 1,
        })}::jsonb,
        ${"2026-11-20T15:00:00.000Z"}::timestamptz
      ),
      (
        ${SUBMITTED_EVENT}, ${FIXTURE_CHURCH}, 'human', ${FIXTURE_CAREGIVER},
        'ask_submitted', 'ask', ${FIXTURE_ASK},
        ${JSON.stringify({
          digest: "a".repeat(64),
          characterCount: THE_WORDS.length,
        })}::jsonb,
        ${"2026-11-20T14:50:00.000Z"}::timestamptz
      ),
      (
        ${APPROVED_EVENT}, ${FIXTURE_CHURCH}, 'human', ${FIXTURE_COORDINATOR},
        'ask_approved', 'ask', ${FIXTURE_ASK},
        ${JSON.stringify({ publishedCount: 2, heldCount: 0 })}::jsonb,
        ${"2026-11-20T15:10:00.000Z"}::timestamptz
      ),
      (
        ${HELD_EVENT}, ${FIXTURE_CHURCH}, 'human', ${FIXTURE_COORDINATOR},
        'draft_slot_held', 'slot', ${FIXTURE_SLOT},
        ${JSON.stringify({ reason: "needs_a_familiar_face" })}::jsonb,
        ${"2026-11-20T15:05:00.000Z"}::timestamptz
      ),
      (
        ${THANKED_EVENT}, ${FIXTURE_CHURCH}, 'human', ${FIXTURE_COORDINATOR},
        'slot_thanked', 'slot', ${FIXTURE_SLOT},
        ${JSON.stringify({ note: NOTE_CANARY, kind: "companion" })}::jsonb,
        ${"2026-11-20T16:00:00.000Z"}::timestamptz
      ),
      (
        ${SYSTEM_EVENT}, ${FIXTURE_CHURCH}, 'system', NULL,
        'slots_proposed', 'ask', ${FIXTURE_ASK},
        ${JSON.stringify({ count: 2, kinds: ["companion", "home"] })}::jsonb,
        ${"2026-11-20T14:55:00.000Z"}::timestamptz
      )
    ON CONFLICT (id) DO NOTHING
  `;
}

async function countEvents(db: E2eDatabase): Promise<number> {
  const [row] = await db.client<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM audit_event
     WHERE church_id = ${FIXTURE_CHURCH}::uuid
  `;
  return row.n;
}

test.describe.configure({ timeout: 240_000 });

test.describe.serial("the decision log", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    db = await openE2eDatabase();
    await ensureFixture(db);
  });

  test.afterAll(async () => {
    if (db) await db.client.end();
  });

  test("separates AI, human, and app decisions and shows all five facts", async ({
    browser,
  }) => {
    const { context, page } = await signIn(
      browser,
      FIXTURE_COORDINATOR_TOKEN,
    );

    try {
      await page.goto("/desk/audit");
      await expect(
        page.getByRole("heading", { level: 1, name: "Decision log" }),
      ).toBeVisible();

      const aiSection = page.getByTestId("audit-section-ai");
      const humanSection = page.getByTestId("audit-section-human");
      const systemSection = page.getByTestId("audit-section-system");

      await expect(aiSection).toBeVisible();
      await expect(humanSection).toBeVisible();
      await expect(systemSection).toBeVisible();

      // One AI row, four human rows, one app row — and never mixed.
      await expect(
        aiSection.locator('[data-testid="audit-row"][data-actor-type="ai"]'),
      ).toHaveCount(1);
      await expect(
        humanSection.locator('[data-testid="audit-row"][data-actor-type="human"]'),
      ).toHaveCount(4);
      await expect(
        systemSection.locator(
          '[data-testid="audit-row"][data-actor-type="system"]',
        ),
      ).toHaveCount(1);
      await expect(
        page.locator('[data-testid="audit-row"][data-actor-type="ai"]'),
      ).toHaveCount(1);

      const aiRow = aiSection.getByTestId("audit-row").first();
      await expect(aiRow.getByTestId("audit-actor")).toHaveText("The AI");
      await expect(aiRow.getByTestId("audit-action")).toHaveText(
        "Answered the nine typed questions",
      );
      await expect(aiRow.getByTestId("audit-entity")).toContainText("Ask");
      await expect(aiRow.getByTestId("audit-detail")).toContainText(
        "Input digest",
      );
      await expect(aiRow.getByTestId("audit-detail")).toContainText("sha256:");
      await expect(aiRow.getByTestId("audit-time")).toContainText(
        "20 November 2026",
      );

      // The five facts, in the same order, on every row.
      for (const section of [aiSection, humanSection, systemSection]) {
        const first = section.getByTestId("audit-row").first();
        await expect(first.locator("dt")).toHaveText([
          "Decided by",
          "What happened",
          "About",
          "Detail",
          "When",
        ]);
      }

      // The human list names the person and their role.
      await expect(
        humanSection.getByTestId("audit-actor").filter({ hasText: "Grace Log" }),
      ).toHaveCount(3);
      await expect(
        humanSection
          .getByTestId("audit-actor")
          .filter({ hasText: "Marta Log" }),
      ).toHaveCount(1);
      await expect(
        humanSection.getByTestId("audit-actor").filter({
          hasText: "Grace Log · Coordinator",
        }),
      ).toHaveCount(3);

      // The stored thank-you note is never rendered.
      const html = await page.content();
      expect(html).not.toContain(NOTE_CANARY);
      expect(html).not.toContain(THE_WORDS);
      expect(html).not.toMatch(/soup was lovely/i);

      // No edit, delete, or other row action exists.
      await expect(
        page.getByRole("button", { name: /edit|delete|remove|change|undo/i }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: /edit|delete|remove|change|undo/i }),
      ).toHaveCount(0);
      await expect(page.locator('[data-testid="audit-row"] button')).toHaveCount(
        0,
      );
      await expect(page.locator('[data-testid="audit-row"] input')).toHaveCount(
        0,
      );

      // The one form in the page body is the GET filter, not a mutation.
      const filterForm = page.getByTestId("audit-filter-form");
      await expect(filterForm).toHaveAttribute("method", "get");
      await expect(page.locator("main form")).toHaveCount(1);

      await shot(page, "audit-three-lists");
    } finally {
      await context.close();
    }
  });

  test("filters by entity and by actor, and says when nothing matches", async ({
    browser,
  }) => {
    const { context, page } = await signIn(
      browser,
      FIXTURE_COORDINATOR_TOKEN,
    );

    try {
      await page.goto("/desk/audit");

      await page.getByLabel("What it was about").selectOption("slot");
      await page.getByRole("button", { name: "Show these actions" }).click();
      await expect(page).toHaveURL(/entity=slot/);

      const humanSection = page.getByTestId("audit-section-human");
      await expect(
        humanSection.locator('[data-testid="audit-row"][data-actor-type="human"]'),
      ).toHaveCount(2);
      await expect(
        page.getByTestId("audit-section-ai").getByTestId("audit-row"),
      ).toHaveCount(0);
      await expect(
        page.getByTestId("audit-section-system").getByTestId("audit-row"),
      ).toHaveCount(0);
      await expect(page.getByTestId("audit-section-ai")).toContainText(
        "No AI decision matches these filters.",
      );
      await expect(page.getByTestId("audit-count")).toContainText(
        "2 actions in this view",
      );

      await shot(page, "audit-filter-entity-slot");

      // Filter by the caregiver: exactly one human action.
      await page.goto("/desk/audit");
      await page
        .getByLabel("Who decided")
        .selectOption(`person:${FIXTURE_CAREGIVER}`);
      await page.getByRole("button", { name: "Show these actions" }).click();
      await expect(page).toHaveURL(/actor=person%3A/);

      await expect(
        humanSection.locator('[data-testid="audit-row"][data-actor-type="human"]'),
      ).toHaveCount(1);
      await expect(humanSection.getByTestId("audit-action")).toHaveText(
        "Sent an ask",
      );
      await expect(page.getByTestId("audit-count")).toContainText(
        "1 action in this view",
      );

      await shot(page, "audit-filter-actor-marta");

      // A hand-edited entity that is not one of ours is ignored, with a calm
      // sentence, and the whole log is shown again.
      await page.goto("/desk/audit?entity=not%20a%20kind");
      await expect(page.getByTestId("audit-filter-notice")).toContainText(
        "showing every kind",
      );
      await expect(page.getByTestId("audit-count")).toContainText(
        "6 actions in this view",
      );
    } finally {
      await context.close();
    }
  });

  test("refuses a direct update and leaves the row as it was", async ({
    browser,
  }) => {
    const { context, page } = await signIn(
      browser,
      FIXTURE_COORDINATOR_TOKEN,
    );

    try {
      await page.goto("/desk/audit");

      const before = await countEvents(db);

      let rejected = false;
      let databaseMessage = "";
      try {
        await db.client`
          UPDATE audit_event
             SET action = 'rewritten_by_a_test'
           WHERE id = ${AI_EVENT}::uuid
        `;
      } catch (error) {
        rejected = true;
        databaseMessage =
          error instanceof Error ? error.message : String(error);
      }

      expect(rejected).toBe(true);
      expect(databaseMessage).toMatch(/append-only table: audit_event/i);

      let deleteRejected = false;
      try {
        await db.client`DELETE FROM audit_event WHERE id = ${AI_EVENT}::uuid`;
      } catch (error) {
        deleteRejected = true;
        expect(String(error)).toMatch(/append-only table: audit_event/i);
      }
      expect(deleteRejected).toBe(true);

      expect(await countEvents(db)).toBe(before);

      // The page still reads the original action, not the attempted one.
      await page.reload();
      await expect(
        page
          .getByTestId("audit-section-ai")
          .getByTestId("audit-action")
          .first(),
      ).toHaveText("Answered the nine typed questions");

      // There is no API surface for an audit row at all.
      expect(
        existsSync(path.join(process.cwd(), "src", "app", "api", "audit")),
      ).toBe(false);
    } finally {
      await context.close();
    }
  });

  test("refuses a caregiver before the log is read", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(`/enter/${FIXTURE_CAREGIVER_TOKEN}`);
      await expect(page.getByTestId("signed-in-person")).toBeVisible();

      const response = await page.goto("/desk/audit");
      expect(response?.status()).toBe(403);
      await expect(
        page.getByRole("heading", { level: 1, name: "Decision log" }),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  seedCrisisScript,
  seedLocalCrisisLine,
  seedQuestionSet,
  seedReferralResources,
  seedSafeguardingPromises,
} from "../../src/db/seed-data";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-ACCESS-006 and VAL-POLICY-006 on the real surface.
 *
 * A deputy runs this church's desk while the coordinator is away. The deputy
 * carries the banner that says so, switches the low-risk auto-publish setting
 * on through the real policy editor, and the decision log records the deputy's
 * name and the version they signed. A meal ask then publishes itself without
 * waiting for a person, is labelled on the board and on the desk, appears in
 * the decision log with the version it followed, and sends the caregiver
 * nothing. A sitting ask, which proposes a home visit, is never published this
 * way. The deputy approves the meal ask with the same authority a coordinator
 * has, and that approval is recorded under the deputy's name.
 *
 * The church is a fixture. The seeded church is left untouched because the
 * policy is append-only and later specs read its switch as off.
 */

const FIXTURE_CHURCH = "d5000000-0000-4000-8000-000000000001";
const FIXTURE_POLICY = "d5000000-0000-4000-8000-000000000002";
const FIXTURE_COORDINATOR = "d5000000-0000-4000-8000-000000000003";
const FIXTURE_DEPUTY = "d5000000-0000-4000-8000-000000000004";
const FIXTURE_CAREGIVER = "d5000000-0000-4000-8000-000000000005";
const FIXTURE_RECIPIENT = "d5000000-0000-4000-8000-000000000006";

const COORDINATOR_TOKEN = "e2e-auto-coordinator";
const DEPUTY_TOKEN = "e2e-auto-deputy";
const CAREGIVER_TOKEN = "e2e-auto-caregiver";

const TIME_ZONE = "America/New_York";

/**
 * A meal, and nothing else: no sitting words, no safety words, no personal
 * care. The rules engine maps it to Q3 yes and a weekday evening window.
 */
const MEAL_ASK =
  "Could someone bring a hot dish on a weekday evening? Mum likes soup and a reheatable meal, and she is happy with anyone.";

/**
 * A sitting ask: Q1 yes and Q6 yes, so plain code proposes a home visit, which
 * the switch must refuse.
 */
const SITTING_ASK =
  "I haven't had a morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "deputy-auto-publish",
);

type PolicyRow = {
  id: string;
  version: number;
  auto_publish_low_risk: boolean;
  signed_off_by: string | null;
};

type SlotRow = {
  id: string;
  ask_id: string;
  kind: string;
  status: string;
  published_via: string;
  approved_by: string | null;
  approved_at: Date | null;
};

type AuditRow = {
  action: string;
  actor_type: string;
  actor_id: string | null;
  entity: string;
  entity_id: string | null;
  detail: Record<string, unknown>;
};

type AskRow = {
  id: string;
  status: string;
  approved_by: string | null;
  policy_version_id: string;
};

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
    VALUES (${FIXTURE_CHURCH}, 'Low Road Chapel', ${TIME_ZONE})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO person (id, church_id, first_name, last_name, roles, access_token)
    VALUES
      (${FIXTURE_COORDINATOR}, ${FIXTURE_CHURCH}, 'Ada', 'Low', '["coordinator"]'::jsonb, ${COORDINATOR_TOKEN}),
      (${FIXTURE_DEPUTY}, ${FIXTURE_CHURCH}, 'Eli', 'Low', '["deputy"]'::jsonb, ${DEPUTY_TOKEN}),
      (${FIXTURE_CAREGIVER}, ${FIXTURE_CHURCH}, 'Marta', 'Low', '["caregiver"]'::jsonb, ${CAREGIVER_TOKEN})
    ON CONFLICT (id) DO NOTHING
  `;

  await db.client`
    INSERT INTO caregiver (person_id) VALUES (${FIXTURE_CAREGIVER})
    ON CONFLICT (person_id) DO NOTHING
  `;

  await db.client`
    INSERT INTO care_recipient (id, church_id, first_name, relation, created_by_caregiver_id)
    VALUES (${FIXTURE_RECIPIENT}, ${FIXTURE_CHURCH}, 'June', 'mother', ${FIXTURE_CAREGIVER})
    ON CONFLICT (id) DO NOTHING
  `;

  // The fixture starts with the switch off, signed by the coordinator, so the
  // deputy's edit is the only thing that turns it on in this run.
  await db.client`
    INSERT INTO policy (
      id, church_id, version, safeguarding_promises, question_set,
      crisis_script, local_crisis_line, referral_resources,
      familiar_face_default, reminder_window_hours, call_threshold_hours,
      call_after_open_hours, transport_enabled, auto_publish_low_risk,
      signed_off_by, signed_off_at
    )
    VALUES (
      ${FIXTURE_POLICY}, ${FIXTURE_CHURCH}, 1,
      ${JSON.stringify(seedSafeguardingPromises)}::jsonb,
      ${JSON.stringify(seedQuestionSet)}::jsonb,
      ${seedCrisisScript}, ${seedLocalCrisisLine},
      ${JSON.stringify(seedReferralResources)}::jsonb,
      true, 24, 48, 24, false, false,
      'Ada Low', ${"2026-10-01T15:00:00.000Z"}::timestamptz
    )
    ON CONFLICT (id) DO NOTHING
  `;
}

async function currentPolicy(db: E2eDatabase): Promise<PolicyRow> {
  const rows = await db.client<PolicyRow[]>`
    SELECT id, version, auto_publish_low_risk, signed_off_by
      FROM policy
     WHERE church_id = ${FIXTURE_CHURCH}::uuid
       AND signed_off_by IS NOT NULL
     ORDER BY version DESC
     LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new Error("the fixture policy is missing");
  return row;
}

async function slotsFor(db: E2eDatabase, askId: string): Promise<SlotRow[]> {
  return db.client<SlotRow[]>`
    SELECT id, ask_id, kind, status, published_via, approved_by, approved_at
      FROM slot
     WHERE ask_id = ${askId}
     ORDER BY kind, id
  `;
}

async function auditRows(
  db: E2eDatabase,
  action: string,
): Promise<AuditRow[]> {
  return db.client<AuditRow[]>`
    SELECT action, actor_type, actor_id, entity, entity_id, detail
      FROM audit_event
     WHERE church_id = ${FIXTURE_CHURCH}::uuid
       AND action = ${action}
     ORDER BY created_at, id
  `;
}

async function askRow(db: E2eDatabase, askId: string): Promise<AskRow> {
  const rows = await db.client<AskRow[]>`
    SELECT id, status, approved_by, policy_version_id
      FROM ask
     WHERE id = ${askId}
  `;
  const row = rows[0];
  if (!row) throw new Error(`ask ${askId} is missing`);
  return row;
}

async function notificationCount(
  db: E2eDatabase,
  slotId: string,
): Promise<number> {
  const rows = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
      FROM notification
     WHERE slot_id = ${slotId}::uuid
  `;
  return rows[0]?.count ?? 0;
}

async function createAsk(
  context: BrowserContext,
  text: string,
): Promise<string> {
  const response = await context.request.post("/api/asks", {
    data: { text: `${text}\n\n(Run ${Date.now()}.)`, consent: true },
    timeout: 45_000,
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { askId: string };
  return body.askId;
}

async function saveSwitch(
  page: Page,
  on: boolean,
  signer = "Eli Low",
): Promise<void> {
  const toggle = page.getByLabel(
    /publish a meal automatically/i,
  );
  if (on) {
    await toggle.check();
  } else {
    await toggle.uncheck();
  }
  await page
    .getByLabel(/your name, as the sign-off for this version/i)
    .fill(signer);
  await page.getByTestId("policy-save").click();
  await expect(page.getByTestId("policy-feedback")).toBeVisible();
  await expect(page.getByTestId("policy-feedback")).toHaveAttribute(
    "role",
    "status",
  );
}

test.describe.configure({ timeout: 240_000 });

test("a deputy carries the desk, the switch is audited, and only a meal publishes itself", async ({
  browser,
}) => {
  const db = await openE2eDatabase();

  try {
    await ensureFixture(db);

    const deputy = await signIn(browser, DEPUTY_TOKEN);
    const page = deputy.page;

    // 1. The banner is on every desk surface the deputy opens.
    await page.goto("/desk");
    const banner = page.getByTestId("deputy-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/coordinator is on a break too/i);
    await expect(banner).toContainText(/Eli/);
    await expect(banner).toContainText(/recorded under your name/i);
    await shot(page, "01-deputy-banner");

    await page.goto("/desk/policy");
    await expect(page.getByTestId("deputy-banner")).toBeVisible();
    const toggle = page.getByLabel(
      /publish a meal automatically/i,
    );
    await expect(toggle).toBeVisible();
    await expect(page.getByTestId("policy-auto-publish-help")).toContainText(
      /only a meal can publish/i,
    );
    await expect(page.getByTestId("policy-auto-publish-help")).toContainText(
      /errands are not available yet/i,
    );
    await expect(page.getByTestId("policy-auto-publish-help")).toContainText(
      /companion|drive|home/i,
    );
    await expect(page.getByTestId("policy-auto-publish-state")).toContainText(
      /saving creates version/i,
    );

    // A retry can leave the switch on. Put it back to off first so this run
    // still proves the transition the audit names.
    if ((await currentPolicy(db)).auto_publish_low_risk) {
      await saveSwitch(page, false);
      await page.reload();
      await expect(toggle).not.toBeChecked();
    }

    // 2. The deputy turns the switch on under a named sign-off.
    await saveSwitch(page, true);
    await expect(page.getByTestId("policy-feedback")).toContainText(
      /version/i,
    );
    await page.reload();
    await expect(toggle).toBeChecked();
    await expect(page.getByTestId("policy-auto-publish-state")).toContainText(
      /this version is on/i,
    );
    await shot(page, "02-policy-switch-on");

    const signed = await currentPolicy(db);
    expect(signed.auto_publish_low_risk).toBe(true);
    expect(signed.signed_off_by).toBe("Eli Low");
    expect(signed.version).toBeGreaterThanOrEqual(2);

    const changes = await auditRows(db, "policy_auto_publish_changed");
    const turnedOn = changes.filter(
      (row) =>
        row.detail.from === false && row.detail.to === true,
    );
    expect(turnedOn.length).toBeGreaterThanOrEqual(1);
    const latestChange = turnedOn.at(-1);
    expect(latestChange?.actor_type).toBe("human");
    expect(latestChange?.actor_id).toBe(FIXTURE_DEPUTY);
    expect(latestChange?.entity).toBe("policy");
    expect(latestChange?.entity_id).toBe(signed.id);
    expect(latestChange?.detail.version).toBe(signed.version);
    expect(latestChange?.detail.authorName).toBe("Eli Low");

    // The caregiver's own pages speak the same exception. The words are still
    // never shown; a meal time may reach the congregation board before a
    // person approves it. With the switch off these sentences are unchanged,
    // which the seeded-church ask spec pins separately.
    const caregiver = await signIn(browser, CAREGIVER_TOKEN);
    await caregiver.page.goto("/ask");
    const consentLabel = caregiver.page.locator("label[for='ask-consent']");
    await expect(consentLabel).toContainText(/Ada reads this\./);
    await expect(consentLabel).toContainText(
      /my words are never shown to anyone/i,
    );
    await expect(consentLabel).toContainText(
      /meal time from this ask may go on the congregation board/i,
    );
    await expect(consentLabel).toContainText(/before she approves that time/i);
    const consentHelp = caregiver.page.locator("#ask-consent-help");
    await expect(consentHelp).toContainText(/Ada reads every ask\./);
    await expect(consentHelp).toContainText(
      /your words are never shown to anyone/i,
    );
    await expect(consentHelp).toContainText(/congregation board/i);
    await expect(
      caregiver.page.getByText(/Ada reads what you write/i).first(),
    ).toBeVisible();
    await shot(caregiver.page, "02b-caregiver-qualified-consent");

    // 3. A meal ask arrives while the switch is on.
    const mealAskId = await createAsk(caregiver.context, MEAL_ASK);

    const mealAsk = await askRow(db, mealAskId);
    expect(mealAsk.policy_version_id).toBe(signed.id);

    // The receipt for this ask carries the same qualification, read from the
    // policy version stored on the ask rather than the current page state.
    await caregiver.page.goto(`/ask/${mealAskId}`);
    await expect(
      caregiver.page.getByText(/Ada reads every ask\./).first(),
    ).toBeVisible();
    await expect(
      caregiver.page.getByText(/your words are never shown to anyone/i).first(),
    ).toBeVisible();
    await expect(
      caregiver.page.getByText(/may go on the congregation board/i).first(),
    ).toBeVisible();
    await shot(caregiver.page, "02c-caregiver-qualified-receipt");

    const mealSlots = await slotsFor(db, mealAskId);
    expect(mealSlots.map((row) => row.kind)).toEqual(["meal"]);
    const mealSlot = mealSlots[0];
    expect(mealSlot.status).toBe("open");
    expect(mealSlot.published_via).toBe("auto_low_risk");
    expect(mealSlot.approved_by).toBeNull();
    expect(mealSlot.approved_at).not.toBeNull();

    const published = (await auditRows(db, "slot_auto_published")).filter(
      (row) => row.entity_id === mealSlot.id,
    );
    expect(published).toHaveLength(1);
    expect(published[0].actor_type).toBe("system");
    expect(published[0].entity).toBe("slot");
    expect(published[0].detail).toMatchObject({
      askId: mealAskId,
      kinds: ["meal"],
      version: signed.version,
      policyVersionId: signed.id,
    });

    // The switch wrote no message to the caregiver. Only a person who later
    // approves the ask can do that.
    expect(await notificationCount(db, mealSlot.id)).toBe(0);

    // 4. The board shows the time with the switch's label, not a person's.
    await page.goto("/circle");
    await expect(page.getByTestId("deputy-banner")).toBeVisible();
    const card = page.locator(
      `[data-testid="board-slot"][data-slot-id="${mealSlot.id}"]`,
    );
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-kind", "meal");
    await expect(card.getByTestId("board-auto-published")).toBeVisible();
    await expect(card.getByTestId("board-auto-published")).toContainText(
      /a meal only/i,
    );
    await expect(card.getByTestId("board-approval-line")).toHaveCount(0);
    await shot(page, "03-board-auto-published");

    // 5. The desk says the same thing, and the ask still waits for a person.
    await page.goto(`/desk/ask/${mealAskId}`);
    await expect(page.getByTestId("deputy-banner")).toBeVisible();
    await expect(
      page.getByTestId("ask-review-auto-publish"),
    ).toBeVisible();
    await expect(page.getByTestId("waiting-published")).toBeVisible();
    const publishedLabel = page.getByTestId("published-auto-label");
    await expect(publishedLabel).toBeVisible();
    await expect(publishedLabel).toContainText(/a meal only|auto-published/i);
    await expect(page.getByTestId("published-approval-line")).toHaveCount(0);
    await shot(page, "04-desk-auto-published");

    // 6. The deputy approves the ask with the same authority, named.
    await page.getByTestId("approve-ask").click();
    await expect(
      page.locator('[data-testid="ask-review"][data-status="approved"]'),
    ).toBeVisible();
    await expect(page.getByTestId("ask-approval-line")).toContainText(/Eli/);
    // The published list keeps the switch's label; the ask's approval line
    // names the deputy and never stands in for the time's own approver.
    await expect(page.getByTestId("published-auto-label")).toBeVisible();
    await expect(page.getByTestId("published-approval-line")).toHaveCount(0);

    const approvedAsk = await askRow(db, mealAskId);
    expect(approvedAsk.status).toBe("approved");
    expect(approvedAsk.approved_by).toBe(FIXTURE_DEPUTY);
    // A person approving the ask still sends the family nothing; only a
    // confirmed claim writes a message.
    expect(await notificationCount(db, mealSlot.id)).toBe(0);
    const approvals = await auditRows(db, "ask_approved");
    expect(approvals.at(-1)?.actor_id).toBe(FIXTURE_DEPUTY);
    expect(approvals.at(-1)?.entity_id).toBe(mealAskId);

    // The times' own review page names the switch, never a person who did not
    // approve it.
    await page.getByTestId("published-slot-link").click();
    await page.waitForURL(new RegExp(`/desk/slot/${mealSlot.id}$`));
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: /published by the low-risk switch/i,
      }),
    ).toBeVisible();
    await expect(page.getByTestId("slot-publication-line")).toContainText(
      /auto-published/i,
    );
    await expect(page.getByTestId("slot-publication-line")).not.toContainText(
      /Approved —/,
    );
    await shot(page, "05b-desk-slot-auto-published");

    // 7. The decision log carries both the switch and the publication, and
    // names the deputy for the human decisions.
    await page.goto("/desk/audit");
    const publishedRow = page
      .locator('[data-testid="audit-row"][data-action="slot_auto_published"]')
      .first();
    await expect(publishedRow).toBeVisible();
    await expect(publishedRow.getByTestId("audit-action")).toHaveText(
      /Published a time automatically/i,
    );
    await expect(publishedRow.getByTestId("audit-actor")).toHaveText(
      /The app/i,
    );
    await expect(publishedRow.getByTestId("audit-detail")).toContainText(
      new RegExp(`policy version:\\s*${signed.version}`, "i"),
    );

    const switchRow = page
      .locator(
        '[data-testid="audit-row"][data-action="policy_auto_publish_changed"]',
      )
      .first();
    await expect(switchRow).toBeVisible();
    await expect(switchRow.getByTestId("audit-action")).toHaveText(
      /Changed the low-risk auto-publish switch/i,
    );
    await expect(switchRow.getByTestId("audit-actor")).toHaveText(
      /Eli Low/,
    );
    await expect(switchRow.getByTestId("audit-actor")).toHaveText(
      /Deputy coordinator/,
    );

    const approvedRow = page
      .locator('[data-testid="audit-row"][data-action="ask_approved"]')
      .first();
    await expect(approvedRow.getByTestId("audit-actor")).toHaveText(
      /Eli Low/,
    );
    await shot(page, "05-decision-log");

    // 8. A sitting ask proposes a home visit, and the switch refuses it.
    const sittingAskId = await createAsk(caregiver.context, SITTING_ASK);
    await caregiver.context.close();

    const sittingSlots = await slotsFor(db, sittingAskId);
    expect(sittingSlots.map((row) => row.kind)).toContain("home");
    for (const row of sittingSlots) {
      expect(row.published_via).toBe("coordinator");
      expect(row.status).toBe("draft");
      expect(row.approved_by).toBeNull();
    }

    const refusals = (await auditRows(db, "slot_auto_publish_refused")).filter(
      (row) => row.entity_id === sittingAskId,
    );
    expect(refusals).toHaveLength(1);
    expect(refusals[0].actor_type).toBe("system");
    expect(refusals[0].detail.reason).toBe("kind_not_low_risk");
    expect(refusals[0].detail.kinds).toContain("home");

    await page.goto(`/desk/ask/${sittingAskId}`);
    await expect(page.getByTestId("ask-review-auto-publish")).toBeVisible();
    await expect(page.getByTestId("published-auto-label")).toHaveCount(0);
    await expect(page.getByTestId("waiting-published")).toHaveCount(0);
    await shot(page, "06-home-visit-refused");

    // 9. The coordinator is not on a break, so no banner for them.
    const coordinator = await signIn(browser, COORDINATOR_TOKEN);
    await coordinator.page.goto("/desk");
    await expect(coordinator.page.getByTestId("deputy-banner")).toHaveCount(0);
    await expect(
      coordinator.page.getByRole("heading", { level: 1 }),
    ).toBeVisible();
    await shot(coordinator.page, "07-coordinator-no-banner");
    await coordinator.context.close();

    // 10. The trust pages describe the switch they now share the app with,
    // including its limit, its signed-policy precondition, and its audit trail.
    await page.goto("/how-it-works");
    const note = page.getByTestId("auto-publish-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText(/one low-risk kind: a meal/i);
    await expect(note).toContainText(/errands are not available yet/i);
    await expect(note).toContainText(/signed policy version/i);
    await expect(note).toContainText(/decision log/i);
    const whoDecides = page.getByRole("table", { name: /who decides what/i });
    const publishRow = whoDecides.getByRole("row", {
      name: /publishes a time to the board/i,
    });
    await expect(publishRow).toContainText(/only a meal/i);
    await expect(publishRow).toContainText(/errands are not available yet/i);
    await expect(publishRow).toContainText(/low-risk switch/i);
    await shot(page, "08-how-it-works");

    await page.goto("/never");
    const neverNote = page.getByTestId("never-auto-publish");
    await expect(neverNote).toBeVisible();
    await expect(neverNote).toContainText(/one low-risk kind: a meal/i);
    await expect(neverNote).toContainText(/errands are not available yet/i);
    await expect(neverNote).toContainText(/companion place, a drive, and an in-home visit/i);
    await expect(neverNote).toContainText(/decision log/i);
    await shot(page, "09-never");

    await deputy.context.close();
  } finally {
    await db.client.end();
  }
});

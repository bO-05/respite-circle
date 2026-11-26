import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { seedAccessTokens, seedIds } from "../../src/db/seed-data";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-DESK-003, VAL-DESK-006, and VAL-DESK-007 on the real surface.
 *
 * The editor is read and written through the real server and the real
 * database: plain code proposes the companion and gated home drafts for the
 * hero ask from its nine typed answers; a coordinator edits kind, label,
 * window, gated flag, and orientation note, adds and removes drafts, and holds
 * one with a reason that blocks publication; a drive stays absent until the
 * church signs its volunteer-driver policy; a meal carries the reheat
 * preference and no clinical detail; and no draft appears on the board or in a
 * caregiver's or volunteer's page before approval.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.\n\nShe loves hymns and tea, and she naps after lunch.";

// Q2 yes (lift to an appointment), and nothing else: no sitting need, no
// meal, no familiar-face signal, no safety or personal-care flag.
const DRIVE_ASK =
  "She needs a lift to her appointment on Saturday. I am at work all day and cannot take her.";

// Q3 yes, Q7 reheats, and no clinical detail anywhere in the ask.
const MEAL_ASK =
  "Could someone bring a meal on Saturday? She can reheat it later. Nothing else is needed.";

const SAFETY_ASK =
  "She fell last week and I am scared she will wander out of the house.";

const CARE_ASK = "I need help with bathing and remembering her medication.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "draft-slots",
);

type DraftRow = {
  id: string;
  kind: string;
  tier: string;
  label: string;
  status: string;
  rule_ref: string;
  gated: boolean;
  hold_reason: string | null;
  held_by: string | null;
  window_start: Date | null;
  window_end: Date | null;
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

async function createAsk(
  context: BrowserContext,
  text: string,
): Promise<string> {
  const response = await context.request.post("/api/asks", {
    data: { text, consent: true },
    // The first write after a cold Neon compute can take longer than
    // Playwright's 10 s default; the documented wake is 5.4–5.6 s.
    timeout: 45_000,
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { askId: string };
  return body.askId;
}

async function draftsFor(db: E2eDatabase, askId: string): Promise<DraftRow[]> {
  return db.client<DraftRow[]>`
    SELECT id, kind, tier, label, status, rule_ref, gated, hold_reason,
           held_by, window_start, window_end
      FROM slot
     WHERE ask_id = ${askId}
     ORDER BY kind
  `;
}

async function askStatus(db: E2eDatabase, askId: string): Promise<string> {
  const [row] = await db.client<{ status: string }[]>`
    SELECT status FROM ask WHERE id = ${askId}
  `;
  return row.status;
}

async function openDeskAsk(page: Page, askId: string): Promise<void> {
  const response = await page.goto(`/desk/ask/${askId}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("draft-editor")).toBeVisible();
}

function card(page: Page, slotId: string): Locator {
  return page.locator(`[data-testid="draft-slot"][data-slot-id="${slotId}"]`);
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

test.describe.configure({ timeout: 120_000 });

test.describe("VAL-DESK-003, VAL-DESK-006, VAL-DESK-007 and VAL-AUDITFIX-003 — draft slot editor", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    await db.client.end();
  });

  test("VAL-DESK-007 — builds the hero ask's companion and gated home drafts, each with its rule", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    const askId = await createAsk(marta.context, HERO_ASK);
    await marta.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    await openDeskAsk(grace.page, askId);

    await expect(
      grace.page.getByRole("heading", { name: "Times plain code proposes" }),
    ).toBeVisible();
    await expect(grace.page.getByTestId("draft-not-published")).toContainText(
      "cannot see any of them",
    );

    const cards = grace.page.getByTestId("draft-slot");
    await expect(cards).toHaveCount(2);

    const companion = grace.page.locator(
      '[data-testid="draft-slot"][data-kind="companion"]',
    );
    await expect(companion.getByTestId("draft-label")).toHaveValue(
      "Companion place at Respite Morning",
    );
    await expect(companion.getByTestId("draft-window")).toContainText(
      "Tuesday",
    );
    await expect(companion.getByTestId("draft-window")).toContainText(
      "10:00–14:00",
    );
    await expect(companion.getByTestId("draft-gated")).toHaveText("No extra checks");
    await expect(companion.getByTestId("draft-rule-ref")).toContainText(
      "Rule Q1 — a sitting or companionship need",
    );
    await expect(companion.getByTestId("draft-orientation")).toHaveValue(
      /Elena/,
    );
    await expect(companion.getByTestId("draft-orientation")).toHaveValue(
      /company, not personal care/i,
    );

    const home = grace.page.locator(
      '[data-testid="draft-slot"][data-kind="home"]',
    );
    await expect(home).toHaveAttribute("data-gated", "true");
    await expect(home.getByTestId("draft-gated")).toContainText(
      "Needs the in-home or driver checks",
    );
    await expect(home.getByTestId("draft-label")).toHaveValue(
      /^Home visit — Saturday$/,
    );
    await expect(home.getByTestId("draft-window")).toContainText("Saturday");
    await expect(home.getByTestId("draft-window")).toContainText(
      "10:00–12:00",
    );
    await expect(home.getByTestId("draft-rule-ref")).toContainText(
      "Rule Q1 + Q6",
    );
    await expect(home.getByTestId("draft-orientation")).toHaveValue(/Elena/);
    await expect(home.getByTestId("draft-orientation")).toHaveValue(
      /first visit is two people/i,
    );

    const rows = await draftsFor(db, askId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "draft")).toBe(true);
    expect(rows.map((row) => row.rule_ref).sort()).toEqual([
      "q1_companion",
      "q6_home",
    ]);
    expect(await askStatus(db, askId)).toBe("waiting_coordinator");

    await shot(grace.page, "draft-editor-hero");
    await grace.page.setViewportSize({ width: 360, height: 740 });
    await shot(grace.page, "draft-editor-hero-360");
    await grace.context.close();
  });

  test("VAL-DESK-003 — edits kind, label, window, gated flag, and orientation note before publishing", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    const askId = await createAsk(marta.context, HERO_ASK);
    await marta.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    await openDeskAsk(grace.page, askId);

    const homeRow = (await draftsFor(db, askId)).find(
      (row) => row.kind === "home",
    );
    expect(homeRow).toBeTruthy();
    if (!homeRow) return;

    const home = card(grace.page, homeRow.id);
    await shot(grace.page, "draft-edit-before");

    await home.getByTestId("draft-kind").selectOption("meal");
    await home
      .getByTestId("draft-label")
      .fill("A Saturday lunch at the door");
    await home.getByTestId("draft-window-start").fill("2026-12-05T10:00");
    await home.getByTestId("draft-window-end").fill("2026-12-05T12:00");
    await home.getByTestId("draft-gated-flag").uncheck();
    await home
      .getByTestId("draft-orientation")
      .fill("Leave the dish at the door and text the coordinator.");
    await home.getByTestId("draft-save").click();

    await expect(home.getByTestId("draft-feedback")).toHaveText(
      /Saved\. It is still a draft/,
      // Saving now also refreshes the exclusion explanations. The Neon round
      // trip is ~325 ms from this host, so the action legitimately takes longer
      // than a single write; production runs next to the database.
      { timeout: 20_000 },
    );
    await shot(grace.page, "draft-edit-after");

    await grace.page.reload();
    const edited = card(grace.page, homeRow.id);
    await expect(edited).toHaveAttribute("data-kind", "meal");
    await expect(edited).toHaveAttribute("data-gated", "false");
    await expect(edited.getByTestId("draft-label")).toHaveValue(
      "A Saturday lunch at the door",
    );
    await expect(edited.getByTestId("draft-window")).toContainText(
      "Saturday 5 December 2026, 10:00–12:00",
    );
    await expect(edited.getByTestId("draft-orientation")).toHaveValue(
      "Leave the dish at the door and text the coordinator.",
    );
    // The rule that produced this time is not rewritten by an edit.
    await expect(edited.getByTestId("draft-rule-ref")).toContainText(
      "Rule Q1 + Q6",
    );

    const [stored] = await db.client<
      {
        kind: string;
        tier: string;
        label: string;
        gated: boolean;
        status: string;
        orientation_note: string;
        window_start: string | Date;
        window_end: string | Date;
      }[]
    >`
      SELECT kind, tier, label, gated, status, orientation_note,
             window_start, window_end
        FROM slot
       WHERE id = ${homeRow.id}
    `;
    expect(stored.kind).toBe("meal");
    expect(stored.tier).toBe("doorstep");
    expect(stored.label).toBe("A Saturday lunch at the door");
    expect(stored.gated).toBe(false);
    expect(stored.status).toBe("draft");
    expect(stored.orientation_note).toBe(
      "Leave the dish at the door and text the coordinator.",
    );
    expect(new Date(stored.window_start).toISOString()).toBe(
      "2026-12-05T15:00:00.000Z",
    );
    expect(new Date(stored.window_end).toISOString()).toBe(
      "2026-12-05T17:00:00.000Z",
    );

    // The family's words were never part of the edit path.
    const [words] = await db.client<{ verbatim_text: string }[]>`
      SELECT verbatim_text FROM ask WHERE id = ${askId}
    `;
    expect(words.verbatim_text).toBe(HERO_ASK);
    expect(await askStatus(db, askId)).toBe("waiting_coordinator");

    await grace.context.close();
  });

  test("VAL-DESK-003 — adds and removes a draft before publishing", async ({ browser }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    const askId = await createAsk(marta.context, HERO_ASK);
    await marta.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    await openDeskAsk(grace.page, askId);
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(2);

    await grace.page.getByTestId("draft-add-kind").selectOption("meal");
    await grace.page.getByTestId("draft-add-submit").click();
    await expect(grace.page.getByTestId("draft-add-feedback")).toHaveText(
      /Added\. It is a draft/,
      { timeout: 20_000 },
    );

    await grace.page.reload();
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(3);

    const rows = await draftsFor(db, askId);
    const manual = rows.find((row) => row.rule_ref === "manual");
    expect(manual).toBeTruthy();
    if (!manual) return;
    expect(manual.kind).toBe("meal");
    expect(manual.status).toBe("draft");
    expect(manual.window_start).toBeNull();

    const manualCard = card(grace.page, manual.id);
    await expect(manualCard.getByTestId("draft-rule-ref")).toContainText(
      "Added by the coordinator",
    );
    await expect(manualCard.getByTestId("draft-window")).toContainText(
      "Time to be chosen with the family",
    );
    await shot(grace.page, "draft-added");

    await manualCard.getByTestId("draft-remove").click();
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(2);

    const [remaining] = await db.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM slot WHERE ask_id = ${askId}
    `;
    expect(remaining.count).toBe(2);

    const [removedAudit] = await db.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
        FROM audit_event
       WHERE action = 'draft_slot_removed' AND entity_id = ${manual.id}
    `;
    expect(removedAudit.count).toBe(1);

    await grace.context.close();
  });

  test("holds a draft with a reason and refuses publication until it is resolved", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    const askId = await createAsk(marta.context, HERO_ASK);
    await marta.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    await openDeskAsk(grace.page, askId);

    const homeRow = (await draftsFor(db, askId)).find(
      (row) => row.kind === "home",
    );
    expect(homeRow).toBeTruthy();
    if (!homeRow) return;

    const home = card(grace.page, homeRow.id);
    await home
      .getByTestId("draft-hold-reason")
      .fill("Waiting to confirm the family's Saturday.");
    await home.getByTestId("draft-hold-submit").click();

    await expect(home.getByTestId("draft-held-notice")).toBeVisible();
    await expect(home.getByTestId("draft-held-notice")).toContainText(
      "cannot be published until the hold is resolved",
    );
    await expect(home.getByTestId("draft-held-notice")).toContainText(
      "Waiting to confirm the family's Saturday.",
    );
    await expect(
      grace.page.getByText("One draft is held. Held drafts cannot be published"),
    ).toBeVisible();
    await shot(grace.page, "draft-held");

    const heldRows = await draftsFor(db, askId);
    const heldHome = heldRows.find((row) => row.id === homeRow.id);
    expect(heldHome?.hold_reason).toBe(
      "Waiting to confirm the family's Saturday.",
    );
    expect(heldHome?.held_by).toBe(seedIds.people.grace);
    expect(heldHome?.status).toBe("draft");

    await grace.page.reload();
    const reloaded = card(grace.page, homeRow.id);
    await expect(reloaded).toHaveAttribute("data-held", "true");
    await expect(reloaded.getByTestId("draft-held-notice")).toContainText(
      "Waiting to confirm the family's Saturday.",
    );

    await reloaded.getByTestId("draft-release").click();
    await expect(reloaded.getByTestId("draft-held-notice")).toHaveCount(0);
    await expect(reloaded).toHaveAttribute("data-held", "false");

    const released = (await draftsFor(db, askId)).find(
      (row) => row.id === homeRow.id,
    );
    expect(released?.hold_reason).toBeNull();
    expect(released?.held_by).toBeNull();

    const [resolvedAudit] = await db.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
        FROM audit_event
       WHERE action = 'draft_slot_hold_resolved' AND entity_id = ${homeRow.id}
    `;
    expect(resolvedAudit.count).toBe(1);

    await grace.context.close();
  });

  test("keeps a drive blocked until the driver policy is signed, then proposes one", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    const blockedAskId = await createAsk(marta.context, DRIVE_ASK);
    await marta.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    await openDeskAsk(grace.page, blockedAskId);

    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(0);
    await expect(grace.page.getByTestId("draft-skipped")).toBeVisible();
    await expect(
      grace.page.locator('[data-testid="draft-skipped-item"][data-kind="drive"]'),
    ).toContainText("has not signed its volunteer-driver policy");
    await expect(
      grace.page.getByTestId("draft-add-kind").locator('option[value="drive"]'),
    ).toHaveAttribute("disabled", "");
    await expect(grace.page.getByTestId("draft-add-note")).toContainText(
      "volunteer-driver policy",
    );
    expect(await draftsFor(db, blockedAskId)).toHaveLength(0);
    expect(await askStatus(db, blockedAskId)).toBe("waiting_coordinator");
    await shot(grace.page, "draft-drive-blocked");

    // Sign a new policy version with transport enabled, copying the signed v1
    // content. The e2e fixture reseeds for every run, so version 2 is free.
    const inserted = await db.client`
      INSERT INTO policy (
        church_id, version, safeguarding_promises, question_set, crisis_script,
        local_crisis_line, referral_resources, familiar_face_default,
        reminder_window_hours, call_threshold_hours, transport_enabled,
        auto_publish_low_risk, signed_off_by, signed_off_at
      )
      SELECT church_id, version + 1, safeguarding_promises, question_set,
             crisis_script, local_crisis_line, referral_resources,
             familiar_face_default, reminder_window_hours,
             call_threshold_hours, true, auto_publish_low_risk,
             signed_off_by, signed_off_at
        FROM policy
       WHERE church_id = ${seedIds.church} AND version = 1
      RETURNING version
    `;
    expect(inserted[0]?.version).toBe(2);

    // The blocked ask keeps its signed v1 policy: it stays blocked.
    await grace.page.reload();
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(0);
    await expect(grace.page.getByTestId("draft-skipped")).toBeVisible();

    const martaAgain = await signIn(browser, seedAccessTokens.marta);
    const allowedAskId = await createAsk(martaAgain.context, DRIVE_ASK);
    await martaAgain.context.close();

    await openDeskAsk(grace.page, allowedAskId);
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(1);

    const drive = grace.page.locator(
      '[data-testid="draft-slot"][data-kind="drive"]',
    );
    await expect(drive).toHaveAttribute("data-gated", "true");
    await expect(drive.getByTestId("draft-label")).toHaveValue(
      /^A ride — Saturday$/,
    );
    await expect(drive.getByTestId("draft-rule-ref")).toContainText(
      "Rule Q2 — transport that is not already arranged",
    );
    await expect(drive.getByTestId("draft-window")).toContainText("Saturday");
    await expect(
      grace.page.getByTestId("draft-add-kind").locator('option[value="drive"]'),
    ).toBeEnabled();

    const [driveRow] = await draftsFor(db, allowedAskId);
    expect(driveRow.kind).toBe("drive");
    expect(driveRow.tier).toBe("transport");
    expect(driveRow.rule_ref).toBe("q2_drive");
    expect(driveRow.status).toBe("draft");
    expect(driveRow.gated).toBe(true);
    await shot(grace.page, "draft-drive-allowed");

    await grace.context.close();
  });

  test("carries the reheat preference on a meal and no clinical detail", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    const askId = await createAsk(marta.context, MEAL_ASK);
    await marta.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    await openDeskAsk(grace.page, askId);

    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(1);
    const meal = grace.page.locator(
      '[data-testid="draft-slot"][data-kind="meal"]',
    );
    await expect(meal.getByTestId("draft-label")).toHaveValue(
      /^A reheatable meal — Saturday$/,
    );
    await expect(meal.getByTestId("draft-orientation")).toHaveValue(
      /needs to reheat well/i,
    );
    await expect(meal.getByTestId("draft-orientation")).toHaveValue(
      /no need to go inside/i,
    );
    await expect(meal.getByTestId("draft-rule-ref")).toContainText("Rule Q3");
    await expect(meal.getByTestId("draft-gated")).toHaveText("No extra checks");

    const cardText = await meal.innerText();
    expect(cardText).not.toMatch(
      /diagnos|medicat|dementia|clinical|condition/i,
    );

    const rows = await draftsFor(db, askId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("meal");
    expect(rows[0].tier).toBe("doorstep");
    expect(rows[0].rule_ref).toBe("q3_meal");
    expect(rows[0].status).toBe("draft");
    expect(rows[0].label).toMatch(/reheat/i);

    await shot(grace.page, "draft-meal-reheat");
    await grace.context.close();
  });

  test("VAL-DESK-006 — keeps drafts off the board and out of caregiver and volunteer pages", async ({
    browser,
  }) => {
    const marta = await signIn(browser, seedAccessTokens.marta);
    const askId = await createAsk(marta.context, HERO_ASK);

    const grace = await signIn(browser, seedAccessTokens.grace);
    await openDeskAsk(grace.page, askId);
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(2);

    const rows = await draftsFor(db, askId);
    const labels = rows.map((row) => row.label);
    const draftIds = rows.map((row) => row.id);
    expect(labels).toHaveLength(2);

    const [publishedRows] = await db.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
        FROM slot
       WHERE ask_id = ${askId}
         AND status IN ('open', 'claimed', 'covered')
    `;
    expect(publishedRows.count).toBe(0);

    // The caregiver's own receipt shows the words and the status, never a draft.
    const receiptResponse = await marta.page.goto(`/ask/${askId}`);
    expect(receiptResponse?.status()).toBe(200);
    await expect(marta.page.getByTestId("ask-status")).toBeVisible();
    const receiptText = await marta.page.locator("body").innerText();
    for (const label of labels) {
      expect(receiptText).not.toContain(label);
    }
    expect(receiptText).not.toContain("Companion place at Respite Morning");
    await shot(marta.page, "draft-absent-caregiver-receipt");
    await marta.context.close();

    const ruth = await signIn(browser, seedAccessTokens.ruth);
    for (const route of ["/circle", "/my-claims"]) {
      const response = await ruth.page.goto(route);
      expect(response?.status()).toBe(200);
      const body = await ruth.page.locator("body").innerText();
      // The seeded demo time is published on this board, and a demo rule can
      // produce the same label as this ask's draft. A label therefore cannot
      // prove absence; the draft slot ids and this ask's own words are the
      // specific values that must not appear.
      for (const id of draftIds) {
        expect(body).not.toContain(id);
      }
      expect(body).not.toContain(HERO_ASK);
      expect(body).not.toContain("I haven't had a Saturday morning");

      // Raw HTML, including the RSC payload, leaks no draft id either.
      const raw = await ruth.context.request.get(route);
      expect(raw.status()).toBe(200);
      const html = await raw.text();
      for (const id of draftIds) {
        expect(html).not.toContain(id);
      }
      if (route === "/circle") {
        // The seeded demo time proves the board rendered; the draft ids
        // above are what actually must be missing from it.
        expect(
          await ruth.page
            .locator('[data-testid="board-open"], [data-testid="board-taken"]')
            .count(),
        ).toBeGreaterThan(0);
      }
    }
    await shot(ruth.page, "draft-absent-volunteer-board");
    await ruth.context.close();

    await grace.context.close();
  });

  test("VAL-SAFETY-006 — refuses drafts entirely on a safety- or personal-care-held ask", async ({
    browser,
  }) => {
    const david = await signIn(browser, seedAccessTokens.david);
    const safetyAskId = await createAsk(david.context, SAFETY_ASK);
    await david.context.close();

    const priya = await signIn(browser, seedAccessTokens.priya);
    const careAskId = await createAsk(priya.context, CARE_ASK);
    await priya.context.close();

    expect(await askStatus(db, safetyAskId)).toBe("safety_hold");
    expect(await askStatus(db, careAskId)).toBe("care_hold");
    expect(await draftsFor(db, safetyAskId)).toHaveLength(0);
    expect(await draftsFor(db, careAskId)).toHaveLength(0);

    const grace = await signIn(browser, seedAccessTokens.grace);

    await openDeskAsk(grace.page, safetyAskId);
    const safetyBlock = grace.page.getByTestId("draft-construction-refused");
    await expect(safetyBlock).toBeVisible();
    await expect(safetyBlock).toContainText("A person calls today");
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(0);
    await expect(grace.page.getByTestId("draft-add")).toHaveCount(0);
    await expect(grace.page.getByTestId("draft-propose")).toHaveCount(0);
    await shot(grace.page, "draft-safety-refused");

    await openDeskAsk(grace.page, careAskId);
    const careBlock = grace.page.getByTestId("draft-construction-refused");
    await expect(careBlock).toBeVisible();
    await expect(careBlock).toContainText("professional help");
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(0);
    await expect(grace.page.getByTestId("draft-add")).toHaveCount(0);
    await shot(grace.page, "draft-care-refused");

    await grace.context.close();
  });
});

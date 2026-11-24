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
import { seedAccessTokens } from "../../src/db/seed-data";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * A refused Hold, Release, or Remove keeps the coordinator's typed words.
 *
 * React 19 resets an uncontrolled form after its server action runs. The save
 * path already hands the submitted fields back in `DraftActionState.values`, so
 * a refused save keeps the label, note, kind, window, and gated flag. The
 * hold/release/remove refusals must hand the same fields back, or pressing
 * Hold with an empty reason silently discards everything the coordinator had
 * typed but not yet saved.
 *
 * Each test refuses one intent with all five fields dirty, then completes the
 * same intent successfully, so the happy path and its audit row are proven
 * unchanged. The `UPDATE slot SET status = 'open'` between render and submit
 * stands in for another coordinator publishing or removing the time in a
 * second tab; the repository's conditional writes are what refuse the stale
 * form, and no UI path is bypassed.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.\n\nShe loves hymns and tea, and she naps after lunch.";

const TYPED_LABEL = "Home visit — typed words stay";
const TYPED_NOTE = "The typed note that must survive a refusal.";
const TYPED_KIND = "meal";
const TYPED_START = "2026-12-12T09:15";
const TYPED_END = "2026-12-12T11:45";
const HOLD_REASON = "Waiting to confirm the family's Saturday.";

const NOT_EDITABLE = /can no longer be changed here/i;
const HOLD_REASON_REQUIRED = /short reason for the hold/i;

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "audit-draft-intent",
);

type DraftRow = {
  id: string;
  kind: string;
  label: string;
  status: string;
  gated: boolean;
  orientation_note: string | null;
  hold_reason: string | null;
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
    SELECT id, kind, label, status, gated, orientation_note, hold_reason
      FROM slot
     WHERE ask_id = ${askId}
     ORDER BY kind
  `;
}

async function storedDraft(
  db: E2eDatabase,
  slotId: string,
): Promise<DraftRow> {
  const [row] = await db.client<DraftRow[]>`
    SELECT id, kind, label, status, gated, orientation_note, hold_reason
      FROM slot
     WHERE id = ${slotId}
  `;
  return row;
}

async function auditCount(
  db: E2eDatabase,
  action: string,
  slotId: string,
): Promise<number> {
  const [row] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
      FROM audit_event
     WHERE action = ${action} AND entity_id = ${slotId}
  `;
  return row.count;
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

/** Every field the coordinator may leave unsaved when an intent is pressed. */
async function typeDraftValues(draft: Locator): Promise<void> {
  await draft.getByTestId("draft-kind").selectOption(TYPED_KIND);
  await draft.getByTestId("draft-label").fill(TYPED_LABEL);
  await draft.getByTestId("draft-window-start").fill(TYPED_START);
  await draft.getByTestId("draft-window-end").fill(TYPED_END);
  await draft.getByTestId("draft-gated-flag").uncheck();
  await draft.getByTestId("draft-orientation").fill(TYPED_NOTE);
}

async function expectTypedValuesKept(draft: Locator): Promise<void> {
  // Soft assertions so one reverted control does not hide the others.
  await expect.soft(draft.getByTestId("draft-kind")).toHaveValue(TYPED_KIND);
  await expect.soft(draft.getByTestId("draft-label")).toHaveValue(TYPED_LABEL);
  await expect
    .soft(draft.getByTestId("draft-window-start"))
    .toHaveValue(TYPED_START);
  await expect
    .soft(draft.getByTestId("draft-window-end"))
    .toHaveValue(TYPED_END);
  await expect.soft(draft.getByTestId("draft-gated-flag")).not.toBeChecked();
  await expect
    .soft(draft.getByTestId("draft-orientation"))
    .toHaveValue(TYPED_NOTE);
}

/** The stored row never takes an unsaved draft's fields on a hold. */
function expectStoredRowUnchanged(
  stored: DraftRow,
  original: DraftRow,
): void {
  expect(stored.kind).toBe(original.kind);
  expect(stored.label).toBe(original.label);
  expect(stored.gated).toBe(original.gated);
  expect(stored.orientation_note).toBe(original.orientation_note);
}

test.describe.configure({ timeout: 180_000 });

test.describe("a refused draft intent keeps the coordinator's typed words", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    await db.client.end();
  });

  test("Hold — an empty reason refuses and leaves the typed words, then a real hold posts", async ({
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
    await typeDraftValues(home);

    // 1. Hold with no reason: the repository refuses before any write.
    await home.getByTestId("draft-hold-submit").click();
    const reasonError = grace.page.locator(`[id="${homeRow.id}-hold-error"]`);
    await expect(reasonError).toHaveAttribute("role", "alert", {
      timeout: 20_000,
    });
    await expect(reasonError).toHaveText(HOLD_REASON_REQUIRED);
    await expectTypedValuesKept(home);
    await shot(grace.page, "hold-refused");

    let stored = await storedDraft(db, homeRow.id);
    expectStoredRowUnchanged(stored, homeRow);
    expect(stored.hold_reason).toBeNull();
    expect(await auditCount(db, "draft_slot_held", homeRow.id)).toBe(0);

    // 2. The happy path is unchanged: a reason holds the draft and audits it.
    await home.getByTestId("draft-hold-reason").fill(HOLD_REASON);
    await home.getByTestId("draft-hold-submit").click();
    await expect(home.getByTestId("draft-held-notice")).toBeVisible({
      timeout: 20_000,
    });
    await expect(home.getByTestId("draft-held-notice")).toContainText(
      HOLD_REASON,
    );
    await shot(grace.page, "hold-succeeded");

    stored = await storedDraft(db, homeRow.id);
    expect(stored.status).toBe("draft");
    expect(stored.hold_reason).toBe(HOLD_REASON);
    // A hold never saves the unsaved draft fields beside it.
    expectStoredRowUnchanged(stored, homeRow);
    expect(await auditCount(db, "draft_slot_held", homeRow.id)).toBe(1);

    await grace.context.close();
  });

  test("Release — a stale draft refuses and leaves the typed words, then a real release posts", async ({
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
    await home.getByTestId("draft-hold-reason").fill(HOLD_REASON);
    await home.getByTestId("draft-hold-submit").click();
    await expect(home.getByTestId("draft-held-notice")).toBeVisible({
      timeout: 20_000,
    });

    await typeDraftValues(home);

    // Another tab publishes this time while the form still says draft.
    await db.client`UPDATE slot SET status = 'open' WHERE id = ${homeRow.id}`;

    // 1. Release is refused and the typed words stay on screen.
    await home.getByTestId("draft-release").click();
    await expect(home.getByTestId("draft-feedback")).toHaveText(NOT_EDITABLE, {
      timeout: 20_000,
    });
    await expectTypedValuesKept(home);
    await shot(grace.page, "release-refused");

    let stored = await storedDraft(db, homeRow.id);
    expect(stored.status).toBe("open");
    expect(stored.hold_reason).toBe(HOLD_REASON);
    expectStoredRowUnchanged(stored, homeRow);
    expect(await auditCount(db, "draft_slot_hold_resolved", homeRow.id)).toBe(
      0,
    );

    // 2. The happy path is unchanged: on a real draft the hold resolves and
    //    the resolution is audited.
    await db.client`UPDATE slot SET status = 'draft' WHERE id = ${homeRow.id}`;
    await home.getByTestId("draft-release").click();
    await expect(home.getByTestId("draft-held-notice")).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(home).toHaveAttribute("data-held", "false");
    await shot(grace.page, "release-succeeded");

    stored = await storedDraft(db, homeRow.id);
    expect(stored.status).toBe("draft");
    expect(stored.hold_reason).toBeNull();
    expectStoredRowUnchanged(stored, homeRow);
    expect(await auditCount(db, "draft_slot_hold_resolved", homeRow.id)).toBe(
      1,
    );

    await grace.context.close();
  });

  test("Remove — a stale draft refuses and leaves the typed words, then a real remove posts", async ({
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
    await typeDraftValues(home);

    // Another tab publishes this time while the form still says draft.
    await db.client`UPDATE slot SET status = 'open' WHERE id = ${homeRow.id}`;

    // 1. Remove is refused and the typed words stay on screen.
    await home.getByTestId("draft-remove").click();
    await expect(home.getByTestId("draft-feedback")).toHaveText(NOT_EDITABLE, {
      timeout: 20_000,
    });
    await expectTypedValuesKept(home);
    await shot(grace.page, "remove-refused");

    const stored = await storedDraft(db, homeRow.id);
    expect(stored.status).toBe("open");
    expectStoredRowUnchanged(stored, homeRow);
    expect(await auditCount(db, "draft_slot_removed", homeRow.id)).toBe(0);

    // 2. The happy path is unchanged: on a real draft the row goes and the
    //    removal is audited.
    await db.client`UPDATE slot SET status = 'draft' WHERE id = ${homeRow.id}`;
    await home.getByTestId("draft-remove").click();
    await expect(home).toHaveCount(0, { timeout: 20_000 });
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(1);
    await shot(grace.page, "remove-succeeded");

    const remaining = await db.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM slot WHERE id = ${homeRow.id}
    `;
    expect(remaining[0].count).toBe(0);
    expect(await auditCount(db, "draft_slot_removed", homeRow.id)).toBe(1);

    await grace.context.close();
  });
});

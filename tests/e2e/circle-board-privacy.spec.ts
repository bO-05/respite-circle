import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { seedAccessTokens, seedIds } from "../../src/db/seed-data";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-BOARD-001 through VAL-BOARD-006 on the real surface.
 *
 * The board shows a published time — kind, human label, window, location, the
 * shape of the place, the approval line, and one large claim action. A gated
 * in-home time explains, for the volunteer reading it, the exact reason it is
 * locked and the human action that would unlock it. A claimed time is a calm
 * sentence with no note, no claimant, no count. The empty state names the next
 * human action.
 *
 * The privacy proof runs on a board that is genuinely populated: a second real
 * waiting ask holds draft slots at the same time, and neither its ids nor the
 * family's words nor the person they care for appear in the rendered board or
 * its raw payload.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.\n\nShe loves hymns and tea, and she naps after lunch.";

const WAITING_ASK =
  "My father needs someone to sit with him on Saturday while I go to an appointment. He knows Ruth from church, and he is happiest with a familiar face.";

const ORIENTATION_CANARY =
  "ORIENTATION CANARY: the blue teapot is in the cupboard by the sink.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "circle-board",
);

const QUIET_CHURCH = "c7777777-7777-4777-8777-777777777777";
const QUIET_VOLUNTEER = "a7777777-7777-4777-8777-777777777777";
const QUIET_TOKEN = "quiet-volunteer-7a7a";

type SlotRow = {
  id: string;
  kind: string;
  status: string;
  label: string;
  orientation_note: string | null;
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
    // Construction adds round trips to a cold Neon compute.
    timeout: 45_000,
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { askId: string };
  return body.askId;
}

async function slotsFor(db: E2eDatabase, askId: string): Promise<SlotRow[]> {
  return db.client<SlotRow[]>`
    SELECT id, kind, status, label, orientation_note
      FROM slot
     WHERE ask_id = ${askId}
     ORDER BY kind
  `;
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

function expectNoMetricWords(text: string): void {
  expect(text).not.toMatch(
    /places? left|spaces? left|remaining|views?|viewed|declines?|declined|waiting time|unclaimed/i,
  );
}

test.describe.configure({ timeout: 300_000 });

test.describe("VAL-BOARD-001…006 — the congregation board", () => {
  let db: E2eDatabase;
  const createdAskIds: string[] = [];

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    for (const askId of createdAskIds) {
      await db.client`
        DELETE FROM slot_candidate
         WHERE slot_id IN (SELECT id FROM slot WHERE ask_id = ${askId})
      `;
      await db.client`DELETE FROM slot WHERE ask_id = ${askId}`;
    }
    await db.client`DELETE FROM volunteer WHERE person_id = ${QUIET_VOLUNTEER}`;
    await db.client`DELETE FROM person WHERE id = ${QUIET_VOLUNTEER}`;
    await db.client`DELETE FROM church WHERE id = ${QUIET_CHURCH}`;
    await db.client.end();
  });

  test("VAL-BOARD-005 — an empty board is calm and names the next human action", async ({
    browser,
  }) => {
    // A church with no published time at all, isolated from the seeded demo
    // board so the empty state is genuinely empty whenever this spec runs.
    await db.client`
      INSERT INTO church (id, name, timezone)
      VALUES (${QUIET_CHURCH}, 'Quiet Chapel', 'America/New_York')
      ON CONFLICT (id) DO NOTHING
    `;
    await db.client`
      INSERT INTO person (id, church_id, first_name, last_name, roles, access_token)
      VALUES (
        ${QUIET_VOLUNTEER},
        ${QUIET_CHURCH},
        'Ada',
        'Quiet',
        '["volunteer"]'::jsonb,
        ${QUIET_TOKEN}
      )
      ON CONFLICT (id) DO NOTHING
    `;
    await db.client`
      INSERT INTO volunteer (person_id)
      VALUES (${QUIET_VOLUNTEER})
      ON CONFLICT (person_id) DO NOTHING
    `;

    const ada = await signIn(browser, QUIET_TOKEN);
    const response = await ada.page.goto("/circle");
    expect(response?.status()).toBe(200);

    const empty = ada.page.getByTestId("board-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("Nothing is open just now");
    // The calendar-off well is decoration beside the words, never a control.
    await expect(empty.locator("svg")).toHaveCount(1);
    // The next human action is named, and no number or shaming word appears.
    await expect(empty).toContainText(/coordinator/i);
    await expect(empty).toContainText(/tell|speak|ask/i);
    await expect(ada.page.getByTestId("board-slot")).toHaveCount(0);
    expectNoMetricWords(await ada.page.locator("body").innerText());
    await shot(ada.page, "circle-board-empty");
    await ada.context.close();
  });

  test("VAL-BOARD-001, VAL-BOARD-002, VAL-BOARD-003 and VAL-BOARD-004 — shows only published times with one large action, a calm claimed state, and no story", async ({
    browser,
  }) => {
    // A real approved ask: the board is genuinely populated.
    const marta = await signIn(browser, seedAccessTokens.marta);
    const approvedAskId = await createAsk(marta.context, HERO_ASK);
    createdAskIds.push(approvedAskId);
    await marta.context.close();

    const grace = await signIn(browser, seedAccessTokens.grace);
    const deskResponse = await grace.page.goto(`/desk/ask/${approvedAskId}`);
    expect(deskResponse?.status()).toBe(200);
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(2);
    await grace.page.getByTestId("approve-ask").click();
    await expect(grace.page.getByTestId("ask-review")).toHaveAttribute(
      "data-status",
      "approved",
      { timeout: 30_000 },
    );
    await grace.context.close();

    // A second, real waiting ask holds draft slots while the board is showing
    // the published times. This is the draft rule proved on a rendered board,
    // not on a placeholder page.
    const priya = await signIn(browser, seedAccessTokens.priya);
    const waitingAskId = await createAsk(priya.context, WAITING_ASK);
    createdAskIds.push(waitingAskId);
    await priya.context.close();

    const approvedSlots = await slotsFor(db, approvedAskId);
    expect(approvedSlots).toHaveLength(2);
    expect(approvedSlots.every((row) => row.status === "open")).toBe(true);
    const companion = approvedSlots.find((row) => row.kind === "companion");
    const home = approvedSlots.find((row) => row.kind === "home");
    if (!companion || !home) throw new Error("expected companion and home");

    const waitingSlots = await slotsFor(db, waitingAskId);
    expect(waitingSlots.length).toBeGreaterThan(0);
    expect(waitingSlots.every((row) => row.status === "draft")).toBe(true);

    // Ruth is an attested familiar face for Elena: both open times are hers to
    // take, and each card carries its kind, window, location, and shape.
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    const boardResponse = await ruth.page.goto("/circle");
    expect(boardResponse?.status()).toBe(200);

    const companionCard = ruth.page.locator(
      `[data-testid="board-slot"][data-slot-id="${companion.id}"]`,
    );
    const homeCard = ruth.page.locator(
      `[data-testid="board-slot"][data-slot-id="${home.id}"]`,
    );
    await expect(companionCard).toBeVisible();
    await expect(homeCard).toBeVisible();
    await expect(companionCard.getByTestId("board-kind")).toHaveText(
      "Companionship",
    );
    await expect(companionCard.getByTestId("board-window")).toContainText(
      /Tuesday|Saturday|Sunday|Monday|Wednesday|Thursday|Friday/,
    );
    await expect(companionCard.getByTestId("board-location")).toHaveText(
      "At the church hall",
    );
    await expect(companionCard.getByTestId("board-capacity")).toContainText(
      /shared morning|table/i,
    );
    await expect(companionCard.getByTestId("board-approval-line")).toContainText(
      "Approved — Grace",
    );
    await expect(homeCard).toHaveAttribute("data-gated", "true");
    await expect(homeCard.getByTestId("board-gated")).toContainText(
      /familiar face or the church's safeguarding checklist/i,
    );
    await expect(homeCard).toHaveAttribute("data-eligible", "true");

    // One primary action per open time, at least 44 by 44 CSS pixels. The
    // count is scoped to the two cards this spec published: the seeded demo
    // board may legitimately offer other open times to Ruth.
    for (const card of [companionCard, homeCard]) {
      const claimButton = card.getByRole("button", {
        name: "I'll take this time",
      });
      await expect(claimButton).toHaveCount(1);
      const box = await claimButton.boundingBox();
      if (!box) throw new Error("expected a laid-out claim button");
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await shot(ruth.page, "circle-board-ruth-open");

    // No draft from the waiting ask reaches the rendered board or the raw
    // payload, while the approved times are visibly present.
    //
    // The absence is asserted on the board's own containers, not on the whole
    // page: the shell is allowed to greet the signed-in volunteer by name, and
    // a correct board must not fail because it does.
    const boardContainers = ruth.page.locator(
      '[data-testid="board-open"], [data-testid="board-taken"]',
    );
    const boardText = (await boardContainers.allInnerTexts()).join("\n");
    const boardHtml = (
      await boardContainers.evaluateAll((elements) =>
        elements.map((element) => element.outerHTML),
      )
    ).join("\n");
    const raw = await ruth.context.request.get("/circle");
    expect(raw.status()).toBe(200);
    const html = await raw.text();
    expect(html).toContain("Companion place at Respite Morning");
    expect(html).toContain("Home visit");

    for (const forbidden of [
      WAITING_ASK,
      "My father needs someone",
      "Mr. Rao",
      "Priya",
      "Elena",
      "Marta",
      "Alvarez",
      "orientation",
      "diagnos",
      ORIENTATION_CANARY,
      ...waitingSlots.map((row) => row.id),
    ]) {
      expect(boardText).not.toContain(forbidden);
      expect(boardHtml).not.toContain(forbidden);
      // These fields are story and identity, so they may not appear anywhere
      // in the response either.
      expect(html).not.toContain(forbidden);
    }
    expectNoMetricWords(boardText);
    await shot(ruth.page, "circle-board-waiting-drafts-absent");
    await ruth.context.close();

    // Tom has no safeguarding checklist and one reference: the in-home time is
    // locked for him with a reason and the concrete thing that would unlock it.
    const tom = await signIn(browser, seedAccessTokens.tom);
    await tom.page.goto("/circle");
    const tomHome = tom.page.locator(
      `[data-testid="board-slot"][data-slot-id="${home.id}"]`,
    );
    await expect(tomHome).toHaveAttribute("data-eligible", "false");
    const lock = tomHome.getByTestId("board-lock");
    await expect(lock).toBeVisible();
    await expect(tomHome.getByTestId("board-lock-title")).toContainText(
      /safeguarding checklist/i,
    );
    await expect(tomHome.getByTestId("board-lock-unlock")).toContainText(
      /Grace/,
    );
    await expect(tomHome.getByTestId("board-lock-unlock")).toContainText(
      /two references|checklist/i,
    );
    await expect(
      tomHome.getByRole("button", { name: "I'll take this time" }),
    ).toHaveCount(0);
    await expect(
      tom.page.locator(
        `[data-testid="board-slot"][data-slot-id="${companion.id}"] [data-testid="board-claim"]`,
      ),
    ).toBeVisible();
    expectNoMetricWords(await tom.page.locator("body").innerText());
    await shot(tom.page, "circle-board-tom-gated-lock");
    await tom.context.close();

    // A claimed time is calm: a named coordinator, no note, no claimant, no
    // count, and no claim action.
    await db.client`
      UPDATE slot
         SET status = 'claimed',
             claimed_by = ${seedIds.people.ruth},
             claimed_at = now(),
             orientation_note = ${ORIENTATION_CANARY}
       WHERE id = ${home.id}
    `;

    const sara = await signIn(browser, seedAccessTokens.sara);
    await sara.page.goto("/circle");
    const claimedCard = sara.page.locator(
      `[data-testid="board-slot"][data-slot-id="${home.id}"]`,
    );
    await expect(claimedCard).toHaveAttribute("data-status", "claimed");
    await expect(claimedCard.getByTestId("board-status")).toHaveText(
      "Waiting for Grace to confirm",
    );
    await expect(claimedCard.getByTestId("board-claim")).toHaveCount(0);
    const claimedContainer = sara.page.locator(
      '[data-testid="board-open"], [data-testid="board-taken"]',
    );
    const claimedText = (await claimedContainer.allInnerTexts()).join("\n");
    const claimedBoardHtml = (
      await claimedContainer.evaluateAll((elements) =>
        elements.map((element) => element.outerHTML),
      )
    ).join("\n");
    expect(claimedText).not.toContain(ORIENTATION_CANARY);
    const claimedHtml = await (
      await sara.context.request.get("/circle")
    ).text();
    expect(claimedHtml).not.toContain(ORIENTATION_CANARY);
    // The claimant is Ruth; the signed-in viewer is Sara. The shell may greet
    // Sara by name, so the claimant's name absence is asserted on the board's
    // own containers, never on the whole page.
    expect(claimedBoardHtml).not.toContain("Ruth");
    expect(claimedBoardHtml).not.toContain("Kim");
    expectNoMetricWords(claimedText);
    await shot(sara.page, "circle-board-claimed");

    await db.client`
      UPDATE slot
         SET status = 'covered',
             claim_confirmed_by = ${seedIds.people.grace},
             claim_confirmed_at = now()
       WHERE id = ${home.id}
    `;
    await sara.page.reload();
    const coveredCard = sara.page.locator(
      `[data-testid="board-slot"][data-slot-id="${home.id}"]`,
    );
    await expect(coveredCard).toHaveAttribute("data-status", "covered");
    await expect(coveredCard.getByTestId("board-status")).toHaveText("Covered");
    const coveredHtml = await (
      await sara.context.request.get("/circle")
    ).text();
    expect(coveredHtml).not.toContain(ORIENTATION_CANARY);
    await shot(sara.page, "circle-board-covered");
    await sara.context.close();
  });
});

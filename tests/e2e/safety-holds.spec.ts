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
import { scanReportClaims } from "../../src/server/domain/copy-lint";
import { openE2eDatabase, type E2eDatabase } from "./helpers/database";

/**
 * VAL-SAFETY-001 through VAL-SAFETY-006 on the real surface.
 *
 * A safety ask is pinned, carries a human script with 988 and the church's own
 * local line, proposes no time, and never reaches the board or a volunteer
 * payload. A personal-care ask carries ARCH and the Area Agency on Aging and
 * refuses every slot path — on the screen, through the manual-add API, and in
 * the database. A close stores the coordinator's own words for the family, and
 * a conversion needs an explicit confirmation plus a reason written into the
 * append-only audit log. Personal care never converts.
 *
 * The one sentence that mentions a report on the safety card is its explicit
 * denial: no screen may suggest that a report of abuse has been made.
 */

const SAFETY_ASK =
  "She fell last week and I am scared she will wander out of the house.";
const CARE_ASK = "I need help with bathing and remembering her medication.";

// Report-claim rules live in `src/server/domain/copy-lint.ts`, not here.

const FIXED_NOTE =
  "Marta, thank you for telling us. Grace will call you today, and we will stay with this together.\n\nYou do not owe anyone a decision tonight.";

const OVERRIDE_REASON =
  "Called Marta at 4pm. The fall was last week, her neighbour is with her tonight, and there is no immediate danger.";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "safety-holds",
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

async function createAsk(
  context: BrowserContext,
  text: string,
): Promise<string> {
  const response = await context.request.post("/api/asks", {
    data: { text, consent: true },
    timeout: 45_000,
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { askId: string };
  return body.askId;
}

async function shot(page: Page, name: string): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: true,
  });
}

async function askStatus(
  db: E2eDatabase,
  askId: string,
): Promise<string | null> {
  const rows = await db.client<{ status: string }[]>`
    SELECT status FROM ask WHERE id = ${askId}
  `;
  return rows[0]?.status ?? null;
}

async function slotCount(db: E2eDatabase, askId: string): Promise<number> {
  const [row] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM slot WHERE ask_id = ${askId}
  `;
  return Number(row.count);
}

async function notificationCount(
  db: E2eDatabase,
  caregiverId: string,
): Promise<number> {
  const [row] = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
      FROM notification
     WHERE caregiver_id = ${caregiverId}
  `;
  return Number(row.count);
}

async function auditRows(
  db: E2eDatabase,
  action: string,
  entityId: string,
): Promise<{ actor_id: string | null; actor_type: string; detail: unknown }[]> {
  return db.client`
    SELECT actor_id, actor_type, detail
      FROM audit_event
     WHERE action = ${action} AND entity_id = ${entityId}
     ORDER BY created_at
  `;
}

test.describe.configure({ timeout: 180_000 });

test.describe("VAL-SAFETY-001…006 — safety and personal-care routing", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    await db.client.end();
  });

  test("VAL-SAFETY-001 and VAL-SAFETY-002 — a safety hold is pinned, carries the script, 988 and the local line, and reaches no board", async ({
    browser,
  }) => {
    const david = await signIn(browser, seedAccessTokens.david);
    const askId = await createAsk(david.context, SAFETY_ASK);
    await david.context.close();

    expect(await askStatus(db, askId)).toBe("safety_hold");
    expect(await slotCount(db, askId)).toBe(0);

    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto("/desk");
    const safetySection = grace.page.getByTestId("desk-category-safety");
    await expect(
      safetySection.locator(`[data-ask-id="${askId}"]`),
    ).toBeVisible();
    await expect(
      safetySection.locator(`[data-ask-id="${askId}"]`).getByTestId(
        "desk-pin-label",
      ),
    ).toHaveText("Safety hold");

    await grace.page.goto(`/desk/ask/${askId}`);
    const card = grace.page.getByTestId("hold-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-kind", "safety");
    await expect(grace.page.getByTestId("hold-title")).toHaveText(
      "Safety comes first",
    );

    const steps = grace.page.getByTestId("hold-script-step");
    expect(await steps.count()).toBeGreaterThanOrEqual(3);
    await expect(steps.first()).toContainText(/call the family today/i);

    await expect(grace.page.getByTestId("hold-crisis-988")).toContainText(
      "988",
    );
    await expect(grace.page.getByTestId("hold-crisis-local")).toContainText(
      "555-0142",
    );
    await expect(grace.page.getByTestId("hold-crisis-local")).toContainText(
      "Grace Community Church on-call line",
    );
    await expect(grace.page.getByTestId("hold-crisis-911")).toContainText(
      "911",
    );
    await expect(grace.page.getByTestId("hold-crisis-script")).toContainText(
      /988/,
    );

    await expect(grace.page.getByTestId("hold-no-slots")).toContainText(
      /No time is proposed/i,
    );
    await expect(grace.page.getByTestId("hold-no-report")).toContainText(
      /^No report has been made/,
    );

    // No screen may imply a report was made outside that explicit denial.
    const bodyText = await grace.page.locator("body").innerText();
    expect(bodyText).toMatch(/No report has been made/);
    expect(scanReportClaims(bodyText)).toEqual([]);

    // No slot control exists on a held ask.
    await expect(grace.page.getByTestId("draft-slot")).toHaveCount(0);
    await expect(grace.page.getByTestId("draft-add")).toHaveCount(0);
    await expect(
      grace.page.getByTestId("draft-construction-refused"),
    ).toBeVisible();

    await shot(grace.page, "safety-card");

    // The board and the volunteer payload carry nothing about this ask.
    const ruth = await signIn(browser, seedAccessTokens.ruth);
    await ruth.page.goto("/circle");
    const boardHtml = await ruth.page.content();
    expect(boardHtml).not.toContain(askId);
    expect(boardHtml).not.toContain("wander out of the house");
    // The seeded demo time is published on this board, so its label cannot
    // prove what is absent. The held ask's id and words are the specific
    // values that must not appear, and `slotCount` above proves it has no
    // slot. This positive control keeps the absence check from passing on a
    // blank or failed render.
    expect(boardHtml).toContain("Companion place at Respite Morning");

    const boardResponse = await ruth.context.request.get("/circle");
    const payload = await boardResponse.text();
    expect(payload).not.toContain(askId);
    expect(payload).not.toContain("wander out of the house");
    await shot(ruth.page, "safety-absent-board");
    await ruth.context.close();

    await grace.context.close();
  });

  test("VAL-SAFETY-003 and VAL-SAFETY-006 — a personal-care hold shows both referrals and refuses every slot entry point", async ({
    browser,
  }) => {
    const priya = await signIn(browser, seedAccessTokens.priya);
    const askId = await createAsk(priya.context, CARE_ASK);
    await priya.context.close();

    expect(await askStatus(db, askId)).toBe("care_hold");
    expect(await slotCount(db, askId)).toBe(0);

    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto(`/desk/ask/${askId}`);

    const card = grace.page.getByTestId("hold-card");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-kind", "personal_care");
    await expect(grace.page.getByTestId("hold-title")).toHaveText(
      "Personal care is not arranged here",
    );

    const referrals = grace.page.getByTestId("hold-referral");
    const referralNames = await referrals.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-name") ?? ""),
    );
    expect(referralNames.join(" · ")).toMatch(/ARCH/);
    expect(referralNames.join(" · ")).toMatch(/Area Agency on Aging/);

    await expect(grace.page.getByTestId("hold-no-slots")).toContainText(
      /No slot is proposed/i,
    );
    await expect(
      grace.page.getByTestId("hold-override-refused"),
    ).toBeVisible();
    await expect(grace.page.getByTestId("hold-override-form")).toHaveCount(0);

    // UI: no manual add control, and the refusal names the reason.
    await expect(grace.page.getByTestId("draft-add")).toHaveCount(0);
    await expect(
      grace.page.getByTestId("draft-construction-refused"),
    ).toContainText(/professional help|personal care/i);
    await shot(grace.page, "care-card");

    // API: the manual add endpoint refuses every kind with a human sentence.
    for (const kind of ["companion", "home", "drive", "meal"] as const) {
      const refused = await grace.context.request.post(
        `/api/asks/${askId}/drafts`,
        { data: { kind }, timeout: 45_000 },
      );
      expect(refused.status()).toBe(409);
      const body = (await refused.json()) as { ok: boolean; message: string };
      expect(body.ok).toBe(false);
      expect(body.message).toMatch(/personal care/i);
    }

    // An unknown kind is a plain 400, and nothing is written either.
    const badKind = await grace.context.request.post(
      `/api/asks/${askId}/drafts`,
      { data: { kind: "massage" }, timeout: 45_000 },
    );
    expect(badKind.status()).toBe(400);

    // The page itself refuses a plain POST, and a forged Server Action id
    // cannot reach a slot write.
    const plainPost = await grace.context.request.post(
      `/desk/ask/${askId}`,
      { data: { kind: "companion" }, timeout: 30_000 },
    );
    expect(plainPost.status()).toBe(405);
    expect(plainPost.headers()["allow"]).toContain("GET");

    const forgedAction = await grace.context.request.post(
      `/desk/ask/${askId}`,
      {
        headers: { "Next-Action": "0".repeat(40) },
        data: { kind: "companion" },
        timeout: 30_000,
      },
    );
    expect(forgedAction.status()).toBeGreaterThanOrEqual(400);

    expect(await slotCount(db, askId)).toBe(0);
    expect(await askStatus(db, askId)).toBe("care_hold");
    await grace.context.close();
  });

  test("VAL-SAFETY-004 — a coordinator closes a held ask with human words the family reads", async ({
    browser,
  }) => {
    const david = await signIn(browser, seedAccessTokens.david);
    const askId = await createAsk(david.context, SAFETY_ASK);
    await david.context.close();
    expect(await askStatus(db, askId)).toBe("safety_hold");

    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto(`/desk/ask/${askId}`);
    await grace.page.getByTestId("hold-close-note").fill(FIXED_NOTE);
    await grace.page.getByTestId("hold-close-submit").click();

    // Wait for the server action's own commit, then read the server-rendered
    // page. A cold Neon round trip can outlast the 7 s expect default.
    await expect
      .poll(async () => askStatus(db, askId), { timeout: 45_000 })
      .toBe("closed");
    await grace.page.reload();

    // The card is replaced by the closed record, showing the same words.
    await expect(grace.page.getByTestId("close-copy")).toHaveText(FIXED_NOTE);
    await expect(grace.page.getByTestId("hold-card")).toHaveCount(0);
    await shot(grace.page, "closed-desk");
    await grace.context.close();

    expect(await askStatus(db, askId)).toBe("closed");
    const [stored] = await db.client<{ close_note: string; closed_by: string }[]>`
      SELECT close_note, closed_by FROM ask WHERE id = ${askId}
    `;
    expect(stored.close_note).toBe(FIXED_NOTE);
    expect(stored.closed_by).toBe(seedIds.people.grace);
    expect(await notificationCount(db, seedIds.people.david)).toBe(0);

    const audits = await auditRows(db, "held_ask_closed", askId);
    expect(audits).toHaveLength(1);
    expect(audits[0].actor_id).toBe(seedIds.people.grace);
    expect(audits[0].actor_type).toBe("human");

    // The caregiver reads exactly the coordinator's words, not a template.
    const davidReader = await signIn(browser, seedAccessTokens.david);
    const receipt = await davidReader.page.goto(`/ask/${askId}`);
    expect(receipt?.status()).toBe(200);
    await expect(davidReader.page.getByTestId("ask-closed")).toBeVisible();
    await expect(davidReader.page.getByTestId("ask-close-note")).toHaveText(
      FIXED_NOTE,
    );
    expect(
      await davidReader.page.getByTestId("ask-close-note").textContent(),
    ).toBe(FIXED_NOTE);
    const caregiverText = await davidReader.page.locator("body").innerText();
    expect(caregiverText).toMatch(/Grace closed this ask with these words/);
    expect(scanReportClaims(caregiverText)).toEqual([]);
    await shot(davidReader.page, "closed-caregiver");

    await davidReader.page.goto("/care");
    const closeNote = davidReader.page.locator(
      `[data-testid="care-note"][data-ask-id="${askId}"]`,
    );
    await expect(closeNote).toBeVisible();
    await expect(closeNote).toHaveAttribute("data-kind", "close");
    await expect(
      closeNote.getByTestId("care-note-body"),
    ).toHaveText(FIXED_NOTE);
    await shot(davidReader.page, "closed-care");
    await davidReader.context.close();
  });

  test("VAL-SAFETY-005 and VAL-SAFETY-006 — a safety override needs the confirmation and the reason, writes both to audit, and never applies to personal care", async ({
    browser,
  }) => {
    const david = await signIn(browser, seedAccessTokens.david);
    const askId = await createAsk(david.context, SAFETY_ASK);
    await david.context.close();
    expect(await askStatus(db, askId)).toBe("safety_hold");

    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto(`/desk/ask/${askId}`);

    // React 19 resets an uncontrolled form after each action completes, so
    // each attempt starts from a freshly rendered page.
    const attempt = async (input: {
      confirm: boolean;
      reason: string;
    }): Promise<void> => {
      await grace.page.reload();
      // Bypass the browser's own required-field guard so the server's
      // validator is what refuses these attempts.
      await grace.page
        .getByTestId("hold-override-form")
        .evaluate((form) => {
          (form as HTMLFormElement).noValidate = true;
        });
      if (input.confirm) {
        await grace.page.getByTestId("hold-override-confirm").check();
      }
      await grace.page.getByTestId("hold-override-reason").fill(input.reason);
      await grace.page.getByTestId("hold-override-submit").click();
    };

    // A reason alone is not confirmation.
    await attempt({ confirm: false, reason: OVERRIDE_REASON });
    await expect(
      grace.page.getByTestId("hold-override-confirm-error"),
    ).toContainText(/confirm first/i);

    expect(await askStatus(db, askId)).toBe("safety_hold");
    expect(await auditRows(db, "safety_hold_overridden", askId)).toHaveLength(
      0,
    );

    // A confirmation with no reason is refused too.
    await attempt({ confirm: true, reason: "   " });
    await expect(
      grace.page.getByTestId("hold-override-reason-error"),
    ).toContainText(/reason/i);
    expect(await askStatus(db, askId)).toBe("safety_hold");

    // Both together convert the hold, and the record is shown back.
    await attempt({ confirm: true, reason: OVERRIDE_REASON });
    await expect
      .poll(async () => askStatus(db, askId), { timeout: 45_000 })
      .toBe("waiting_coordinator");
    await grace.page.reload();

    await expect(grace.page.getByTestId("desk-override-record")).toBeVisible();
    await expect(grace.page.getByTestId("desk-override-reason")).toHaveText(
      OVERRIDE_REASON,
    );
    await expect(grace.page.getByTestId("hold-card")).toHaveCount(0);
    await expect(
      grace.page.getByText(/Waiting for a person/).first(),
    ).toBeVisible();
    await shot(grace.page, "override-recorded");

    const [row] = await db.client<
      {
        safety_override_by: string | null;
        safety_override_reason: string | null;
        safety_override_at: string | null;
      }[]
    >`
      SELECT safety_override_by, safety_override_reason, safety_override_at
        FROM ask WHERE id = ${askId}
    `;
    expect(row.safety_override_by).toBe(seedIds.people.grace);
    expect(row.safety_override_reason).toBe(OVERRIDE_REASON);
    expect(row.safety_override_at).not.toBeNull();

    const audits = await auditRows(db, "safety_hold_overridden", askId);
    expect(audits).toHaveLength(1);
    expect(audits[0].actor_id).toBe(seedIds.people.grace);
    const detail = audits[0].detail as { reason?: string; automatic?: boolean };
    expect(detail.reason).toBe(OVERRIDE_REASON);
    expect(detail.automatic).toBe(false);

    // Nothing was published by the conversion.
    expect(await slotCount(db, askId)).toBe(0);
    await grace.context.close();

    // Personal care has no override control at all.
    const priya = await signIn(browser, seedAccessTokens.priya);
    const careAskId = await createAsk(priya.context, CARE_ASK);
    await priya.context.close();
    expect(await askStatus(db, careAskId)).toBe("care_hold");

    const secondGrace = await signIn(browser, seedAccessTokens.grace);
    await secondGrace.page.goto(`/desk/ask/${careAskId}`);
    await expect(
      secondGrace.page.getByTestId("hold-override-form"),
    ).toHaveCount(0);
    await expect(
      secondGrace.page.getByTestId("hold-override-refused"),
    ).toBeVisible();
    await expect(secondGrace.page.getByTestId("hold-card")).toHaveAttribute(
      "data-kind",
      "personal_care",
    );
    expect(await auditRows(db, "safety_hold_overridden", careAskId)).toHaveLength(
      0,
    );
    await secondGrace.context.close();
  });
});

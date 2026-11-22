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
 * VAL-POLICY-001, -002, -004 and VAL-CROSS-003 on the real surface.
 *
 * Grace edits a promise and a question's wording, signs the new version with
 * her name, and saves. Version 1 keeps its exact words in the database; the
 * promises page shows the edited promise with the named sign-off and date; the
 * next ask records and displays the new version's question text while the ask
 * made before the edit keeps version 1. A blank sign-off saves nothing, and a
 * loosened safeguarding clock needs the typed word LOOSEN and leaves an audit
 * flag. All of this happens on one running server: there is no restart and no
 * redeploy between the before and after screenshots.
 *
 * The edit deliberately leaves the crisis script, the local line, and the
 * referral list untouched: specs that run after this one (safety holds) assert
 * the church's crisis copy, and an append-only policy cannot be deleted.
 */

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".research",
  "validation-runs",
  "policy-editor",
);

const PRIOR_ASK =
  "I could use a little company on a Tuesday morning. Mum is fine with people she knows, and I have not had a break since September.";

const NEXT_ASK =
  "The same week has been long. A Tuesday morning with someone kind would help, and Mum likes hymns and tea.";

type PolicyRow = {
  id: string;
  version: number;
  safeguarding_promises: string[];
  question_set: Array<{ id: string; text: string }>;
  crisis_script: string;
  local_crisis_line: string | null;
  reminder_window_hours: number;
  call_threshold_hours: number;
  call_after_open_hours: number;
  signed_off_by: string | null;
  signed_off_at: Date | null;
  created_at: Date;
};

type AskRow = {
  id: string;
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

async function latestPolicy(db: E2eDatabase): Promise<PolicyRow> {
  const rows = await db.client<PolicyRow[]>`
    SELECT id, version, safeguarding_promises, question_set, crisis_script,
           local_crisis_line, reminder_window_hours, call_threshold_hours,
           call_after_open_hours, signed_off_by, signed_off_at, created_at
      FROM policy
     WHERE church_id = ${seedIds.church}
     ORDER BY version DESC
     LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new Error("the seeded policy version is missing");
  return row;
}

async function policyById(
  db: E2eDatabase,
  policyId: string,
): Promise<PolicyRow> {
  const rows = await db.client<PolicyRow[]>`
    SELECT id, version, safeguarding_promises, question_set, crisis_script,
           local_crisis_line, reminder_window_hours, call_threshold_hours,
           call_after_open_hours, signed_off_by, signed_off_at, created_at
      FROM policy
     WHERE id = ${policyId}
  `;
  const row = rows[0];
  if (!row) throw new Error(`policy ${policyId} is missing`);
  return row;
}

async function policyVersionCount(db: E2eDatabase): Promise<number> {
  const rows = await db.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
      FROM policy
     WHERE church_id = ${seedIds.church}
  `;
  return rows[0]?.count ?? 0;
}

async function policyAudit(
  db: E2eDatabase,
  policyId: string,
): Promise<
  Array<{
    action: string;
    actor_id: string | null;
    detail: {
      version?: number;
      signedOffBy?: string;
      authorName?: string | null;
      loosenedThresholds?: string[];
      changes?: Array<{ field: string; previous: number; next: number }>;
    };
  }>
> {
  return db.client`
    SELECT action, actor_id, detail
      FROM audit_event
     WHERE entity = 'policy' AND entity_id = ${policyId}
     ORDER BY created_at, action
  `;
}

async function createAsk(
  page: Page,
  db: E2eDatabase,
  text: string,
): Promise<{ askId: string; policyVersionId: string }> {
  const response = await page.context().request.post("/api/asks", {
    data: { text, consent: true },
    timeout: 45_000,
  });
  if (response.status() !== 201) {
    throw new Error(`ask intake answered ${response.status()}: ${await response.text()}`);
  }
  const body = (await response.json()) as { askId: string };

  const rows = await db.client<AskRow[]>`
    SELECT id, policy_version_id FROM ask WHERE id = ${body.askId}
  `;
  if (!rows[0]) throw new Error(`ask ${body.askId} was not stored`);
  return {
    askId: body.askId,
    policyVersionId: rows[0].policy_version_id,
  };
}

async function askPolicyVersion(
  db: E2eDatabase,
  askId: string,
): Promise<string> {
  const rows = await db.client<{ policy_version_id: string }[]>`
    SELECT policy_version_id FROM ask WHERE id = ${askId}
  `;
  return rows[0]?.policy_version_id ?? "";
}

async function q1Text(db: E2eDatabase, askId: string): Promise<string> {
  const rows = await db.client<{ question_text: string }[]>`
    SELECT question_text
      FROM decision
     WHERE ask_id = ${askId} AND question_id = 'Q1'
     LIMIT 1
  `;
  return rows[0]?.question_text ?? "";
}

test.describe.configure({ timeout: 300_000 });

test.describe("the editable, signed church policy", () => {
  let db: E2eDatabase;

  test.beforeAll(async () => {
    db = await openE2eDatabase();
  });

  test.afterAll(async () => {
    if (db) await db.client.end();
  });

  test("a blank sign-off is refused and saves no version", async ({
    browser,
  }) => {
    const before = await policyVersionCount(db);
    const grace = await signIn(browser, seedAccessTokens.grace);

    await grace.page.goto("/desk/policy");
    const firstPromise = grace.page.getByLabel("Promise 1", { exact: true });
    const original = await firstPromise.inputValue();
    await firstPromise.fill(`${original} A blank sign-off probe.`);

    await grace.page.getByTestId("policy-save").click();

    const feedback = grace.page.getByTestId("policy-feedback");
    await expect(feedback).toBeVisible();
    await expect(feedback).toHaveAttribute("role", "alert");
    await expect(feedback).toContainText(/sign-off is required/i);
    await expect(feedback).toContainText(/name/i);
    await shot(grace.page, "blank-signoff-refused");

    expect(await policyVersionCount(db)).toBe(before);

    await grace.context.close();
  });

  test("saving creates a new version; promises and the next ask use it; the prior ask keeps its own", async ({
    browser,
  }) => {
    const baseline = await latestPolicy(db);
    const q1Before = baseline.question_set.find(
      (question) => question.id === "Q1",
    )?.text as string;
    expect(q1Before.length).toBeGreaterThan(0);

    // Before the edit: the public page shows the version already signed.
    const guestBefore = await browser.newContext();
    const promisesBefore = await guestBefore.newPage();
    const beforeResponse = await promisesBefore.goto("/promises");
    expect(beforeResponse?.status()).toBe(200);
    await expect(promisesBefore.getByTestId("policy-signoff")).toContainText(
      /Signed by/,
    );
    await shot(promisesBefore, "promises-before-save");
    await guestBefore.close();

    // An ask made before the edit records the version in force right now.
    const marta = await signIn(browser, seedAccessTokens.marta);
    const prior = await createAsk(marta.page, db, PRIOR_ASK);
    expect(prior.policyVersionId).toBe(baseline.id);

    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto("/desk/policy");
    await expect(
      grace.page.getByRole("heading", {
        level: 1,
        name: /church policy and promises/i,
      }),
    ).toBeVisible();

    const uniquePromise = `We review these promises with the church family every Advent. (${Date.now()})`;
    const q1After = `${q1Before} 2026 review.`;

    await grace.page.getByLabel("Add a promise (optional)").fill(uniquePromise);
    const q1Field = grace.page.getByLabel("Question Q1 text");
    await q1Field.fill(q1After);
    await grace.page
      .getByLabel("Your name, as the sign-off for this version")
      .fill("Grace Whitfield");

    await shot(grace.page, "policy-editor-filled");
    await grace.page.getByTestId("policy-save").click();

    const feedback = grace.page.getByTestId("policy-feedback");
    await expect(feedback).toContainText(
      /saved and signed by Grace Whitfield/i,
      { timeout: 30_000 },
    );
    await expect(feedback).toHaveAttribute("role", "status");
    await expect(
      grace.page.getByTestId("policy-current-version"),
    ).toContainText(`Version ${baseline.version + 1}`);
    await expect(grace.page.getByTestId("policy-signoff")).toContainText(
      "Signed by Grace Whitfield",
    );
    await expect(grace.page.getByTestId("policy-history")).toContainText(
      "In force",
    );
    await shot(grace.page, "policy-saved");

    const saved = await latestPolicy(db);
    expect(saved.version).toBe(baseline.version + 1);
    expect(saved.id).not.toBe(baseline.id);
    expect(saved.signed_off_by).toBe("Grace Whitfield");
    expect(saved.signed_off_at).not.toBeNull();
    expect(saved.created_at).not.toBeNull();
    expect(saved.safeguarding_promises).toContain(uniquePromise);
    expect(
      saved.question_set.find((question) => question.id === "Q1")?.text,
    ).toBe(q1After);
    // The crisis content this feature did not edit is carried forward.
    expect(saved.crisis_script).toBe(baseline.crisis_script);
    expect(saved.local_crisis_line).toBe(baseline.local_crisis_line);

    // Version 1 (and every prior row) is byte-identical.
    const previous = await policyById(db, baseline.id);
    expect(previous.safeguarding_promises).toEqual(
      baseline.safeguarding_promises,
    );
    expect(previous.question_set).toEqual(baseline.question_set);
    expect(previous.crisis_script).toBe(baseline.crisis_script);

    const audit = await policyAudit(db, saved.id);
    const savedAudit = audit.find(
      (row) => row.action === "policy_version_saved",
    );
    expect(savedAudit).toBeTruthy();
    expect(savedAudit?.actor_id).toBe(seedIds.people.grace);
    expect(savedAudit?.detail.version).toBe(saved.version);
    expect(savedAudit?.detail.signedOffBy).toBe("Grace Whitfield");
    expect(savedAudit?.detail.authorName).toBe("Grace Whitfield");

    // The public promises page reads the current signed version, with the
    // name and date, on the same running server.
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    const promisesResponse = await guestPage.goto("/promises");
    expect(promisesResponse?.status()).toBe(200);
    await expect(
      guestPage.getByText(uniquePromise, { exact: false }),
    ).toBeVisible();
    const signoff = guestPage.getByTestId("policy-signoff");
    await expect(signoff).toContainText(`Version ${saved.version}`);
    await expect(signoff).toContainText("Grace Whitfield");
    await expect(signoff.locator("time")).toHaveAttribute(
      "datetime",
      new Date(saved.signed_off_at as Date).toISOString(),
    );
    await shot(guestPage, "promises-after-save");
    await guest.close();

    // The next ask records and uses the new version; the prior ask does not.
    const next = await createAsk(marta.page, db, NEXT_ASK);
    expect(next.policyVersionId).toBe(saved.id);
    expect(await askPolicyVersion(db, prior.askId)).toBe(baseline.id);

    expect(await q1Text(db, prior.askId)).toBe(q1Before);
    expect(await q1Text(db, next.askId)).toBe(q1After);

    await marta.page.goto(`/ask/${next.askId}`);
    await expect(
      marta.page.getByText("2026 review.", { exact: false }).first(),
    ).toBeVisible();
    await shot(marta.page, "next-ask-new-question-text");

    await marta.context.close();
    await grace.context.close();
  });

  test("a tighter clock saves without a word; a loosened clock needs LOOSEN and is flagged in audit", async ({
    browser,
  }) => {
    const baseline = await latestPolicy(db);
    const q1 = baseline.question_set.find((question) => question.id === "Q1")
      ?.text as string;

    // Start from a tighter version so this test always loosens both clocks by
    // a known amount, even when Playwright retries it without a fresh seed.
    const tighterThreshold = baseline.call_threshold_hours + 12;
    const tighterOpen = Math.max(1, baseline.call_after_open_hours - 12);

    const grace = await signIn(browser, seedAccessTokens.grace);
    await grace.page.goto("/desk/policy");
    const signOff = grace.page.getByLabel(
      "Your name, as the sign-off for this version",
    );
    const feedback = grace.page.getByTestId("policy-feedback");

    await grace.page
      .getByLabel(/^Call threshold/)
      .fill(String(tighterThreshold));
    await grace.page.getByLabel(/^Call after/).fill(String(tighterOpen));
    await signOff.fill("Grace Whitfield");
    await grace.page.getByTestId("policy-save").click();
    await expect(feedback).toContainText(
      /saved and signed by Grace Whitfield/i,
      { timeout: 30_000 },
    );

    const tightened = await latestPolicy(db);
    expect(tightened.version).toBe(baseline.version + 1);
    expect(tightened.call_threshold_hours).toBe(tighterThreshold);
    expect(tightened.call_after_open_hours).toBe(tighterOpen);
    const tightenedAudit = await policyAudit(db, tightened.id);
    expect(
      tightenedAudit.some(
        (row) => row.action === "policy_safeguarding_loosened",
      ),
    ).toBe(false);
    await shot(grace.page, "tighter-clocks-saved-without-word");

    // Loosen both clocks back: a smaller threshold is less notice before a
    // time starts; a larger publication clock is a later call.
    const looserThreshold = baseline.call_threshold_hours;
    const looserOpen = baseline.call_after_open_hours + 12;
    await grace.page.goto("/desk/policy");
    const versionsBefore = await policyVersionCount(db);

    await grace.page
      .getByLabel(/^Call threshold/)
      .fill(String(looserThreshold));
    await grace.page.getByLabel(/^Call after/).fill(String(looserOpen));
    await signOff.fill("Grace Whitfield");
    await grace.page.getByTestId("policy-save").click();
    await expect(feedback).toHaveAttribute("role", "alert");
    await expect(feedback).toContainText(/LOOSEN/);
    await expect(feedback).toContainText(/less notice/i);
    await shot(grace.page, "loosening-refused-without-word");
    expect(await policyVersionCount(db)).toBe(versionsBefore);

    // The refused save kept every typed value, including the sign-off and the
    // question wording, so the coordinator only adds the confirming word.
    await expect(grace.page.getByLabel(/^Call threshold/)).toHaveValue(
      String(looserThreshold),
    );
    await expect(grace.page.getByLabel(/^Call after/)).toHaveValue(
      String(looserOpen),
    );
    await expect(signOff).toHaveValue("Grace Whitfield");
    await expect(grace.page.getByLabel("Question Q1 text")).toHaveValue(q1);

    await grace.page
      .getByLabel("Typed confirmation for a loosening")
      .fill("LOOSEN");
    await grace.page.getByTestId("policy-save").click();
    await expect(feedback).toContainText(
      /saved and signed by Grace Whitfield/i,
      { timeout: 30_000 },
    );
    await shot(grace.page, "loosening-saved");

    const saved = await latestPolicy(db);
    expect(saved.version).toBe(tightened.version + 1);
    expect(saved.call_threshold_hours).toBe(looserThreshold);
    expect(saved.call_after_open_hours).toBe(looserOpen);

    const audit = await policyAudit(db, saved.id);
    const flagged = audit.find(
      (row) => row.action === "policy_safeguarding_loosened",
    );
    expect(flagged).toBeTruthy();
    expect(flagged?.actor_id).toBe(seedIds.people.grace);
    expect(flagged?.detail.version).toBe(saved.version);
    expect(flagged?.detail.loosenedThresholds?.sort()).toEqual([
      "callAfterOpenHours",
      "callThresholdHours",
    ]);
    const changes = flagged?.detail.changes ?? [];
    expect(
      changes.find((change) => change.field === "callThresholdHours"),
    ).toMatchObject({
      previous: tighterThreshold,
      next: looserThreshold,
    });
    expect(
      changes.find((change) => change.field === "callAfterOpenHours"),
    ).toMatchObject({
      previous: tighterOpen,
      next: looserOpen,
    });

    await grace.context.close();
  });

  test("a deputy may edit, and a caregiver is refused and never sees the content", async ({
    browser,
  }) => {
    const daniel = await signIn(browser, seedAccessTokens.daniel);
    const deputyResponse = await daniel.page.goto("/desk/policy");
    expect(deputyResponse?.status()).toBe(200);
    await expect(daniel.page.getByTestId("policy-editor")).toBeVisible();
    await expect(
      daniel.page.getByLabel("Your name, as the sign-off for this version"),
    ).toBeVisible();
    await daniel.context.close();

    const marta = await signIn(browser, seedAccessTokens.marta);

    const response = await marta.context.request.get("/desk/policy", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
    const body = await response.text();
    expect(body).not.toContain("Crisis script");
    expect(body).not.toContain("Safeguarding promises");

    const pageResponse = await marta.page.goto("/desk/policy");
    expect(pageResponse?.status()).toBe(403);
    await expect(
      marta.page.getByRole("heading", {
        name: /that area isn't part of your role/i,
      }),
    ).toBeVisible();
    await shot(marta.page, "caregiver-refused-policy");

    await marta.context.close();
  });
});

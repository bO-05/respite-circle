import { inArray } from "drizzle-orm";
import { DEMO_IDS, seedDemoState, type DemoStateSummary } from "@/db/demo-state";
import { readAllTableCounts, type TableCounts } from "@/db/counts";
import { resetDemoDatabase } from "@/db/reset";
import { session } from "@/db/schema";
import {
  seedChurch,
  seedIds,
  seedPeople,
  seedPolicy,
  seedQuestionSet,
  seedSessionTemplate,
} from "@/db/seed-data";
import type { SeedDb } from "@/db/seed-core";
import { verifySeed } from "@/db/verify";
import { nextOccurrences } from "@/server/domain/session-calendar";
import { sha256Hex } from "./decision-contract";
import {
  DEMO_DECISION_ASKS,
  decideDemoAsks,
  isDemoLiveAiEnabled,
  type DemoAskEngine,
  type DemoDecisionMode,
} from "./demo-decisions";
import type { DecisionProvider, EnvLike } from "./providers";

/**
 * The deterministic demo reset.
 *
 * Truncation (not `ON CONFLICT DO NOTHING`) is the point: a seeded row edited
 * since it was first inserted must come back with the current wording, not
 * survive with the old text. After the base cast and the demo-ready rows are
 * written, twelve assertions are verified before the caller is allowed to
 * report success. One failed assertion means `ok: false` and the failed ids;
 * there is no path that returns a success payload after a failure.
 */

export const DEMO_ASSERTION_IDS = [
  "church_count",
  "person_count",
  "caregiver_count",
  "volunteer_count",
  "policy_version_1",
  "session_template",
  "future_sessions",
  "ask_waiting",
  "ask_approved_demo_ready",
  "ask_held",
  "notification_quota_and_failure_path",
  "audit_and_verbatim_digest",
] as const;

export type DemoAssertionId = (typeof DEMO_ASSERTION_IDS)[number];
export type DemoResetFault = "church" | "demo";

export type DemoAssertionFailure = {
  id: DemoAssertionId | "seed_cast";
  message: string;
};

export type DemoResetResult = {
  ok: boolean;
  church: string;
  counts: TableCounts;
  seedDigest: string | null;
  assertions: {
    passed: number;
    total: number;
    failed: string[];
  };
  failures: DemoAssertionFailure[];
  /**
   * The engine that actually decided each demo ask, read back from the stored
   * decision rows. `live` means a model answered; `deterministic` means the
   * labelled rules engine did. Never part of an assertion or the seed digest.
   */
  engines: DemoAskEngine[];
  /** `live` when `RC_DEMO_LIVE_AI` asked for a model run; the engines say what answered. */
  mode: DemoDecisionMode;
};

export type DemoResetOptions = {
  now?: Date;
  fault?: DemoResetFault | null;
  /** Force a mode for a test or a local proof. Default: `RC_DEMO_LIVE_AI`. */
  decisionMode?: DemoDecisionMode;
  /** Inject the live provider (tests and fault injection). */
  provider?: DecisionProvider;
  env?: EnvLike;
  /** Per-provider-call cap for the live run. */
  liveTimeoutMs?: number;
  /** Total time the live run may spend before the rules engine finishes. */
  liveBudgetMs?: number;
};

type ResetFacts = {
  counts: TableCounts;
  churches: Array<{ name: string; timezone: string }>;
  people: Array<{ access_token: string }>;
  policies: Array<{
    version: number;
    question_set: Array<{ id: string }>;
    reminder_window_hours: number;
    call_threshold_hours: number;
    call_after_open_hours: number;
    signed_off_by: string | null;
  }>;
  templates: Array<{
    weekday: number;
    start_time: string;
    end_time: string;
    active: boolean;
  }>;
  sessions: Array<{
    id: string;
    starts_at: Date;
    status: string;
  }>;
  asks: Array<{
    id: string;
    status: string;
    caregiver_id: string;
    care_recipient_id: string;
  }>;
  slots: Array<{
    id: string;
    ask_id: string;
    kind: string;
    status: string;
    gated: boolean;
    claimed_by: string | null;
    approved_at: Date | null;
    session_id: string | null;
    window_start: Date | null;
  }>;
  notifications: Array<{ slot_id: string; kind: string }>;
  candidates: Array<{ slot_id: string }>;
  revisions: Array<{
    id: string;
    ask_id: string;
    digest: string;
    verbatim_text: string;
  }>;
  decisionCounts: Array<{ ask_revision_id: string; count: number }>;
  decisionEngines: Array<{
    ask_id: string;
    provider: string;
    model: string;
    latency_ms: number | null;
    count: number;
  }>;
};

async function readFacts(db: SeedDb): Promise<ResetFacts> {
  const [
    counts,
    churches,
    people,
    policies,
    templates,
    sessions,
    asks,
    slots,
    notifications,
    candidates,
    revisions,
    decisionCounts,
    decisionEngines,
  ] = await Promise.all([
    readAllTableCounts(db),
    db.$client<{ name: string; timezone: string }[]>`
      SELECT name, timezone FROM church ORDER BY id
    `,
    db.$client<{ access_token: string }[]>`
      SELECT access_token FROM person ORDER BY id
    `,
    db.$client<ResetFacts["policies"]>`
      SELECT version, question_set, reminder_window_hours,
             call_threshold_hours, call_after_open_hours, signed_off_by
        FROM policy
       ORDER BY version
    `,
    db.$client<ResetFacts["templates"]>`
      SELECT weekday,
             to_char(start_time, 'HH24:MI:SS') AS start_time,
             to_char(end_time, 'HH24:MI:SS') AS end_time,
             active
        FROM session_template
       ORDER BY id
    `,
    db.$client<ResetFacts["sessions"]>`
      SELECT id, starts_at, status FROM session ORDER BY starts_at
    `,
    db.$client<ResetFacts["asks"]>`
      SELECT id, status, caregiver_id, care_recipient_id FROM ask ORDER BY id
    `,
    db.$client<ResetFacts["slots"]>`
      SELECT id, ask_id, kind, status, gated, claimed_by, approved_at,
             session_id, window_start
        FROM slot
       ORDER BY id
    `,
    db.$client<ResetFacts["notifications"]>`
      SELECT slot_id, kind FROM notification ORDER BY id
    `,
    db.$client<ResetFacts["candidates"]>`
      SELECT slot_id FROM slot_candidate ORDER BY id
    `,
    db.$client<ResetFacts["revisions"]>`
      SELECT id, ask_id, digest, verbatim_text FROM ask_revision ORDER BY id
    `,
    db.$client<ResetFacts["decisionCounts"]>`
      SELECT ask_revision_id, COUNT(*)::int AS count
        FROM decision
       GROUP BY ask_revision_id
       ORDER BY ask_revision_id
    `,
    db.$client<ResetFacts["decisionEngines"]>`
      SELECT ask_id,
             provider,
             model,
             MAX(latency_ms)::int AS latency_ms,
             COUNT(*)::int AS count
        FROM decision
       GROUP BY ask_id, provider, model
       ORDER BY ask_id, provider, model
    `,
  ]);

  return {
    counts,
    churches,
    people,
    policies,
    templates,
    sessions,
    asks,
    slots,
    notifications,
    candidates,
    revisions,
    decisionCounts,
    decisionEngines,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function buildSeedDigest(facts: ResetFacts): string {
  // The digest covers stable state only: counts, ids, statuses, kinds, and
  // verbatim digests. Publication instants and relative windows are left out,
  // so two resets seconds apart hash identically.
  const manifest = {
    version: 1,
    church: facts.churches[0]?.name ?? null,
    counts: facts.counts,
    asks: facts.asks.map((row) => ({ id: row.id, status: row.status })),
    revisions: facts.revisions.map((row) => ({
      askId: row.ask_id,
      digest: row.digest,
    })),
    slots: facts.slots.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      gated: row.gated,
      claimedBy: row.claimed_by,
    })),
    notifications: facts.notifications.map((row) => ({
      slotId: row.slot_id,
      kind: row.kind,
    })),
  };

  return `sha256:${sha256Hex(canonicalJson(manifest))}`;
}

/**
 * Name the engine behind each demo ask from its stored decision rows.
 *
 * Read back rather than remembered: the output describes the database, so it
 * cannot claim a live run that did not persist. The demo has one engine per
 * ask by construction; `mixed` and `none` exist so a bug is reported plainly
 * instead of being rounded to a passing label.
 */
function summariseDecisionEngines(
  facts: ResetFacts,
  outcomes: ReadonlyArray<{
    askId: string;
    fallbackReason: DemoAskEngine["fallbackReason"];
  }>,
): DemoAskEngine[] {
  const reasons = new Map(
    outcomes.map((outcome) => [outcome.askId, outcome.fallbackReason]),
  );

  return DEMO_DECISION_ASKS.map((ask) => {
    const rows = facts.decisionEngines.filter(
      (row) => row.ask_id === ask.askId,
    );
    const providers = Array.from(
      new Set(rows.map((row) => row.provider)),
    ).sort();
    const models = Array.from(new Set(rows.map((row) => row.model))).sort();
    const latencies = rows
      .map((row) => row.latency_ms)
      .filter((value): value is number => typeof value === "number");

    let engine: DemoAskEngine["engine"] = "none";
    if (rows.length > 0) {
      engine =
        providers.length === 1
          ? providers[0] === "deterministic"
            ? "deterministic"
            : "live"
          : "mixed";
    }

    return {
      askId: ask.askId,
      label: ask.label,
      engine,
      providers,
      models,
      latencyMs: latencies.length > 0 ? Math.max(...latencies) : null,
      questionCount: rows.reduce((total, row) => total + row.count, 0),
      fallbackReason: reasons.get(ask.askId) ?? null,
    };
  });
}

/**
 * The twelve seed assertions. Each failure names the id and one plain sentence
 * so a human can see what broke without reading the database.
 */
function verifyFacts(
  facts: ResetFacts,
  input: { now: Date; demo: DemoStateSummary },
): DemoAssertionFailure[] {
  const failures: DemoAssertionFailure[] = [];
  const fail = (id: DemoAssertionId, message: string) => {
    failures.push({ id, message });
  };

  // 1. One church, the seeded name and time zone.
  if (
    facts.counts.church !== 1 ||
    facts.churches.length !== 1 ||
    facts.churches[0]?.name !== seedChurch.name ||
    facts.churches[0]?.timezone !== seedChurch.timezone
  ) {
    fail(
      "church_count",
      `expected one church named "${seedChurch.name}" in ${seedChurch.timezone}, found ${facts.churches
        .map((row) => row.name)
        .join(", ") || "none"}`,
    );
  }

  // 2. Nine people, each with the seeded access token.
  const tokens = new Set(facts.people.map((row) => row.access_token));
  const missingTokens = seedPeople
    .filter((person) => !tokens.has(person.accessToken))
    .map((person) => person.firstName);
  if (facts.counts.person !== 9 || missingTokens.length > 0) {
    fail(
      "person_count",
      `expected 9 people with the seeded access links, found ${facts.counts.person}${
        missingTokens.length > 0
          ? `; missing link for ${missingTokens.join(", ")}`
          : ""
      }`,
    );
  }

  // 3. Three caregivers.
  if (facts.counts.caregiver !== 3) {
    fail(
      "caregiver_count",
      `expected 3 caregivers, found ${facts.counts.caregiver}`,
    );
  }

  // 4. Four volunteers.
  if (facts.counts.volunteer !== 4) {
    fail(
      "volunteer_count",
      `expected 4 volunteers, found ${facts.counts.volunteer}`,
    );
  }

  // 5. One signed policy version carrying the nine questions and both clocks.
  const policy = facts.policies[0];
  const questionIds = policy?.question_set.map((entry) => entry.id) ?? [];
  const policyQuestionsOk =
    questionIds.join(",") === seedQuestionSet.map((entry) => entry.id).join(",");
  if (
    facts.counts.policy !== 1 ||
    facts.policies.length !== 1 ||
    policy?.version !== seedPolicy.version ||
    !policyQuestionsOk ||
    !policy?.signed_off_by?.trim() ||
    policy?.reminder_window_hours !== seedPolicy.reminderWindowHours ||
    policy?.call_threshold_hours !== seedPolicy.callThresholdHours ||
    policy?.call_after_open_hours !== seedPolicy.callAfterOpenHours
  ) {
    fail(
      "policy_version_1",
      `expected one signed policy version 1 with Q1-Q9 and the seeded clocks, found ${facts.counts.policy} version(s)${
        policy
          ? `; signed by ${policy.signed_off_by ?? "nobody"}; clocks ${policy.reminder_window_hours}/${policy.call_threshold_hours}/${policy.call_after_open_hours}`
          : ""
      }`,
    );
  }

  // 6. The Tuesday 10:00-14:00 template.
  const template = facts.templates[0];
  if (
    facts.counts.session_template !== 1 ||
    facts.templates.length !== 1 ||
    template?.weekday !== seedSessionTemplate.weekday ||
    template?.start_time !== "10:00:00" ||
    template?.end_time !== "14:00:00" ||
    template?.active !== true
  ) {
    fail(
      "session_template",
      `expected one active Tuesday 10:00-14:00 template, found ${
        template
          ? `${template.weekday}/${template.start_time}/${template.end_time}/active=${template.active}`
          : "none"
      }`,
    );
  }

  // 7. Four future scheduled sessions.
  const futureSessions = facts.sessions.filter(
    (row) => new Date(row.starts_at).getTime() > input.now.getTime(),
  );
  const scheduledFuture = futureSessions.filter(
    (row) => row.status === "scheduled",
  );
  if (futureSessions.length !== 4 || scheduledFuture.length !== 4) {
    fail(
      "future_sessions",
      `expected 4 future scheduled Respite Mornings, found ${futureSessions.length} future (${scheduledFuture.length} scheduled). Refresh the seeded calendar, or run npm run sessions:materialise.`,
    );
  }

  // 8. At least one ask waiting for a person, with typed answers.
  const waitingAsks = facts.asks.filter(
    (row) => row.status === "waiting_coordinator",
  );
  const revisionIdsWithDecisions = new Set(
    facts.decisionCounts
      .filter((row) => row.count > 0)
      .map((row) => row.ask_revision_id),
  );
  const waitingHasAnswers = facts.revisions.some(
    (row) =>
      waitingAsks.some((askRow) => askRow.id === row.ask_id) &&
      revisionIdsWithDecisions.has(row.id),
  );
  if (waitingAsks.length < 1 || !waitingHasAnswers) {
    fail(
      "ask_waiting",
      `expected at least one waiting ask with typed answers, found ${waitingAsks.length} waiting ask(s)`,
    );
  }

  // 9. The demo board: Marta's hero ask approved, a companion place published
  //    on the next real Respite Morning.
  const heroAsk = facts.asks.find((row) => row.id === DEMO_IDS.askHero);
  const nextSessionId = input.demo.nextSessionId;
  const companion = facts.slots.find(
    (row) => row.id === DEMO_IDS.slotCompanion,
  );
  const openPublished = facts.slots.filter(
    (row) => row.status === "open" && row.approved_at !== null,
  );
  if (
    !heroAsk ||
    heroAsk.status !== "approved" ||
    heroAsk.caregiver_id !== seedIds.people.marta ||
    !companion ||
    companion.status !== "open" ||
    companion.approved_at === null ||
    companion.session_id !== nextSessionId ||
    openPublished.length < 2
  ) {
    fail(
      "ask_approved_demo_ready",
      `expected Marta's hero ask approved with an open companion place on the next session (${nextSessionId ?? "none"}); found ask ${heroAsk?.status ?? "missing"}, companion ${companion?.status ?? "missing"}, ${openPublished.length} open published time(s)`,
    );
  }

  // 10. At least one held ask, and no slot attached to it.
  const heldAsks = facts.asks.filter(
    (row) => row.status === "safety_hold" || row.status === "care_hold",
  );
  const heldWithSlots = heldAsks.filter((row) =>
    facts.slots.some((slotRow) => slotRow.ask_id === row.id),
  );
  if (heldAsks.length < 1 || heldWithSlots.length > 0) {
    fail(
      "ask_held",
      `expected at least one held ask with no time offered, found ${heldAsks.length} held ask(s) and ${heldWithSlots.length} with a slot`,
    );
  }

  // 11. The quota everywhere, and the failure path preserved on the demo meal:
  //     open, unclaimed, past the reminder window, no candidate, zero messages.
  const reminderHours =
    facts.policies[0]?.reminder_window_hours ?? seedPolicy.reminderWindowHours;
  const notificationsBySlot = new Map<string, string[]>();
  for (const row of facts.notifications) {
    const list = notificationsBySlot.get(row.slot_id) ?? [];
    list.push(row.kind);
    notificationsBySlot.set(row.slot_id, list);
  }

  const quotaViolations: string[] = [];
  for (const [slotId, kinds] of notificationsBySlot) {
    if (kinds.length > 2) quotaViolations.push(`${slotId} has ${kinds.length} rows`);
    if (kinds.filter((kind) => kind === "confirmation").length > 1) {
      quotaViolations.push(`${slotId} has two confirmations`);
    }
    if (kinds.filter((kind) => kind === "reminder").length > 1) {
      quotaViolations.push(`${slotId} has two reminders`);
    }
  }

  const failureSlot = facts.slots.find(
    (row) => row.id === DEMO_IDS.slotFailure,
  );
  const failureNotifications = notificationsBySlot.get(DEMO_IDS.slotFailure) ?? [];
  const failureCandidates = facts.candidates.filter(
    (row) => row.slot_id === DEMO_IDS.slotFailure,
  );
  const reminderWindowOpens = failureSlot?.window_start
    ? new Date(failureSlot.window_start).getTime() - reminderHours * 60 * 60 * 1_000
    : Number.NaN;
  const failurePathOk =
    Boolean(failureSlot) &&
    failureSlot?.status === "open" &&
    failureSlot?.claimed_by === null &&
    failureSlot?.approved_at !== null &&
    Number.isFinite(reminderWindowOpens) &&
    input.now.getTime() >= reminderWindowOpens &&
    failureCandidates.length === 0 &&
    failureNotifications.length === 0;

  if (quotaViolations.length > 0 || !failurePathOk) {
    fail(
      "notification_quota_and_failure_path",
      `expected every time within the one confirmation plus one reminder quota and one open, unclaimed demo meal past its reminder window with zero messages; ${
        quotaViolations.length > 0
          ? `quota: ${quotaViolations.join("; ")}`
          : `failure time: status ${failureSlot?.status ?? "missing"}, claimed ${failureSlot?.claimed_by ?? "nobody"}, ${failureCandidates.length} candidate(s), ${failureNotifications.length} notification(s)`
      }`,
    );
  }

  // 12. Audit rows exist and every verbatim digest is a real SHA-256 of the
  //     words it names.
  const badDigests = facts.revisions.filter(
    (row) =>
      !/^[0-9a-f]{64}$/.test(row.digest) ||
      row.digest !== sha256Hex(row.verbatim_text),
  );
  const asksWithoutRevision = facts.asks.filter(
    (row) => !facts.revisions.some((revision) => revision.ask_id === row.id),
  );
  if (
    facts.counts.audit_event < 1 ||
    badDigests.length > 0 ||
    asksWithoutRevision.length > 0
  ) {
    fail(
      "audit_and_verbatim_digest",
      `expected audit rows and a recomputable SHA-256 for every ask's words, found ${facts.counts.audit_event} audit row(s), ${badDigests.length} bad digest(s), ${asksWithoutRevision.length} ask(s) without a revision`,
    );
  }

  return failures;
}

async function applyFault(
  db: SeedDb,
  fault: DemoResetFault | null | undefined,
): Promise<void> {
  if (!fault) return;

  if (fault === "church") {
    // A test-only fault: rename the church after the seed. Verification must
    // notice and the endpoint must refuse to report success.
    await db.$client`
      UPDATE church SET name = 'Tampered Church' WHERE id = ${seedChurch.id}
    `;
    return;
  }

  if (fault === "demo") {
    // Withdraw the demo companion place after publishing it. The board would
    // no longer be demo-ready, and the endpoint must say so.
    await db.$client`
      UPDATE slot
         SET status = 'draft', approved_at = NULL, approved_by = NULL
       WHERE id = ${DEMO_IDS.slotCompanion}
    `;
  }
}

/**
 * Move the four seeded Respite Mornings onto the next four Tuesdays from `now`.
 *
 * `seedSessions` is pinned to a reference date so the baseline fixture is
 * deterministic, but a demo reset must always show a future calendar: after
 * the first seeded Tuesday has passed, the reset would find three future
 * sessions and fail its own seventh assertion. The ids, weekday, and wall time
 * stay the same, so the companion slot keeps pointing at the same session.
 */
async function rollSessionsForward(db: SeedDb, now: Date): Promise<void> {
  const occurrences = nextOccurrences(
    seedSessionTemplate,
    now,
    seedChurch.timezone,
    4,
  );
  if (occurrences.length !== 4) {
    throw new Error(
      "The demo reset could not place four future Respite Mornings from the weekly template.",
    );
  }

  // Delete then insert, not four UPDATEs: the unique (template_id, starts_at)
  // index rejects a transient collision while one row still holds a date a
  // later row is about to take. Nothing references a session before the demo
  // asks and slots are written, so the ids can be reused safely.
  await db
    .delete(session)
    .where(inArray(session.id, [...seedIds.sessions]));
  await db.insert(session).values(
    occurrences.map((occurrence, index) => ({
      id: seedIds.sessions[index],
      churchId: seedChurch.id,
      templateId: seedSessionTemplate.id,
      startsAt: occurrence.startsAt,
      endsAt: occurrence.endsAt,
      capacity: seedSessionTemplate.capacity,
      status: "scheduled" as const,
    })),
  );
}

/**
 * Wipe, reseed, write the demo-ready rows, verify twelve assertions, and return
 * a stable digest. The caller (CLI or route) reports success only when `ok`.
 *
 * `decisionMode` defaults to `RC_DEMO_LIVE_AI`: with it on, the four asks are
 * decided through the same `decide()` + `persistDecisionRun()` path as intake,
 * and the result names the engine behind each ask. Off, or with a provider
 * that is absent, erroring, or answering against the demo's prepared
 * structure, the labelled rules engine completes the run. No assertion and no
 * part of the seed digest depends on which engine answered.
 */
export async function runDemoReset(
  db: SeedDb,
  options: DemoResetOptions = {},
): Promise<DemoResetResult> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const mode: DemoDecisionMode =
    options.decisionMode ?? (isDemoLiveAiEnabled(env) ? "live" : "rules");

  await resetDemoDatabase(db);
  // The demo calendar must move with the wall clock; the seeded fixture cannot.
  await rollSessionsForward(db, now);
  const demo = await seedDemoState(db, {
    now,
    writeDecisions: mode === "rules",
  });

  let outcomes: Array<{
    askId: string;
    fallbackReason: DemoAskEngine["fallbackReason"];
  }> = [];
  if (mode === "live") {
    try {
      const decided = await decideDemoAsks({
        database: db,
        provider: options.provider,
        env,
        timeoutMs: options.liveTimeoutMs,
        budgetMs: options.liveBudgetMs,
      });
      outcomes = decided.outcomes;
    } catch {
      // decide() and persistDecisionRun() are already total. This guard only
      // covers a programming error: the verification below will report the
      // missing answers instead of the reset claiming a state it did not write.
      outcomes = [];
    }
  }

  await applyFault(db, options.fault);

  const baseVerification = await verifySeed(db);
  const facts = await readFacts(db);
  const failures: DemoAssertionFailure[] = [];

  if (!baseVerification.ok) {
    for (const message of baseVerification.failures) {
      failures.push({ id: "seed_cast", message });
    }
  }

  failures.push(...verifyFacts(facts, { now, demo }));

  const failedIds = Array.from(new Set(failures.map((failure) => failure.id)));
  const assertFailed = failures.filter(
    (failure) => failure.id !== "seed_cast",
  ).length;
  const passed = DEMO_ASSERTION_IDS.length - assertFailed;
  const ok = failures.length === 0;
  const church = facts.churches[0]?.name ?? seedChurch.name;

  return {
    ok,
    church,
    counts: facts.counts,
    seedDigest: ok ? buildSeedDigest(facts) : null,
    assertions: {
      passed,
      total: DEMO_ASSERTION_IDS.length,
      failed: failedIds,
    },
    failures,
    engines: summariseDecisionEngines(facts, outcomes),
    mode,
  };
}

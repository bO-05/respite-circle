import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Respite Circle schema — architecture.md §5.
 *
 * Invariants that must never drift are enforced by the database (see the
 * custom migration in `drizzle/`): verbatim text immutability, append-only
 * ask revisions, decisions, absence proofs and audit events, the notification
 * quota and the "no message for an uncovered slot" rule.
 *
 * There is deliberately no diagnosis, medication, or clinical column anywhere.
 */

// ---------------------------------------------------------------------------
// Closed value sets (pgEnum, never free text)
// ---------------------------------------------------------------------------

export const askStatusEnum = pgEnum("ask_status", [
  "draft",
  "waiting_coordinator",
  "safety_hold",
  "care_hold",
  "approved",
  "sent_back",
  "closed",
  "withdrawn",
]);

export const slotStatusEnum = pgEnum("slot_status", [
  "draft",
  "open",
  "claimed",
  "covered",
  "done",
  "cancelled",
  "expired_unclaimed",
]);

export const slotKindEnum = pgEnum("slot_kind", [
  "companion",
  "home",
  "drive",
  "meal",
  "errand",
]);

export const slotTierEnum = pgEnum("slot_tier", [
  "public_event",
  "in_home",
  "transport",
  "doorstep",
]);

export const notificationKindEnum = pgEnum("notification_kind", [
  "confirmation",
  "reminder",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "queued",
  "sent",
]);

export const callOutcomeEnum = pgEnum("call_outcome", [
  "reached",
  "left_message",
  "try_later",
  "caregiver_withdrew",
  "coordinator_will_cover",
]);

export const ruleCodeEnum = pgEnum("rule_code", [
  "eligible",
  "no_checklist",
  "checklist_expired",
  "not_familiar",
  "unavailable_window",
  "already_serving_twice",
  "no_driver_policy",
  "driver_not_ok",
  "recipient_not_eligible",
]);

export const answerTypeEnum = pgEnum("answer_type", ["yesno", "pick"]);

/**
 * The rule that produced a draft slot. `manual` is a coordinator addition; the
 * rest name the typed answer(s) plain code read. Stored as a closed enum so an
 * unexpected string can never reach a page.
 */
export const slotRuleRefEnum = pgEnum("slot_rule_ref", [
  "q1_companion",
  "q6_home",
  "q2_drive",
  "q3_meal",
  "manual",
]);

export const sessionStatusEnum = pgEnum("session_status", [
  "scheduled",
  "completed",
  "cancelled",
]);

export const actorTypeEnum = pgEnum("actor_type", ["ai", "human", "system"]);

// ---------------------------------------------------------------------------
// Shared JSON shapes (types only; the database stores jsonb)
// ---------------------------------------------------------------------------

export type PolicyQuestion = {
  id: string;
  key: string;
  text: string;
  answerType: (typeof answerTypeEnum.enumValues)[number];
  samples?: number;
  options?: string[];
};

export type ReferralResource = {
  name: string;
  detail: string;
  phone?: string;
  url?: string;
};

export type AuditDetail = Record<string, unknown>;

// ---------------------------------------------------------------------------
// church — one fictional congregation
// ---------------------------------------------------------------------------

export const church = pgTable("church", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/New_York"),
  demoMode: boolean("demo_mode").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// policy — append-only versions; never UPDATE a row
// ---------------------------------------------------------------------------

export const policy = pgTable(
  "policy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => church.id),
    version: integer("version").notNull(),
    safeguardingPromises: jsonb("safeguarding_promises")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    questionSet: jsonb("question_set")
      .$type<PolicyQuestion[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    crisisScript: text("crisis_script").notNull(),
    /** The church's own local crisis line; shown beside the crisis script. */
    localCrisisLine: text("local_crisis_line"),
    referralResources: jsonb("referral_resources")
      .$type<ReferralResource[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    familiarFaceDefault: boolean("familiar_face_default")
      .notNull()
      .default(true),
    /** Hours before a covered slot when its one reminder may be written. */
    reminderWindowHours: integer("reminder_window_hours")
      .notNull()
      .default(24),
    /** Hours before a slot window when the coverage watch starts. */
    callThresholdHours: integer("call_threshold_hours").notNull().default(48),
    /**
     * True only when the church has signed its volunteer-driver policy. A
     * drive slot is never proposed or added while this is false; the seed
     * default is false because transport imports liability the group model
     * deliberately avoids.
     */
    transportEnabled: boolean("transport_enabled").notNull().default(false),
    autoPublishLowRisk: boolean("auto_publish_low_risk")
      .notNull()
      .default(false),
    signedOffBy: text("signed_off_by"),
    signedOffAt: timestamp("signed_off_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("policy_church_version_uidx").on(t.churchId, t.version),
    check("policy_version_positive", sql`${t.version} >= 1`),
    check(
      "policy_reminder_window_positive",
      sql`${t.reminderWindowHours} >= 1`,
    ),
    check(
      "policy_call_threshold_positive",
      sql`${t.callThresholdHours} >= 1`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// person — caregivers, coordinators, volunteers, deputies
// ---------------------------------------------------------------------------

export const person = pgTable(
  "person",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => church.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    roles: jsonb("roles")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    accessToken: text("access_token").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("person_access_token_uidx").on(t.accessToken),
    index("person_church_idx").on(t.churchId),
    check("person_roles_is_array", sql`jsonb_typeof(${t.roles}) = 'array'`),
  ],
);

// ---------------------------------------------------------------------------
// caregiver — a family member who asks for a break
// ---------------------------------------------------------------------------

export const caregiver = pgTable("caregiver", {
  personId: uuid("person_id")
    .primaryKey()
    .references(() => person.id),
  phoneNote: text("phone_note"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// care_recipient — the person cared for. Relation only; no diagnosis, ever.
// ---------------------------------------------------------------------------

export const careRecipient = pgTable(
  "care_recipient",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => church.id),
    firstName: text("first_name").notNull(),
    relation: text("relation").notNull(),
    createdByCaregiverId: uuid("created_by_caregiver_id")
      .notNull()
      .references(() => caregiver.personId),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("care_recipient_church_idx").on(t.churchId)],
);

// ---------------------------------------------------------------------------
// ask — the caregiver's own words, stored verbatim and never edited
// ---------------------------------------------------------------------------

export const ask = pgTable(
  "ask",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => church.id),
    caregiverId: uuid("caregiver_id")
      .notNull()
      .references(() => caregiver.personId),
    careRecipientId: uuid("care_recipient_id")
      .notNull()
      .references(() => careRecipient.id),
    verbatimText: text("verbatim_text").notNull(),
    language: text("language").notNull().default("en"),
    status: askStatusEnum("status").notNull().default("draft"),
    policyVersionId: uuid("policy_version_id")
      .notNull()
      .references(() => policy.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /**
     * Set once, atomically, when plain code turns the typed answers into draft
     * slots. It is the idempotence marker: a coordinator who removes every
     * draft must not see them reappear on the next read.
     */
    slotsConstructedAt: timestamp("slots_constructed_at", {
      withTimezone: true,
      mode: "date",
    }),
    /**
     * Who approved the ask and when. The same actor is copied onto every slot
     * that approval published, so the congregation board can show a visible
     * "Approved — Grace, time" line without ever reading the caregiver's story.
     */
    approvedBy: uuid("approved_by").references(() => person.id),
    approvedAt: timestamp("approved_at", {
      withTimezone: true,
      mode: "date",
    }),
    /**
     * The human note on a send-back. It is stored exactly as typed (the
     * repository refuses an empty note and never trims it), and the caregiver's
     * receipt renders it character-for-character. Nothing is published.
     */
    sendBackNote: text("send_back_note"),
    sentBackBy: uuid("sent_back_by").references(() => person.id),
    sentBackAt: timestamp("sent_back_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (t) => [
    index("ask_church_status_idx").on(t.churchId, t.status),
    index("ask_caregiver_idx").on(t.caregiverId),
  ],
);

// ---------------------------------------------------------------------------
// ask_revision — an edit creates a new row; the original is never changed
// ---------------------------------------------------------------------------

export const askRevision = pgTable(
  "ask_revision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    askId: uuid("ask_id")
      .notNull()
      .references(() => ask.id),
    verbatimText: text("verbatim_text").notNull(),
    digest: text("digest").notNull(),
    supersedesId: uuid("supersedes_id").references(
      (): AnyPgColumn => askRevision.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ask_revision_ask_idx").on(t.askId)],
);

// ---------------------------------------------------------------------------
// decision — one typed answer per row. Raw ask text is never copied here.
// ---------------------------------------------------------------------------

export const decision = pgTable(
  "decision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    askId: uuid("ask_id")
      .notNull()
      .references(() => ask.id),
    /**
     * The exact wording these answers were given. A caregiver revision appends a
     * new `ask_revision` and re-runs the nine questions; the trail reads only the
     * rows for the latest revision, so an answer can never describe words that
     * have since been replaced.
     */
    askRevisionId: uuid("ask_revision_id")
      .notNull()
      .references(() => askRevision.id),
    policyVersionId: uuid("policy_version_id")
      .notNull()
      .references(() => policy.id),
    questionId: text("question_id").notNull(),
    questionText: text("question_text").notNull(),
    answerType: answerTypeEnum("answer_type").notNull(),
    answer: jsonb("answer").$type<boolean | string>().notNull(),
    confidence: real("confidence").notNull(),
    abstained: boolean("abstained").notNull().default(false),
    samples: integer("samples"),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    latencyMs: integer("latency_ms"),
    digest: text("digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("decision_ask_idx").on(t.askId),
    index("decision_revision_idx").on(t.askRevisionId),
    check(
      "decision_confidence_range",
      sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// session_template / session — Respite Morning, materialised four ahead
// ---------------------------------------------------------------------------

export const sessionTemplate = pgTable("session_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  churchId: uuid("church_id")
    .notNull()
    .references(() => church.id),
  weekday: integer("weekday").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  capacity: integer("capacity").notNull().default(12),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => church.id),
    templateId: uuid("template_id")
      .notNull()
      .references(() => sessionTemplate.id),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    capacity: integer("capacity").notNull().default(12),
    status: sessionStatusEnum("status").notNull().default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("session_template_starts_uidx").on(t.templateId, t.startsAt),
    check("session_ends_after_starts", sql`${t.endsAt} > ${t.startsAt}`),
    index("session_starts_idx").on(t.startsAt),
  ],
);

// ---------------------------------------------------------------------------
// volunteer — screening context for gating. Never a diagnosis.
// ---------------------------------------------------------------------------

export const volunteer = pgTable(
  "volunteer",
  {
    personId: uuid("person_id")
      .primaryKey()
      .references(() => person.id),
    driverOk: boolean("driver_ok").notNull().default(false),
    checklistCompletedAt: timestamp("checklist_completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    checklistVersion: text("checklist_version"),
    referencesContacted: integer("references_contacted").notNull().default(0),
    trainingExpiresOn: date("training_expires_on"),
    backgroundRenewsOn: date("background_renews_on"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "volunteer_references_non_negative",
      sql`${t.referencesContacted} >= 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// familiar_face — coordinator-attested, never inferred
// ---------------------------------------------------------------------------

export const familiarFace = pgTable(
  "familiar_face",
  {
    volunteerId: uuid("volunteer_id")
      .notNull()
      .references(() => volunteer.personId),
    careRecipientId: uuid("care_recipient_id")
      .notNull()
      .references(() => careRecipient.id),
    attestedBy: uuid("attested_by")
      .notNull()
      .references(() => person.id),
    attestedAt: timestamp("attested_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    primaryKey({ columns: [t.volunteerId, t.careRecipientId] }),
    index("familiar_face_recipient_idx").on(t.careRecipientId),
  ],
);

// ---------------------------------------------------------------------------
// slot — a claimable place. Only approved asks become open slots.
// ---------------------------------------------------------------------------

export const slot = pgTable(
  "slot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    askId: uuid("ask_id")
      .notNull()
      .references(() => ask.id),
    churchId: uuid("church_id")
      .notNull()
      .references(() => church.id),
    sessionId: uuid("session_id").references(() => session.id),
    kind: slotKindEnum("kind").notNull(),
    tier: slotTierEnum("tier").notNull(),
    label: text("label").notNull(),
    windowStart: timestamp("window_start", {
      withTimezone: true,
      mode: "date",
    }),
    windowEnd: timestamp("window_end", {
      withTimezone: true,
      mode: "date",
    }),
    gated: boolean("gated").notNull().default(false),
    orientationNote: text("orientation_note"),
    /** The rule that produced this draft; `manual` for a coordinator addition. */
    ruleRef: slotRuleRefEnum("rule_ref").notNull().default("manual"),
    /**
     * A hold is a coordinator's deliberate "not yet". A held draft cannot be
     * published until the reason is cleared; the reason is kept with the row
     * and every change is written to the append-only audit log.
     */
    holdReason: text("hold_reason"),
    heldAt: timestamp("held_at", { withTimezone: true, mode: "date" }),
    heldBy: uuid("held_by").references(() => person.id),
    status: slotStatusEnum("status").notNull().default("draft"),
    claimedBy: uuid("claimed_by").references(() => volunteer.personId),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    /**
     * Publication approval: the desk published this time to the board.
     * Never reused for a claim.
     */
    approvedBy: uuid("approved_by").references(() => person.id),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    /**
     * Claim confirmation: a second, later human decision that covers the
     * neighbour who said yes. Distinct columns on purpose, so confirming a
     * claim never rewrites the publication trail the board shows.
     */
    claimConfirmedBy: uuid("claim_confirmed_by").references(() => person.id),
    claimConfirmedAt: timestamp("claim_confirmed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("slot_church_status_idx").on(t.churchId, t.status),
    index("slot_ask_idx").on(t.askId),
    index("slot_session_idx").on(t.sessionId),
    check(
      "slot_window_ordered",
      sql`${t.windowStart} IS NULL OR ${t.windowEnd} IS NULL OR ${t.windowEnd} > ${t.windowStart}`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// slot_candidate — written for every volunteer considered, eligible or not
// ---------------------------------------------------------------------------

export const slotCandidate = pgTable(
  "slot_candidate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => slot.id),
    volunteerId: uuid("volunteer_id")
      .notNull()
      .references(() => volunteer.personId),
    eligible: boolean("eligible").notNull(),
    ruleCode: ruleCodeEnum("rule_code").notNull(),
    fixHint: text("fix_hint"),
    owner: text("owner"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("slot_candidate_slot_idx").on(t.slotId),
    /**
     * One explanation per volunteer per slot. Re-evaluation upserts this row
     * rather than appending, so the panel can never show the same person twice
     * and two concurrent evaluations cannot duplicate a candidate.
     */
    uniqueIndex("slot_candidate_slot_volunteer_uidx").on(
      t.slotId,
      t.volunteerId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// notification — at most one confirmation and one reminder per covered slot
// ---------------------------------------------------------------------------

export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => church.id),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => slot.id),
    caregiverId: uuid("caregiver_id")
      .notNull()
      .references(() => caregiver.personId),
    kind: notificationKindEnum("kind").notNull(),
    templateCode: text("template_code").notNull(),
    body: text("body").notNull(),
    status: notificationStatusEnum("status").notNull().default("queued"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("notification_slot_kind_uidx")
      .on(t.slotId, t.kind)
      .where(sql`${t.kind} in ('confirmation', 'reminder')`),
    index("notification_caregiver_idx").on(t.caregiverId),
  ],
);

// ---------------------------------------------------------------------------
// call_log — the human call is the product's proof, not a fallback UI
// ---------------------------------------------------------------------------

export const callLog = pgTable(
  "call_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => slot.id),
    coordinatorId: uuid("coordinator_id")
      .notNull()
      .references(() => person.id),
    outcome: callOutcomeEnum("outcome").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("call_log_slot_idx").on(t.slotId)],
);

// ---------------------------------------------------------------------------
// absence_proof — written when a slot expires unclaimed. Count must be zero.
// ---------------------------------------------------------------------------

export const absenceProof = pgTable(
  "absence_proof",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => slot.id),
    caregiverOutboxCount: integer("caregiver_outbox_count").notNull(),
    queryText: text("query_text").notNull(),
    digest: text("digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("absence_proof_slot_idx").on(t.slotId),
    check(
      "absence_proof_zero_outbox",
      sql`${t.caregiverOutboxCount} = 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// audit_event — append-only, AI and human actions alike
// ---------------------------------------------------------------------------

export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => church.id),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    detail: jsonb("detail")
      .$type<AuditDetail>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_event_church_created_idx").on(t.churchId, t.createdAt),
    index("audit_event_entity_idx").on(t.entity, t.entityId),
  ],
);

// ---------------------------------------------------------------------------
// invite — a named invitation, written by a person
// ---------------------------------------------------------------------------

export const invite = pgTable(
  "invite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .notNull()
      .references(() => church.id),
    caregiverId: uuid("caregiver_id")
      .notNull()
      .references(() => caregiver.personId),
    body: text("body").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    seenAt: timestamp("seen_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("invite_caregiver_idx").on(t.caregiverId)],
);

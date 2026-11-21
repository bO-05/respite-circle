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
    referralResources: jsonb("referral_resources")
      .$type<ReferralResource[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    familiarFaceDefault: boolean("familiar_face_default")
      .notNull()
      .default(true),
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
    status: slotStatusEnum("status").notNull().default("draft"),
    claimedBy: uuid("claimed_by").references(() => volunteer.personId),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    approvedBy: uuid("approved_by").references(() => person.id),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
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
  (t) => [index("slot_candidate_slot_idx").on(t.slotId)],
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

CREATE TYPE "public"."actor_type" AS ENUM('ai', 'human', 'system');--> statement-breakpoint
CREATE TYPE "public"."answer_type" AS ENUM('yesno', 'pick');--> statement-breakpoint
CREATE TYPE "public"."ask_status" AS ENUM('draft', 'waiting_coordinator', 'safety_hold', 'care_hold', 'approved', 'sent_back', 'closed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('reached', 'left_message', 'try_later', 'caregiver_withdrew', 'coordinator_will_cover');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('confirmation', 'reminder');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent');--> statement-breakpoint
CREATE TYPE "public"."rule_code" AS ENUM('eligible', 'no_checklist', 'checklist_expired', 'not_familiar', 'unavailable_window', 'already_serving_twice', 'no_driver_policy', 'driver_not_ok', 'recipient_not_eligible');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('scheduled', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."slot_kind" AS ENUM('companion', 'home', 'drive', 'meal', 'errand');--> statement-breakpoint
CREATE TYPE "public"."slot_status" AS ENUM('draft', 'open', 'claimed', 'covered', 'done', 'cancelled', 'expired_unclaimed');--> statement-breakpoint
CREATE TYPE "public"."slot_tier" AS ENUM('public_event', 'in_home', 'transport', 'doorstep');--> statement-breakpoint
CREATE TABLE "absence_proof" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"caregiver_outbox_count" integer NOT NULL,
	"query_text" text NOT NULL,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "absence_proof_zero_outbox" CHECK ("absence_proof"."caregiver_outbox_count" = 0)
);
--> statement-breakpoint
CREATE TABLE "ask" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"caregiver_id" uuid NOT NULL,
	"care_recipient_id" uuid NOT NULL,
	"verbatim_text" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"status" "ask_status" DEFAULT 'draft' NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ask_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ask_id" uuid NOT NULL,
	"verbatim_text" text NOT NULL,
	"digest" text NOT NULL,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"coordinator_id" uuid NOT NULL,
	"outcome" "call_outcome" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"relation" text NOT NULL,
	"created_by_caregiver_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caregiver" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"phone_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "church" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"demo_mode" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ask_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"question_text" text NOT NULL,
	"answer_type" "answer_type" NOT NULL,
	"answer" jsonb NOT NULL,
	"confidence" real NOT NULL,
	"abstained" boolean DEFAULT false NOT NULL,
	"samples" integer,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"latency_ms" integer,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_confidence_range" CHECK ("decision"."confidence" >= 0 AND "decision"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "familiar_face" (
	"volunteer_id" uuid NOT NULL,
	"care_recipient_id" uuid NOT NULL,
	"attested_by" uuid NOT NULL,
	"attested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "familiar_face_volunteer_id_care_recipient_id_pk" PRIMARY KEY("volunteer_id","care_recipient_id")
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"caregiver_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"caregiver_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"template_code" text NOT NULL,
	"body" text NOT NULL,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"access_token" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_roles_is_array" CHECK (jsonb_typeof("person"."roles") = 'array')
);
--> statement-breakpoint
CREATE TABLE "policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"safeguarding_promises" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"question_set" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"crisis_script" text NOT NULL,
	"referral_resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"familiar_face_default" boolean DEFAULT true NOT NULL,
	"auto_publish_low_risk" boolean DEFAULT false NOT NULL,
	"signed_off_by" text,
	"signed_off_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_version_positive" CHECK ("policy"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer DEFAULT 12 NOT NULL,
	"status" "session_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_ends_after_starts" CHECK ("session"."ends_at" > "session"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "session_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"capacity" integer DEFAULT 12 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ask_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" "slot_kind" NOT NULL,
	"tier" "slot_tier" NOT NULL,
	"label" text NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"gated" boolean DEFAULT false NOT NULL,
	"orientation_note" text,
	"status" "slot_status" DEFAULT 'draft' NOT NULL,
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slot_window_ordered" CHECK ("slot"."window_start" IS NULL OR "slot"."window_end" IS NULL OR "slot"."window_end" > "slot"."window_start")
);
--> statement-breakpoint
CREATE TABLE "slot_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"eligible" boolean NOT NULL,
	"rule_code" "rule_code" NOT NULL,
	"fix_hint" text,
	"owner" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "volunteer" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"driver_ok" boolean DEFAULT false NOT NULL,
	"checklist_completed_at" timestamp with time zone,
	"checklist_version" text,
	"references_contacted" integer DEFAULT 0 NOT NULL,
	"training_expires_on" date,
	"background_renews_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_references_non_negative" CHECK ("volunteer"."references_contacted" >= 0)
);
--> statement-breakpoint
ALTER TABLE "absence_proof" ADD CONSTRAINT "absence_proof_slot_id_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask" ADD CONSTRAINT "ask_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask" ADD CONSTRAINT "ask_caregiver_id_caregiver_person_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregiver"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask" ADD CONSTRAINT "ask_care_recipient_id_care_recipient_id_fk" FOREIGN KEY ("care_recipient_id") REFERENCES "public"."care_recipient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask" ADD CONSTRAINT "ask_policy_version_id_policy_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_revision" ADD CONSTRAINT "ask_revision_ask_id_ask_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."ask"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_revision" ADD CONSTRAINT "ask_revision_supersedes_id_ask_revision_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."ask_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_slot_id_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_log" ADD CONSTRAINT "call_log_coordinator_id_person_id_fk" FOREIGN KEY ("coordinator_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_recipient" ADD CONSTRAINT "care_recipient_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_recipient" ADD CONSTRAINT "care_recipient_created_by_caregiver_id_caregiver_person_id_fk" FOREIGN KEY ("created_by_caregiver_id") REFERENCES "public"."caregiver"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caregiver" ADD CONSTRAINT "caregiver_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_ask_id_ask_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."ask"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_policy_version_id_policy_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "familiar_face" ADD CONSTRAINT "familiar_face_volunteer_id_volunteer_person_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteer"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "familiar_face" ADD CONSTRAINT "familiar_face_care_recipient_id_care_recipient_id_fk" FOREIGN KEY ("care_recipient_id") REFERENCES "public"."care_recipient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "familiar_face" ADD CONSTRAINT "familiar_face_attested_by_person_id_fk" FOREIGN KEY ("attested_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_caregiver_id_caregiver_person_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregiver"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_slot_id_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_caregiver_id_caregiver_person_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."caregiver"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy" ADD CONSTRAINT "policy_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_template_id_session_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."session_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_template" ADD CONSTRAINT "session_template_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot" ADD CONSTRAINT "slot_ask_id_ask_id_fk" FOREIGN KEY ("ask_id") REFERENCES "public"."ask"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot" ADD CONSTRAINT "slot_church_id_church_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."church"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot" ADD CONSTRAINT "slot_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot" ADD CONSTRAINT "slot_claimed_by_volunteer_person_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."volunteer"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot" ADD CONSTRAINT "slot_approved_by_person_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_candidate" ADD CONSTRAINT "slot_candidate_slot_id_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_candidate" ADD CONSTRAINT "slot_candidate_volunteer_id_volunteer_person_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."volunteer"("person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer" ADD CONSTRAINT "volunteer_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "absence_proof_slot_idx" ON "absence_proof" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "ask_church_status_idx" ON "ask" USING btree ("church_id","status");--> statement-breakpoint
CREATE INDEX "ask_caregiver_idx" ON "ask" USING btree ("caregiver_id");--> statement-breakpoint
CREATE INDEX "ask_revision_ask_idx" ON "ask_revision" USING btree ("ask_id");--> statement-breakpoint
CREATE INDEX "audit_event_church_created_idx" ON "audit_event" USING btree ("church_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_event_entity_idx" ON "audit_event" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "call_log_slot_idx" ON "call_log" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "care_recipient_church_idx" ON "care_recipient" USING btree ("church_id");--> statement-breakpoint
CREATE INDEX "decision_ask_idx" ON "decision" USING btree ("ask_id");--> statement-breakpoint
CREATE INDEX "familiar_face_recipient_idx" ON "familiar_face" USING btree ("care_recipient_id");--> statement-breakpoint
CREATE INDEX "invite_caregiver_idx" ON "invite" USING btree ("caregiver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_slot_kind_uidx" ON "notification" USING btree ("slot_id","kind") WHERE "notification"."kind" in ('confirmation', 'reminder');--> statement-breakpoint
CREATE INDEX "notification_caregiver_idx" ON "notification" USING btree ("caregiver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_access_token_uidx" ON "person" USING btree ("access_token");--> statement-breakpoint
CREATE INDEX "person_church_idx" ON "person" USING btree ("church_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_church_version_uidx" ON "policy" USING btree ("church_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "session_template_starts_uidx" ON "session" USING btree ("template_id","starts_at");--> statement-breakpoint
CREATE INDEX "session_starts_idx" ON "session" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "slot_church_status_idx" ON "slot" USING btree ("church_id","status");--> statement-breakpoint
CREATE INDEX "slot_ask_idx" ON "slot" USING btree ("ask_id");--> statement-breakpoint
CREATE INDEX "slot_session_idx" ON "slot" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "slot_candidate_slot_idx" ON "slot_candidate" USING btree ("slot_id");
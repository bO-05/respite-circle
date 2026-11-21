ALTER TABLE "policy" ADD COLUMN "local_crisis_line" text;--> statement-breakpoint
ALTER TABLE "policy" ADD COLUMN "reminder_window_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "policy" ADD COLUMN "call_threshold_hours" integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "policy" ADD CONSTRAINT "policy_reminder_window_positive" CHECK ("policy"."reminder_window_hours" >= 1);--> statement-breakpoint
ALTER TABLE "policy" ADD CONSTRAINT "policy_call_threshold_positive" CHECK ("policy"."call_threshold_hours" >= 1);
CREATE TYPE "public"."slot_rule_ref" AS ENUM('q1_companion', 'q6_home', 'q2_drive', 'q3_meal', 'manual');--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN "slots_constructed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "policy" ADD COLUMN "transport_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "slot" ADD COLUMN "rule_ref" "slot_rule_ref" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "slot" ADD COLUMN "hold_reason" text;--> statement-breakpoint
ALTER TABLE "slot" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "slot" ADD COLUMN "held_by" uuid;--> statement-breakpoint
ALTER TABLE "slot" ADD CONSTRAINT "slot_held_by_person_id_fk" FOREIGN KEY ("held_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
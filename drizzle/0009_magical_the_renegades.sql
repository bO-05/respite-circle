ALTER TABLE "ask" ADD COLUMN "safety_override_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN "safety_override_by" uuid;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN "safety_override_reason" text;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN "close_note" text;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ask" ADD CONSTRAINT "ask_safety_override_by_person_id_fk" FOREIGN KEY ("safety_override_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask" ADD CONSTRAINT "ask_closed_by_person_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask" ADD CONSTRAINT "ask_safety_override_complete" CHECK (("ask"."safety_override_at" IS NULL AND "ask"."safety_override_by" IS NULL AND "ask"."safety_override_reason" IS NULL) OR ("ask"."safety_override_at" IS NOT NULL AND "ask"."safety_override_by" IS NOT NULL AND "ask"."safety_override_reason" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "ask" ADD CONSTRAINT "ask_close_note_complete" CHECK (("ask"."closed_at" IS NULL AND "ask"."closed_by" IS NULL AND "ask"."close_note" IS NULL) OR ("ask"."closed_at" IS NOT NULL AND "ask"."closed_by" IS NOT NULL AND "ask"."close_note" IS NOT NULL));
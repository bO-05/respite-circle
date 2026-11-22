ALTER TABLE "ask" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN "send_back_note" text;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN "sent_back_by" uuid;--> statement-breakpoint
ALTER TABLE "ask" ADD COLUMN "sent_back_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ask" ADD CONSTRAINT "ask_approved_by_person_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask" ADD CONSTRAINT "ask_sent_back_by_person_id_fk" FOREIGN KEY ("sent_back_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
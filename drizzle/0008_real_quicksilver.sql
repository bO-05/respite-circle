ALTER TABLE "slot" ADD COLUMN "claim_confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "slot" ADD COLUMN "claim_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "slot" ADD CONSTRAINT "slot_claim_confirmed_by_person_id_fk" FOREIGN KEY ("claim_confirmed_by") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;
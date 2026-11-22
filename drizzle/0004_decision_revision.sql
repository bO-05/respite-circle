ALTER TABLE "decision" ADD COLUMN "ask_revision_id" uuid;--> statement-breakpoint

-- The append-only trigger protects runtime history, not this one-time
-- backfill. The disable is transactional: any failure rolls the migration back
-- with the trigger still enabled.
ALTER TABLE "decision" DISABLE TRIGGER "decision_immutable";--> statement-breakpoint

-- Every decision belongs to the exact wording it answered. Rows written before
-- this column existed answered the ask's first revision, so backfill them from
-- the earliest revision of the same ask.
UPDATE "decision" AS d
   SET "ask_revision_id" = (
     SELECT r."id"
       FROM "ask_revision" r
      WHERE r."ask_id" = d."ask_id"
      ORDER BY r."created_at" ASC, r."id" ASC
      LIMIT 1
   )
 WHERE d."ask_revision_id" IS NULL;--> statement-breakpoint

-- A decision can only exist for an ask that went through intake, and intake
-- always writes a first revision. Repair the impossible legacy state anyway,
-- using the stored original words, so the NOT NULL step never fails silently.
INSERT INTO "ask_revision" ("ask_id", "verbatim_text", "digest", "supersedes_id", "created_at")
SELECT a."id",
       a."verbatim_text",
       encode(sha256(convert_to(a."verbatim_text", 'UTF8')), 'hex'),
       NULL,
       a."created_at"
  FROM "ask" a
 WHERE EXISTS (
         SELECT 1 FROM "decision" d
          WHERE d."ask_id" = a."id" AND d."ask_revision_id" IS NULL
       )
   AND NOT EXISTS (
         SELECT 1 FROM "ask_revision" r WHERE r."ask_id" = a."id"
       );--> statement-breakpoint

UPDATE "decision" AS d
   SET "ask_revision_id" = (
     SELECT r."id"
       FROM "ask_revision" r
      WHERE r."ask_id" = d."ask_id"
      ORDER BY r."created_at" ASC, r."id" ASC
      LIMIT 1
   )
 WHERE d."ask_revision_id" IS NULL;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "decision" WHERE "ask_revision_id" IS NULL) THEN
    RAISE EXCEPTION 'decision rows exist without an ask_revision; resolve before migrating';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "decision" ENABLE TRIGGER "decision_immutable";--> statement-breakpoint
ALTER TABLE "decision" ALTER COLUMN "ask_revision_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_ask_revision_id_ask_revision_id_fk" FOREIGN KEY ("ask_revision_id") REFERENCES "public"."ask_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_revision_idx" ON "decision" USING btree ("ask_revision_id");

CREATE TABLE IF NOT EXISTS "top3_selection_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"revision" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"policy_version" text NOT NULL,
	"available" boolean NOT NULL,
	"sources" jsonb NOT NULL,
	"inputs" jsonb NOT NULL,
	"selections" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'top3_selection_revisions_session_id_screener_sessions_id_fk'
      AND conrelid = 'top3_selection_revisions'::regclass
  ) THEN
    ALTER TABLE "top3_selection_revisions"
      ADD CONSTRAINT "top3_selection_revisions_session_id_screener_sessions_id_fk"
      FOREIGN KEY ("session_id") REFERENCES "public"."screener_sessions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "top3_selection_revisions_session_revision_uq" ON "top3_selection_revisions" USING btree ("session_id","revision");
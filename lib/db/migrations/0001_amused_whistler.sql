ALTER TABLE "survival_trades" ADD COLUMN IF NOT EXISTS "bought_before_report" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "survival_trades" ADD COLUMN IF NOT EXISTS "source_candidate_id" integer;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'survival_trades_source_candidate_id_candidates_id_fk'
	) THEN
		ALTER TABLE "survival_trades"
			ADD CONSTRAINT "survival_trades_source_candidate_id_candidates_id_fk"
			FOREIGN KEY ("source_candidate_id")
			REFERENCES "public"."candidates"("id")
			ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "survival_trades_source_candidate_unique" ON "survival_trades" USING btree ("source_candidate_id");
ALTER TABLE "screener_sessions" ADD COLUMN IF NOT EXISTS "top3_cutoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "screener_sessions" ADD COLUMN IF NOT EXISTS "top3_cutoff_evaluated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "screener_sessions" ADD COLUMN IF NOT EXISTS "top3_participating_sources" jsonb;
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "earnings_knowledge" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "earnings_observed_at" timestamp with time zone;
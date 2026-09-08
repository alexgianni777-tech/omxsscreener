ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "resolution_method" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "resolution_quality" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "realized_r" real;
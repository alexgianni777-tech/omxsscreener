ALTER TABLE "open_positions" ADD COLUMN IF NOT EXISTS "target_price" real;--> statement-breakpoint
ALTER TABLE "open_positions" ADD COLUMN IF NOT EXISTS "market" text;--> statement-breakpoint
ALTER TABLE "open_positions" ADD COLUMN IF NOT EXISTS "notes" text;
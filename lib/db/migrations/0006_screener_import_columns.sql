ALTER TABLE "screener_sessions"
  ADD COLUMN IF NOT EXISTS "last_import_diff" jsonb;
--> statement-breakpoint
ALTER TABLE "screener_sessions"
  ADD COLUMN IF NOT EXISTS "last_import_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "open_positions"
  ADD COLUMN IF NOT EXISTS "instrument" text;
--> statement-breakpoint
ALTER TABLE "open_positions"
  ADD COLUMN IF NOT EXISTS "last_price" real;
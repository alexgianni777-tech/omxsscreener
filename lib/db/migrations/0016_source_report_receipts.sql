ALTER TABLE "screener_sessions" ADD COLUMN IF NOT EXISTS "source_reports" jsonb NOT NULL DEFAULT '[]'::jsonb;

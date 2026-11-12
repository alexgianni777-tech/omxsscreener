-- Additive and nullable. No historical trading fields or rows are rewritten.
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "data_quality" jsonb;
--> statement-breakpoint
-- Existing schema field omitted by the old journal; managed-schema deployments
-- already have it. This also lets a clean isolated DB run the current model.
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "volume_as_of" date;

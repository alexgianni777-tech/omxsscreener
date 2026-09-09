ALTER TABLE "candidates"
  ADD COLUMN IF NOT EXISTS "signal_source" text;
--> statement-breakpoint
UPDATE "candidates" AS c
SET "signal_source" = CASE
  WHEN s."source" = 'edgeai' THEN 'edgeai'
  WHEN s."source" = 'telegram' THEN 'telegram'
  WHEN s."source" IN ('manual', 'screener') OR s."source" IS NULL THEN 'manual'
  ELSE NULL
END
FROM "screener_sessions" AS s
WHERE c."session_id" = s."id"
  AND c."signal_source" IS NULL
  AND (s."source" IN ('edgeai', 'telegram', 'manual', 'screener') OR s."source" IS NULL);
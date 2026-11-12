ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "resolution_entry_price" real;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "resolution_stop_price" real;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN IF NOT EXISTS "resolution_direction" text;--> statement-breakpoint
ALTER TABLE "survival_trades" ADD COLUMN IF NOT EXISTS "risk_allocation_kr" real;--> statement-breakpoint

-- Capture the plan inputs before any later import can change them. A legacy
-- exit price is usable for arithmetic, but does not prove how the execution
-- was obtained, so its provenance remains explicitly unknown.
UPDATE "candidates"
SET
  "resolution_entry_price" = COALESCE("resolution_entry_price", "entry_price"),
  "resolution_stop_price" = COALESCE("resolution_stop_price", "stop_price"),
  "resolution_direction" = COALESCE("resolution_direction", "direction"),
  "realized_r" = COALESCE(
    "realized_r",
    CASE
      WHEN "exit_price" IS NULL
        OR "entry_price" IS NULL
        OR "stop_price" IS NULL
        OR "direction" NOT IN ('LONG', 'SHORT')
        OR "entry_price" IN ('NaN'::real, 'Infinity'::real, '-Infinity'::real)
        OR "stop_price" IN ('NaN'::real, 'Infinity'::real, '-Infinity'::real)
        OR "exit_price" IN ('NaN'::real, 'Infinity'::real, '-Infinity'::real)
        OR abs("entry_price" - "stop_price") = 0
        OR abs("entry_price" - "stop_price") = 'Infinity'::real
        OR (
          "outcome" = 'WIN'
          AND (
            ("direction" = 'LONG' AND "exit_price" - "entry_price" <= 0)
            OR ("direction" = 'SHORT' AND "entry_price" - "exit_price" <= 0)
          )
        )
        OR (
          "outcome" = 'LOSS'
          AND (
            ("direction" = 'LONG' AND "exit_price" - "entry_price" >= 0)
            OR ("direction" = 'SHORT' AND "entry_price" - "exit_price" >= 0)
          )
        )
      THEN NULL
      WHEN "direction" = 'LONG'
      THEN ("exit_price" - "entry_price") / abs("entry_price" - "stop_price")
      WHEN "direction" = 'SHORT'
      THEN ("entry_price" - "exit_price") / abs("entry_price" - "stop_price")
      ELSE NULL
    END
  ),
  "resolution_quality" = COALESCE("resolution_quality", 'LEGACY_UNKNOWN')
WHERE "outcome" IN ('WIN', 'LOSS');
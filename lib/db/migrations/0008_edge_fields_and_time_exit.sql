ALTER TABLE "candidates"
  ADD COLUMN IF NOT EXISTS "edge_win_rate" real,
  ADD COLUMN IF NOT EXISTS "edge_expectancy_r" real,
  ADD COLUMN IF NOT EXISTS "edge_sample_n" integer,
  ADD COLUMN IF NOT EXISTS "signal_age_bars" integer,
  ADD COLUMN IF NOT EXISTS "max_hold_days" integer;
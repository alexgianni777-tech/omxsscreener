-- Preserve existing saved selections when adding display provenance.
-- New automatic-only selections explicitly write false. No historical rewrite.
ALTER TABLE top3_selection_revisions ADD COLUMN IF NOT EXISTS display_eligible boolean NOT NULL DEFAULT true;
ALTER TABLE top3_selection_snapshots ADD COLUMN IF NOT EXISTS display_eligible boolean NOT NULL DEFAULT true;

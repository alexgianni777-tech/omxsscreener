---
name: EdgeAI candidate mapping is duplicated across two files
description: scheduler.ts (auto-import) and edgeai.ts (manual EdgeAI import) each maintain their own separate mapping from raw EdgeAI setup JSON to candidate DB rows.
---

The scheduled auto-importer (`artifacts/api-server/src/lib/scheduler.ts`) and the manual "Importera från EdgeAI" endpoint (`artifacts/api-server/src/routes/edgeai.ts`) do not share one mapping function. Each independently converts raw EdgeAI setup JSON into the fields written to `candidatesTable`.

**Why:** A rounding/type fix applied to one file's mapping does not propagate to the other. This already caused a real incident: `edgeai.ts` rounded the `rsi` field before insert (it maps to an `integer` Postgres column) but `scheduler.ts` didn't, so the daily auto-import silently rolled back its entire transaction every time a fractional RSI value appeared — invisible until someone checked whether a session existed for that date.

**How to apply:** When fixing a field-mapping, rounding, null-handling, or type-coercion bug in one of these two files, check the same logic in the other file before considering the fix done. Ideally future work should extract a single shared mapping function, but until then, treat any candidate-field bug fix here as needing a duplicate check.

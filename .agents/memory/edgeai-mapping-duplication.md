---
name: EdgeAI candidate mapping — now a single shared module
description: Raw EdgeAI setup JSON → candidate DB row mapping used to be duplicated between scheduler.ts and edgeai.ts; it is now one shared function.
---

**Resolved.** The scheduled auto-importer (`artifacts/api-server/src/lib/scheduler.ts`) and the manual "Importera från EdgeAI" endpoint (`artifacts/api-server/src/routes/edgeai.ts`) both now import `mapEdgeAiCategory()` / `mapEdgeAiSetup()` from the single shared module `artifacts/api-server/src/lib/edgeAiMapping.ts`. Neither file keeps its own copy of the mapping anymore.

**Why this used to matter:** when the mapping was duplicated, a rounding/type fix applied to one file didn't propagate to the other. That caused a real incident — `edgeai.ts` rounded `rsi` before insert (an `integer` column) but `scheduler.ts` didn't, so the daily auto-import silently rolled back every time a fractional RSI value appeared.

**How to apply now:** any change to raw-setup→candidate-row mapping (new field, rounding, null-handling, direction logic) belongs in `edgeAiMapping.ts` only. There is no second copy to keep in sync — if you find yourself editing mapping logic directly inside `scheduler.ts` or `edgeai.ts` again, that's a regression back toward the old duplication; move it into the shared module instead.

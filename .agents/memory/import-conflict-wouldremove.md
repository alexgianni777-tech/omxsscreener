---
name: Import conflict preview includes wouldRemove
description: The 409 session-already-exists conflict response (manual paste import and EdgeAI quick-import) previews still-pending candidates that a force re-import would delete, not just which outcomes it preserves.
---

`synchronizeCandidates` (`artifacts/api-server/src/lib/candidateSynchronization.ts`) only ever deletes candidates whose `outcome` is still `PENDING` and whose identity is absent from the new import — a logged outcome (WIN/LOSS/SKIP) is never deleted. The 409 conflict response used to only list already-logged outcomes ("these will be preserved"), which left the still-pending removals invisible until after confirming.

Both `POST /screener/sessions/import` (`artifacts/api-server/src/routes/screener.ts`) and `POST /screener/sessions/import-from-edgeai` (`artifacts/api-server/src/routes/edgeai.ts`) now also compute `wouldRemove` in their 409 body: existing PENDING candidates not present in the identity set of the incoming parsed/mapped candidates. The frontend conflict modal (`artifacts/screener/src/pages/import.tsx`) renders this as a distinct "these will be removed" list before the user confirms a force re-import.

**Why:** a still-pending candidate can carry a manually-set `isTop3Pick` flag or just be something a trader is tracking — losing it silently on a routine re-import (even though it's not a "logged outcome") was a real transparency gap.

**How to apply:** if you add another field to `candidatesTable` that a trader might set on a still-pending candidate (beyond `isTop3Pick`), consider whether it needs the same pre-confirmation visibility. The identity used for the diff is `candidateIdentity()` (market|category|ticker|direction) from `candidateSynchronization.ts` — keep it in sync with any new identity-relevant field.

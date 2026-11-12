---
name: Autoscale import recovery
description: Process-local timers are not proof of import delivery; wake requests must await work and use durable receipts.
---

Do not treat a scheduler-started log or a healthy web response as evidence that EdgeAI is being imported. A timer in an idle Autoscale process is not an independent scheduler.

**Why:** Production had successful Telegram receipts and newer EdgeAI source files but missing EdgeAI receipts. Targeted logs showed starts without corresponding import checks; instance lifecycle was the leading explanation, not a proven exception in the importer.

**How to apply:** Recover on authenticated latest-list reads and authenticated external wake requests, awaiting completion before sending a response so request-scoped CPU remains available. Coalesce these with timer checks instead of increasing polling. Use persisted source receipts and transactional locks, not in-memory flags, for restart/concurrency safety. Never let a partial recovery report delete prior trading evidence.

A local GitHub workflow file is not evidence of an active recovery schedule.

**Why:** The published app and the GitHub default branch are separate release targets.

**How to apply:** Verify the published hook, default-branch workflow and existing machine credential binding separately after approval. Do not trigger production imports or notifications merely to test deployment readiness.

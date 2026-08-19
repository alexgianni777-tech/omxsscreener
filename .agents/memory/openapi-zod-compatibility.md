---
name: OpenAPI Zod compatibility
description: Contract code generation with the workspace's Zod 3 catalog version.
---

OpenAPI `format: email` and `format: uri` cause the current generator to emit Zod 4-only helpers (`zod.email()` and `zod.url()`), while the workspace catalog intentionally pins Zod 3.x. Avoid those formats until the catalog is upgraded as a coordinated dependency change.

**Why:** Contract generation otherwise succeeds but the mandatory library typecheck fails, leaving generated clients in a broken state.

**How to apply:** Keep those fields as plain strings in the specification, or upgrade Zod and verify every workspace package together before restoring format-based validation.
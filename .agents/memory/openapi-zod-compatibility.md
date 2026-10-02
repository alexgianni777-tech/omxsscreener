---
name: OpenAPI Zod compatibility
description: Contract code generation with the workspace's Zod 3 catalog version.
---

OpenAPI `format: email`, `format: uri` and newly generated `type: integer` fields cause the current generator to emit Zod 4-only helpers (`zod.email()`, `zod.url()` and `zod.int()`), while the workspace catalog intentionally pins Zod 3.x. Avoid those helpers until the catalog is upgraded as a coordinated dependency change.

**Why:** Contract generation otherwise succeeds but the mandatory library typecheck fails, leaving generated clients in a broken state.

**How to apply:** Keep email/URI fields as plain strings and numeric identifiers/ranks as numbers in new contracts; validate integer constraints at the server boundary where needed. Alternatively upgrade Zod and verify every workspace package together before restoring format/integer-based generation.
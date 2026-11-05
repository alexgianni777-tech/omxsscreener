---
name: Protected UI verification
description: Authenticated browser checks can capture loading before settling and lose their context on notebook resets.
---
**Rule:** Do not classify an image-only/blank browser capture as authentication
failure or a frontend crash without checking pending auth, retained console
errors and callback/user responses. Wait for loading to settle in the same
authenticated context first.

**Why:** The tester initially captured only the auth spinner despite successful
OIDC and administrator user responses; navigating with the same cookies after
settling rendered the application. A later notebook timeout/reset erased that
context and prevented the remaining protected-page checks.

**How to apply:** Make browser reports distinguish loading, auth failure,
render failure and lost testing context. Keep subsequent checks bounded and
state which protected views were not actually verified.

**Rule:** Keep disposable QA PostgreSQL and isolated API services alive using managed background shell tasks, and verify a test port is free before binding it. Do not redirect tests to an unidentified listener.

**Why:** A detached PostgreSQL process did not survive the tester's setup command, and a presumed free API port was already occupied. Persistent background tasks and a different verified-free port restored isolation without stopping the normal app.

**How to apply:** Require local test-database health and the explicit E2E scheduler-disabled startup message before browser routing. Clean up only the test resources after verification.

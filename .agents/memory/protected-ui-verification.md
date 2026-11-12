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

**Rule:** Check that the testing browser wrapper actually exposes network routing before relying on Playwright interception. Never let an isolation workaround contact the ordinary API.

**Why:** The browser's wrapped page/context lacked routing methods. A temporary dev-only bridge, real isolated DB session and browser connection policy allowed actual authenticated rendering without fabricated API responses.

**How to apply:** Prove ordinary preview requests are unchanged, restrict QA traffic to the isolated API, disable provider calls and automatic jobs, and remove the entire bridge/session/test database afterwards. Report genuine rendered checks separately from mocked fixtures and live-provider verification.

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

---
name: API authentication guard
description: Access-control boundary for the private trading dashboard API.
---

All private dashboard APIs must be mounted behind the server-side authentication guard; the React login gate is only a presentation layer and never protects data by itself. Only the health endpoint, OIDC routes, and the bearer-token-validated Telegram import route are public.

**Why:** A client-side gate can be bypassed by calling API URLs directly, exposing private trading records or allowing writes and deletes.

**How to apply:** When adding a route, keep it behind the shared protected router by default. Any public endpoint needs an explicit, justified exception and its own appropriate credential check.
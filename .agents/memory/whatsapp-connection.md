---
name: WhatsApp connection security
description: Security boundary and restart behavior for the WhatsApp Cloud API connection.
---

The WhatsApp access token must stay server-side and is intentionally held only in the API process for the current MVP; it is never returned by the connection status endpoint or saved in browser storage.

**Why:** Returning or browser-persisting the Meta token would expose a credential to the client. The current app has no authenticated operator scope, so durable encrypted credential storage should be designed together with authentication rather than added ad hoc.

**How to apply:** Keep the connection endpoint as the only place that accepts the raw Meta token. If connection persistence is added, use server-managed encrypted storage and user-scoped access. The webhook verification token may be shown separately because it is not the Meta access token.
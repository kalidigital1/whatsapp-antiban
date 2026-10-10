---
name: WhatsApp connection security
description: Security boundaries and provider behavior for Cloud API and Evolution API connections.
---

The Meta access token and Evolution API key/configuration stay server-side, encrypted at rest, and are never returned by connection status endpoints or saved in browser storage. `EVOLUTION_API_URL` and `EVOLUTION_API_KEY` in Replit Secrets are the defaults for new QR connections when the request omits those values; a configured instance is also persisted encrypted for restart recovery. The Evolution webhook uses an instance-specific derived secret. The active provider is persisted separately from whether its session is currently online. Official templates must only be sent through the Meta Cloud API; regular chat text and media can use the selected provider.

**Why:** Both providers can access WhatsApp conversations, and the Evolution API is unofficial; credentials and inbound webhook access must remain isolated from the browser and from unrelated instances. The user specified that the configured Evolution URL and key are the reusable defaults for generating QR connections.

**How to apply:** Keep provider credentials in Replit Secrets and server-managed encrypted storage, never return them to clients, use the Evolution environment defaults only server-side when starting a new connection, verify webhook requests with the per-instance secret, and preserve the distinction between official templates and regular chat messaging.
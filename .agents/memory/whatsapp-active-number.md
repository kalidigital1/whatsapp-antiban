---
name: WhatsApp active number
description: Selecting and persisting the outbound WhatsApp phone number
---

When a WhatsApp Business Account has multiple phone numbers, the active outbound number must be selected from the server-loaded account list, validated server-side, and persisted with the encrypted connection settings. Incoming webhooks still identify their source number through Meta's `phone_number_id`.

**Why:** A browser-controlled ID can refer to a different account or become stale, and selecting an outbound number does not change which linked number originated an inbound webhook.

**How to apply:** Use the persisted selected Phone Number ID for new outbound messages, templates, and media; keep webhook routing based on the metadata sent by Meta.
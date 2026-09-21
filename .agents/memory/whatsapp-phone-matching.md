---
name: WhatsApp phone matching
description: Matching local and DDI-form phone numbers across outbound starts and inbound webhooks
---

Brazilian contacts may be stored without `55` when a user starts a conversation, while Meta webhook payloads normally include `55`. Contact lookup must consider both representations.

**Why:** Without this compatibility lookup, a customer's reply is treated as a different contact and creates a second conversation, causing the operator's current chat to appear to change.

**How to apply:** When resolving a contact for outbound starts or inbound webhooks, compare the normalized number, its Brazilian DDI form, and the corresponding local form before creating a contact or conversation.
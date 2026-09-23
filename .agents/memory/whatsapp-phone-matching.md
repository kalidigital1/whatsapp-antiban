---
name: WhatsApp phone matching
description: Matching local and DDI-form phone numbers across outbound starts and inbound webhooks
---

Brazilian contacts may be stored without `55` when a user starts a conversation, while Meta webhook payloads normally include `55`. Contact lookup must consider both representations.

**Why:** Without this compatibility lookup, a customer's reply is treated as a different contact and creates a second conversation, causing the operator's current chat to appear to change.

**How to apply:** For outbound starts and template batches, canonicalize Brazilian local numbers to the DDI form before calling Meta; for contacts and inbound webhooks, compare both forms before creating a contact or conversation.
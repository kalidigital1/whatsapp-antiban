---
name: WhatsApp phone matching
description: Matching local and DDI-form phone numbers across outbound starts and inbound webhooks
---

Brazilian contacts may be stored without `55` when a user starts a conversation, while Meta webhook payloads normally include `55`. New conversations default to Brazil (+55), but users can choose another country; keep explicitly international numbers distinguishable from local Brazilian numbers.

**Why:** Without matching local and DDI forms, a customer's reply can create a second conversation. Also, an international number such as a US +1 number can have 11 digits and must not be mistaken for a Brazilian local number.

**How to apply:** Default the new-conversation country selector to Brazil (+55) and parse its local number into E.164 before sending. Preserve the `+` marker for explicitly international contact numbers so outbound Meta/Evolution sends do not add `55` to them; match stored `+digits` and digits-only forms for inbound replies. Continue canonicalizing Brazilian local numbers to `55` + digits, and preserve group/LID JIDs.
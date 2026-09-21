---
name: New WhatsApp conversations
description: Meta policy constraint and app flow for starting conversations with new contacts
---

Starting a conversation with a new WhatsApp contact must use a Meta-approved template. Free-form text is only reliable inside an active customer-service window after the contact has messaged the business.

**Why:** Meta can accept the API request but later mark a free-form outbound message as failed when no customer-service window exists. Treating the request as an ordinary text send makes the UI look like it sent a message when the contact never receives it.

**How to apply:** Keep the new-contact flow template-based, collect template parameters before sending, and reserve free-form text for existing conversations.
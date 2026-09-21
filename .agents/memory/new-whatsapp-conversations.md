---
name: New WhatsApp conversations
description: Meta policy constraint and app flow for starting conversations with new contacts
---

The new-contact flow offers normal text first and keeps an approved template as an alternative. Free-form text is only reliable inside an active customer-service window after the contact has messaged the business.

**Why:** The product requirement is to attempt a normal message, but Meta can accept the API request and later mark it as failed when no customer-service window exists. The UI must not silently replace the user's text with a template.

**How to apply:** Default to free-form text, preserve the actual Meta error if it is rejected, and collect template parameters only when the user explicitly chooses the template option.
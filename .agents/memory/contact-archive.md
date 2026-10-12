---
name: Contact removal and history
description: The product behavior for removing contacts while retaining WhatsApp history.
---

When a contact is removed from the address book, keep its record, conversations, and messages so the existing chat remains intact. Hide removed contacts from the contacts list and export. Explicitly adding or importing the same number may restore it; inbound message synchronization must not.

**Why:** The user chose to preserve chat history when selecting how contact deletion should work.

**How to apply:** Use logical removal rather than deleting the contact row or cascading into conversations. Restore only through an explicit add/import action.

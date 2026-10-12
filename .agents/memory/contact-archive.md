---
name: Contact saving, removal, and history
description: Address-book saving and deletion behavior, plus safe handling of Evolution LID identifiers.
---

When a contact is removed from the address book, keep its record, conversations, and messages so the existing chat remains intact. Hide removed contacts from the contacts list and export. Explicitly adding or importing the same number may restore it; inbound message synchronization must not.

For Evolution QR chats, inbound contact synchronization must not add a person to the address book automatically; offer an explicit save action instead. Never treat digits from a WhatsApp `@lid` identifier as a phone number or display the raw identifier. Resolve a phone only from a distinct provider-supplied alternate number; if unavailable, show that the number is unavailable. When a number is resolved, attach it to the existing conversation and preserve its message history.

**Why:** The user chose to preserve chat history on contact removal and asked to see real phone numbers, with an option to save unsaved contacts. Fabricating a phone from a private LID identifier would misidentify the person.

**How to apply:** Use logical removal rather than deleting the contact row or cascading into conversations. Restore only through an explicit add/import/save action. Keep provider identifiers internal and use verified alternate numbers for display and contact matching.

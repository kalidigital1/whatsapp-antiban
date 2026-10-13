---
name: Contact saving, removal, and history
description: Address-book saving and deletion behavior, plus safe handling of Evolution LID identifiers.
---

When a contact is removed from the address book, keep its record, conversations, and messages so the existing chat remains intact. Hide removed contacts from the contacts list and export. Explicitly adding or importing the same number may restore it; inbound message synchronization must not.

For Evolution QR chats, inbound contact synchronization must not add a person to the address book automatically; offer an explicit save action instead. For unsaved direct chats, prefer the verified phone number over provider push/notify names such as “Você”; keep the saved address-book name for saved contacts. Never treat digits from a WhatsApp `@lid` identifier as a phone number or display the raw identifier. Resolve a phone only from a distinct provider-supplied alternate number; if unavailable, show that the number is unavailable. Check both Evolution `findContacts` (including `number` and `profilePictureUrl`) and `findChats`/message `remoteJidAlt`; contact-only lookup can miss unsaved chat identifiers. When a number is resolved, attach it to the existing conversation and preserve its message history.

**Why:** The user chose to preserve chat history on contact removal and asked to see real phone numbers instead of “Você” or random provider names for unsaved chats, with an option to save contacts. Fabricating a phone from a private LID identifier would misidentify the person.

**How to apply:** Use logical removal rather than deleting the contact row or cascading into conversations. Restore only through an explicit add/import/save action. Keep provider identifiers internal and use verified alternate numbers for display and contact matching.

---
name: WhatsApp disconnect cleanup
description: Product behavior for clearing local chat history when a WhatsApp connection is disconnected.
---

When the current WhatsApp number is disconnected or replaced, remove all conversation, message, and media history so no previous number's chats remain visible. Keep contacts and the Antiban login. Do not automatically switch to another previously configured provider; require explicit reconnection.

**Why:** The user repeatedly clarified that changing numbers must leave only contacts, remove chats from the screen, and keep the person logged in.

**How to apply:** On manual disconnect or successful number/provider replacement, clear conversation rows, messages, and local media while retaining contacts and authentication. Clear the UI cache immediately and ignore webhooks from inactive providers. Hide chats during a temporary provider outage, but defer irreversible deletion until the provider confirms disconnection.

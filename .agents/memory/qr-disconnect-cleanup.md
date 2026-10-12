---
name: WhatsApp disconnect cleanup
description: Product behavior for clearing local chat history when a WhatsApp connection is disconnected.
---

When disconnecting a WhatsApp provider, permanently remove conversations, messages, and media associated with that provider so a newly connected number starts with a clean inbox. Keep contacts and history from any provider that remains active. If no provider is active, clear leftover conversations from a disconnect that happened before this cleanup behavior existed.

**Why:** The user wants old chats gone when WhatsApp is removed so a different number can be connected, especially through QR, and explicitly chose to retain contacts.

**How to apply:** Warn that removal is permanent before confirming disconnection. Scope cleanup to the disconnected provider, preserve contacts and any other active provider's history, and refresh the conversation list after cleanup.

---
name: QR disconnect cleanup
description: Product behavior for clearing local WhatsApp history when a QR connection is disconnected.
---

When disconnecting via QR Code, permanently remove all QR-linked conversations, messages, and media from the platform so a newly connected number starts with a clean inbox. Keep contacts and conversations from the official Cloud API connection.

**Why:** The user chose this behavior to prevent one QR-connected number's history from appearing after connecting another number, and explicitly chose to retain contacts.

**How to apply:** Warn that the removal is permanent before confirming disconnection. Scope cleanup to QR connection data, preserve contacts and other-provider histories, and refresh the conversation list after cleanup.

---
name: Evolution WhatsApp parity
description: Product scope for the Evolution connection in the WhatsApp app.
---

The QR Code connection should mirror a broad set of WhatsApp Web chat features the provider supports, including synced history and contacts, direct and group chats, media, and reactions. Show returned profile fields and mark unavailable data rather than inferring it. For the connected account, use its actual WhatsApp profile name and photo, never the configured instance name; if unavailable, use a neutral name and initials. If connected without a returned phone number, show the connection method, not a disconnected status. In user-facing copy, call it “Conectado via QR Code” and do not expose the provider’s name; keep technical identifiers internal. Do not claim exact WhatsApp Web parity.

**Why:** The user chose broad WhatsApp Web parity, asked to surface all available profile details, clarified that an active QR connection must not appear disconnected, asked to remove the provider name from the platform, and said the account name and photo should be pulled correctly rather than using the instance name; provider support and WhatsApp privacy still limit returned data.

**How to apply:** Prioritize supported chat, group, contact, media, and reaction behavior for QR connections. Display only returned profile data, distinguish a WhatsApp display name from verified identity, use QR Code wording in user-visible labels and errors, and state capability limits plainly.

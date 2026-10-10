---
name: Evolution WhatsApp parity
description: Product scope for the Evolution connection in the WhatsApp app.
---

The QR Code connection should mirror a broad set of WhatsApp Web chat features the provider supports, including synced history and contacts, direct and group chats, media, and reactions. Show returned profile fields and mark unavailable data rather than inferring it. For the connected account, use its actual WhatsApp profile name and photo, never the configured instance name; if unavailable, use a neutral name and initials. Profile-name editing must update the actual WhatsApp account profile, not create a local display alias. If connected without a returned phone number, show the connection method, not a disconnected status. In user-facing copy, call it “Conectado via QR Code” and do not expose the provider’s name; keep technical identifiers internal. Do not claim exact WhatsApp Web parity.

When webhook delivery is unavailable in the preview, server-side polling of the connected account's stored messages successfully recovered inbound replies into the correct chat; the user confirmed this fallback worked. Keep the fallback idempotent with webhook ingestion.

**Why:** The user chose broad WhatsApp Web parity, asked to surface all available profile details, clarified that an active QR connection must not appear disconnected, asked to remove the provider name from the platform, said the account name and photo should be pulled correctly rather than using the instance name, and chose real profile-name editing instead of a local alias; provider support and WhatsApp privacy still limit returned data. The user also confirmed that polling stored messages restored replies to the correct chat when webhook delivery was unavailable.

**How to apply:** Prioritize supported chat, group, contact, media, and reaction behavior for QR connections. Display only returned profile data, distinguish a WhatsApp display name from verified identity, update the connected account through its supported profile endpoint when the user edits its name, use QR Code wording in user-visible labels and errors, and state capability limits plainly. If inbound webhooks cannot reach the preview, poll stored messages as a fallback and deduplicate against webhook events.

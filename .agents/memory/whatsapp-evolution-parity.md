---
name: Evolution WhatsApp parity
description: Product scope for the Evolution connection in the WhatsApp app.
---

The QR Code connection should mirror a broad set of WhatsApp Web chat features the provider supports, including synced history and contacts, direct and group chats, media, and reactions. Show returned profile fields and mark unavailable data rather than inferring it. For the connected account, use its actual WhatsApp profile name and photo, never the configured instance name; if unavailable, use a neutral name and initials. Profile-name editing must update the actual WhatsApp account profile, not create a local display alias. If connected without a returned phone number, show the connection method, not a disconnected status. In user-facing copy, call it “Conectado via QR Code” and do not expose the provider’s name; keep technical identifiers internal. Do not claim exact WhatsApp Web parity.

Contact profile photos have been confirmed to render, while the connected account still showed a generic name and initials. Validate the owner-profile lookup separately from profile lookups for other contacts.

WhatsApp owner JIDs may include a device suffix before `@s.whatsapp.net`; strip it before treating the ID as a phone number. Otherwise restored QR sessions can lose the owner number and skip own-profile name/photo lookups.

Polling can fetch inbound QR messages, but the user clarified that a reply from an existing contact appeared in a separate new conversation rather than that contact's existing chat. Contact-to-chat reassociation remains unconfirmed.

**Why:** The user chose broad WhatsApp Web parity, asked to surface all available profile details, clarified that an active QR connection must not appear disconnected, asked to remove the provider name from the platform, said the account name and photo should be pulled correctly rather than using the instance name, and chose real profile-name editing instead of a local alias; provider support and WhatsApp privacy still limit returned data. The user confirmed that contact photos render but the connected account profile remains incomplete, and separately clarified that a reply from a person with an existing chat appeared in a new conversation without identifying the exact target contact.

**How to apply:** Prioritize supported chat, group, contact, media, and reaction behavior for QR connections. Normalize device-suffixed owner JIDs before profile requests and saved-session restoration. Display only returned profile data, distinguish a WhatsApp display name from verified identity, update the connected account through its supported profile endpoint when the user edits its name, use QR Code wording in user-visible labels and errors, and state capability limits plainly. Polling may recover messages when webhooks are unavailable, but verify which contact/chat receives them and do not claim correct reassociation until confirmed.

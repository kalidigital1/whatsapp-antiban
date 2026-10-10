---
name: Evolution WhatsApp parity
description: Product scope for the Evolution connection in the WhatsApp app.
---

Evolution mode should mirror a broad set of WhatsApp Web chat features that the provider actually supports, including synced history and contacts, direct and group chats, media, and reactions. For contact profiles, show every public profile field Evolution returns and clearly mark unavailable data rather than inferring private information. When Evolution is connected but does not return its phone number, show the connection method instead of implying that the number is disconnected. Do not describe the app as having exact WhatsApp Web parity; unsupported provider capabilities remain unavailable.

**Why:** The user chose broad WhatsApp Web parity, asked to surface all available Evolution profile details, and noted that a connected QR session should not be labeled as a disconnected number; the unofficial API and WhatsApp privacy settings limit which fields can be returned.

**How to apply:** Prioritize supported chat, group, contact, media, and reaction behavior when extending Evolution mode. Display only returned profile data, distinguish a WhatsApp display name from verified identity, show provider connection state truthfully, and state capability limits plainly.

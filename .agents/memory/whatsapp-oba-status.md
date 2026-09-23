---
name: WhatsApp OBA status
description: Official Business Account status checks and badge display
---

The WhatsApp blue badge is a Meta-controlled OBA result, not a consequence of a connected Cloud API account. Treat the badge as approved only when the phone-number status returned by Meta is `APPROVED`; other states should remain visible as status text.

**Why:** A connected API credential can be valid while the business phone number has never applied for OBA, is under review, or was rejected. Showing the badge for every connected number is misleading.

**How to apply:** Query the phone number's official-business-account status server-side with the stored Meta token, expose only the status and message to the client, and direct applications to WhatsApp Manager unless the app collects all fields required by Meta's submission endpoint.
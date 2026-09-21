---
name: Conversation list caching
description: HTTP caching behavior for the WhatsApp conversation endpoints and generated client
---

The WhatsApp conversation endpoints must send `Cache-Control: no-store` rather than allowing conditional `304 Not Modified` responses.

**Why:** The generated API client parses a `304` response as a successful no-body response and replaces the query data with `null`. During a conversation refresh, the UI can then temporarily lose the selected conversation and fall back to another chat.

**How to apply:** Preserve no-store headers on conversation list, conversation message, and related WhatsApp API responses whenever the client still uses this generated fetch behavior.
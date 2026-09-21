---
name: WhatsApp media uploads
description: Durable constraints for sending chat attachments through the WhatsApp Cloud API.
---

Chat attachments should be streamed through the API server to Meta's media endpoint and then referenced by the outbound WhatsApp message; do not persist the raw bytes in PostgreSQL when the product only needs transient delivery.

**Why:** The chat needs real delivery and status feedback without turning the application database into a media store. The generated TypeScript client also needs a named multipart component schema and DOM types for File/Blob.

**How to apply:** Keep the server-side Meta token private, use a multipart endpoint with a named OpenAPI component for the file and optional caption, regenerate clients after contract changes, and show Meta or upload errors in the composer.
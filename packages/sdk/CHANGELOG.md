# Changelog: gentlemail (SDK)

The SDK's own versions, released independently of the GentleMail app. Released with a tag `sdk-vX.Y.Z`, which publishes to npm.

## Unreleased

## 0.1.0 (2026-11-16)

### Added
- `GentleMail` client: `send()`, `mailboxes.list()`, `messages.list()`, `messages.get()`, `messages.update()`, `messages.reply()` and `attachments.download()`. Attachments can be passed as bytes or base64.
- `verifyWebhook()`: checks a delivery's signature and age, from a `Request` or a raw body with headers, and returns the typed event (`message.received`, `message.sent`, `ping`).
- `GentleMailError` (status and code) and `WebhookVerificationError` (reason).
- Types for every API and webhook shape. Works with GentleMail 0.3.0 and later.

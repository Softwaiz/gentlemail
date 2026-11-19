---
title: Errors
description: GentleMail API error statuses and codes.
---

Errors use HTTP status codes and a body your program can switch on:

```json
{ "error": { "code": "mailbox_not_allowed", "message": "This key can't send from sales@example.com." } }
```

| Status | Codes | Meaning |
|---|---|---|
| 400 | `invalid_json` | The body isn't a JSON object. |
| 401 | `unauthorized` | No key, or an unknown or revoked one. |
| 403 | `forbidden` | The key has no permission of this kind on any mailbox. |
| 403 | `mailbox_not_allowed` | The key can't use this mailbox for this. |
| 403 | `read_required` | Replying needs Read on the mailbox as well as Send. |
| 403 | `organize_required` | Marking or moving needs Organize on the message's mailbox. The key can read the message, but not file it. |
| 404 | `not_found`, `original_not_found` | No such message, attachment or route, or `reply_to_message_id` isn't in this mailbox. |
| 422 | `invalid_from`, `invalid_recipient`, `missing_body`, `invalid_attachments`, `invalid_folder`, `invalid_since`, `invalid_action`, `mailbox_disabled` | Something in the request needs fixing. The message says what. |
| 422 | `send_failed` and others | The mail couldn't be sent (for example, sending is turned off for the domain). |
| 500 | `internal` | Something went wrong on the server. Retry later. |

---
title: Send an email
description: Send email from your GentleMail mailboxes with POST /api/v1/send, with attachments, signatures and replies in a thread.
---

`POST /api/v1/send` sends from one of your mailboxes. The message is stored in that mailbox's Sent folder, threaded with its conversation, and a `message.sent` [webhook](/docs/webhooks/) fires. The key needs **Send** on the `from` mailbox.

```sh
curl https://mail.example.com/api/v1/send \
  -H "Authorization: Bearer $GENTLEMAIL_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "support@example.com",
    "to": ["Ada Lovelace <ada@example.org>"],
    "subject": "Your order has shipped",
    "text": "It should arrive on Friday.",
    "html": "<p>It should arrive on <b>Friday</b>.</p>"
  }'
```

```json
{ "id": "…", "thread_id": "…", "from": "support@example.com", "status": "sent" }
```

The answer is `201 Created`.

## Fields

| Field | Type | What it does |
|---|---|---|
| `from` | string | Address of a mailbox the key can send from. Required. |
| `to`, `cc`, `bcc` | string, object or array | `"a@b.c"`, `"Name <a@b.c>"`, `{ "address", "name" }`, or a list of those. |
| `subject` | string | Subject line. Defaults to `Re:` the original when replying. |
| `text`, `html` | string | At least one. With only HTML, a plain-text version is made for you. |
| `attachments` | array | Each item: `{ "filename", "content" (base64), "content_type"? }`. Up to 25 MB in all. |
| `reply_to_message_id` | string | ID of a message in this mailbox. Threads the reply, and `to` defaults to its sender (its recipients, for a message sent from this mailbox). Needs **Read** on the mailbox too. |
| `quote` | boolean | With a reply, quote the original below your text. |
| `signature` | boolean | Append the mailbox's signature. |

## Replying to a message from a webhook

Pass the event's `data.id` as `reply_to_message_id`, and leave out `to` and `subject`:

```json
{
  "from": "support@example.com",
  "reply_to_message_id": "…",
  "text": "Thanks, we're on it."
}
```

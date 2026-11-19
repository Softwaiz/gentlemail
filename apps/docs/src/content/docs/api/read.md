---
title: Read mail
description: List, read, move and download GentleMail messages and attachments with the API.
---

These need **Read** on the mailbox, except marking and moving, which need **Organize**. A key only lists and reads messages from the mailboxes it has Read on.

## List messages

`GET /api/v1/messages`, newest first.

| Query | What it does |
|---|---|
| `mailbox` | Only this address. Without it, every mailbox the key can read. |
| `folder` | `inbox` (default), `sent`, `archive`, `spam`, `trash` or `all`. |
| `unread=true` | Only unread messages. |
| `q` | Words to find in the subject, sender, recipients (To and Cc) or text. |
| `since` | Only messages after this date: ISO 8601 or epoch milliseconds. |
| `limit` | 1 to 100, default 25. A value outside that range is brought to 1 or 100. |

```sh
curl "https://mail.example.com/api/v1/messages?mailbox=support@example.com&unread=true" \
  -H "Authorization: Bearer $GENTLEMAIL_KEY"
```

Each item is a message summary: `id`, `thread_id`, `mailbox`, `folder`, `direction`, `from`, `to`, `cc`, `subject`, `date`, `snippet`, `is_read`, `is_starred`, `attachments` and `url`.

## Read one message

`GET /api/v1/messages/:id` returns the summary plus `text` (up to 200,000 characters, with `text_truncated`) and `html`, the message exactly as received.

:::caution
Never put `html` in a web page without sanitising it first. It's whatever the sender wrote.
:::

## Move or mark a message

`POST /api/v1/messages/:id` with `{ "action": "…" }`, one of `read`, `unread`, `star`, `unstar`, `archive`, `trash`, `spam` or `inbox`. The key needs **Organize** on the message's mailbox: with Read but not Organize, the answer is `403 organize_required`.

```sh
curl -X POST https://mail.example.com/api/v1/messages/$ID \
  -H "Authorization: Bearer $GENTLEMAIL_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "action": "archive" }'
```

## Download an attachment

`GET /api/v1/attachments/:id` returns the file with its content type, as a download. Each attachment in a message or a webhook event has its own `url`.

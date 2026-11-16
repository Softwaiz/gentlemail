---
title: API keys
description: Give each program a GentleMail API key with Read and Send access on exactly the mailboxes, domains or all mailboxes it needs.
---

Create keys in **Admin → API & webhooks → New key**. Give each program its own key, with only the access it needs.

## Access: Read and Send, where you choose

A key's access is a table. Each line grants **Read**, **Send** or both on:

- **All mailboxes**, now and later;
- **a whole domain**, including mailboxes added to it later;
- **a single mailbox**.

A key can mix lines: for example Read on all of `example.com`, plus Send from `billing@other.com` only. What a key may do on a mailbox is everything any of its lines allows there.

| Permission | Lets the key |
|---|---|
| **Read** | list and read messages, download attachments, mark read or unread, star, archive, trash, spam |
| **Send** | send from the mailbox. Replying with `reply_to_message_id` also needs Read, since the reply quotes and threads the original. |

Change a key's access at any time with **Edit access**. Programs keep the same key, and the new access applies from their next request. **Revoke** stops a key for good.

`GET /api/v1/mailboxes` returns the mailboxes a key can use, with `"permissions"` on each, so a program can check what it's allowed to do.

## Using a key

Keys start with `gm_` and are shown once. GentleMail only stores a fingerprint (SHA-256), so a lost key can't be shown again: revoke it and make a new one.

```http
Authorization: Bearer gm_…
```

Keep keys in your program's secrets (for example `wrangler secret put GENTLEMAIL_KEY`), never in code or in a URL.

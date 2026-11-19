---
title: API overview
description: The GentleMail HTTP API, its base URL, authentication and conventions.
---

Programs send and read mail through the HTTP API, on the same mailboxes people use in the web app. From JavaScript or TypeScript, the [SDK](/docs/sdk/) wraps all of it.

- **Base URL:** `https://<your-gentlemail>/api/v1`
- **Authentication:** an [API key](/docs/api/keys/) on every request, as `Authorization: Bearer gm_…`
- **Format:** JSON in and out (`Content-Type: application/json`), except attachment downloads.
- **Errors:** an HTTP status and a body with a `code` your program can switch on. See [Errors](/docs/api/errors/).

| Method and path | Needs | What it does |
|---|---|---|
| `GET /mailboxes` | any permission | The mailboxes this key can use, with its permissions on each. |
| `POST /send` | Send | [Send an email](/docs/api/send/), or reply in a thread. |
| `GET /messages` | Read | [List messages](/docs/api/read/), newest first. |
| `GET /messages/:id` | Read | One message, with its text, its original HTML and its attachments. |
| `POST /messages/:id` | Organize | Mark read or unread, star, archive, trash, spam or move back to the inbox. |
| `GET /attachments/:id` | Read | The file itself. |

Inside the app, **Admin → API & webhooks** has a quick reference with your instance's address filled in.

## A first call

```sh
curl https://mail.example.com/api/v1/mailboxes \
  -H "Authorization: Bearer $GENTLEMAIL_KEY"
```

```json
{
  "data": [
    { "id": "…", "address": "support@example.com", "display_name": "Support", "active": true, "permissions": ["read", "organize", "send"] },
    { "id": "…", "address": "invoices@example.com", "display_name": "Invoices", "active": true, "permissions": ["read"] }
  ]
}
```

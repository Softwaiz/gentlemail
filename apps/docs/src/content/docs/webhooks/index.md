---
title: Webhooks
description: Get a signed GentleMail event the moment mail arrives or is sent, with retries and a delivery log.
---

A webhook sends a signed JSON event to your URL when mail arrives (`message.received`) or is sent (`message.sent`).

## Add one

In **Admin → API & webhooks → New webhook**, enter:

- the **URL** that receives events (https);
- the **mailbox** to listen to, or all of them;
- the **events**: `message.received`, `message.sent` or both.

You get a signing secret starting with `whsec_`. [Check the signature](/docs/webhooks/verify/) on every delivery.

**Send test** on the webhook's page sends a `ping` event, `{ "data": { "webhook": "<its name>" } }`, signed like the others. It's tried once and not retried. Answer it with a `2xx` like any other event.

## What your endpoint receives

```http
POST https://agents.example.com/mail
Content-Type: application/json
User-Agent: GentleMail-Webhooks/1
X-GentleMail-Event: message.received
X-GentleMail-Delivery: 6f1c2e4a-…
X-GentleMail-Timestamp: 1794580000
X-GentleMail-Signature: v1=5f2c…
```

```json
{
  "id": "6f1c2e4a-…",
  "event": "message.received",
  "created_at": "2026-11-13T09:46:02.000Z",
  "data": {
    "id": "…",
    "thread_id": "…",
    "mailbox": { "id": "…", "address": "invoices@example.com" },
    "folder": "inbox",
    "direction": "inbound",
    "from": { "name": "Acme Billing", "address": "billing@acme.test" },
    "to": [{ "name": "", "address": "invoices@example.com" }],
    "cc": [],
    "reply_to": null,
    "subject": "Invoice INV-2041",
    "date": "2026-11-13T09:46:00.000Z",
    "snippet": "Please find the November invoice attached.",
    "text": "Please find the November invoice attached.\n…",
    "text_truncated": false,
    "has_html": true,
    "attachments": [{
      "id": "…", "filename": "invoice-2041.pdf", "content_type": "application/pdf",
      "size": 48213, "inline": false,
      "url": "https://mail.example.com/api/v1/attachments/…"
    }],
    "url": "https://mail.example.com/api/v1/messages/…"
  }
}
```

## Delivery rules

- The text comes in the event itself (up to 200,000 characters), so most programs never need a second call. Attachments and the HTML are fetched with a key that has **Read** on the mailbox.
- Answer with a `2xx` within 10 seconds. Redirects aren't followed.
- Failed deliveries are retried after 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours and 12 hours, then marked failed. Each webhook's page shows its delivery log, with buttons to retry and to send a test event.
- A delivery can arrive more than once. Use the top-level `id` (also in `X-GentleMail-Delivery`) to skip ones you've already handled.
- Mail that lands in Spam never triggers a webhook.

---
title: JavaScript SDK
description: The gentlemail npm package sends, reads and replies to mail through your GentleMail and verifies its webhooks, on Workers, Node, Deno and Bun.
---

`gentlemail` is the official SDK for JavaScript and TypeScript. It wraps the [API](/docs/api/), verifies [webhooks](/docs/webhooks/), and types everything both send. It has no dependencies and runs on Cloudflare Workers, Node 20+, Deno and Bun.

```sh
npm install gentlemail
```

It works with GentleMail 0.3.0 and later.

The SDK has its own versions, apart from the app's. This page describes the latest one, and each section says which version added it, so you can tell what the version you installed can do (`npm ls gentlemail` prints it). What each version changed is in the [SDK changelog](/docs/sdk/changelog/), and the docs of an older version are its README [on npm](https://www.npmjs.com/package/gentlemail?activeTab=versions).

## Connect

<p class="since">Since 0.1.0</p>

Create a key in **Admin → API & webhooks** with the access the program needs (see [API keys](/docs/api/keys/)), and keep it in your secrets.

```ts
import { GentleMail } from "gentlemail";

const mail = new GentleMail({
  url: "https://mail.example.com", // your GentleMail
  apiKey: env.GENTLEMAIL_KEY,
});
```

## Send

<p class="since">Since 0.1.0</p>

```ts
const sent = await mail.send({
  from: "support@example.com",
  to: ["Ada Lovelace <ada@example.org>"],
  cc: { address: "team@example.com", name: "Team" },
  subject: "Your order has shipped",
  text: "It should arrive on Friday.",
  html: "<p>It should arrive on <b>Friday</b>.</p>",
  attachments: [{ filename: "invoice.pdf", content: pdfBytes, content_type: "application/pdf" }],
});
// { id, thread_id, from, status: "sent" }
```

Every [send field](/docs/api/send/#fields) is supported. Attachment `content` can be bytes (`Uint8Array`, `ArrayBuffer`) or a base64 string; the SDK encodes bytes for you.

## Read and file

<p class="since">Since 0.1.0</p>

```ts
const mailboxes = await mail.mailboxes.list(); // with this key's permissions on each

const unread = await mail.messages.list({
  mailbox: "support@example.com", // or leave out for every mailbox the key can read
  folder: "inbox",                // inbox, sent, archive, spam, trash or all
  unread: true,
  since: new Date(Date.now() - 86_400_000),
  limit: 50,
});

const message = await mail.messages.get(unread[0].id); // adds text and html
await mail.messages.update(message.id, "read");        // read, unread, star, unstar, archive, trash, spam, inbox
```

`messages.update()` needs **Organize** on the message's mailbox. Before GentleMail 0.6.1, Read was enough; from 0.6.1, a key without Organize gets a `403` with the code `organize_required`, and `mailboxes.list()` shows `"organize"` among a mailbox's permissions.

`message.html` is the HTML exactly as received. Sanitise it before you show it in a browser.

## Reply

<p class="since">Since 0.1.0</p>

`messages.reply()` answers from the message's own mailbox, in its thread, to its sender. Pass any message: from `get()`, `list()` or a webhook event's `data`. The key needs **Read** and **Send** on the mailbox.

```ts
await mail.messages.reply(message, { text: "Thanks, we're on it.", quote: true });
```

## Attachments

<p class="since">Since 0.1.0</p>

`attachments.download()` takes an attachment's `id` or `url` and returns the `Response`, so you can stream it or read it:

```ts
const file = await mail.attachments.download(message.attachments[0].url);
await env.FILES.put(message.attachments[0].filename, file.body); // stream to R2
```

## Webhooks

<p class="since">Since 0.1.0</p>

`verifyWebhook()` checks the signature and refuses deliveries older than five minutes, then returns the typed event. Give it the incoming `Request`:

```ts
import { GentleMail, verifyWebhook } from "gentlemail";

export default {
  async fetch(request: Request, env: Env) {
    const event = await verifyWebhook(request, env.WEBHOOK_SECRET).catch(() => null);
    if (!event) return new Response("Bad signature", { status: 401 });

    switch (event.event) {
      case "message.received": {
        const mail = new GentleMail({ url: env.GENTLEMAIL_URL, apiKey: env.GENTLEMAIL_KEY });
        await mail.messages.reply(event.data, { text: "Got it, thanks!" });
        break;
      }
      case "ping": // "Send test" on the webhook's page
        break;
    }
    return new Response("OK");
  },
};
```

With Express or Node's `http`, pass the raw body and the headers instead. The body must be exactly what arrived, so don't parse it first:

```ts
app.post("/mail", express.raw({ type: "application/json" }), async (req, res) => {
  const event = await verifyWebhook({ body: req.body, headers: req.headers }, process.env.WEBHOOK_SECRET!);
  // …
  res.send("OK");
});
```

The same event can arrive twice: skip `event.id`s you've already handled. Change the age limit with `{ tolerance: seconds }`.

## Errors

<p class="since">Since 0.1.0</p>

| Thrown | When | Fields |
|---|---|---|
| `GentleMailError` | The API answered with an error | `status`, `code` (see [Errors](/docs/api/errors/)), `message` |
| `WebhookVerificationError` | A delivery was refused | `reason`: `bad_signature`, `expired`, `missing_headers` or `invalid_json` |

```ts
import { GentleMailError } from "gentlemail";

try {
  await mail.send({ from: "sales@example.com", to: "ada@example.org", text: "Hi" });
} catch (e) {
  if (e instanceof GentleMailError && e.code === "mailbox_not_allowed") {
    // this key can't send from sales@
  } else throw e;
}
```

# gentlemail

The JavaScript and TypeScript SDK for [GentleMail](https://gentlemail.dev), the open-source webmail, API and webhooks you run on your own Cloudflare account.

- Send, read, file and reply to mail through your instance's API.
- Verify webhook deliveries in one call.
- Typed from end to end. No dependencies. Runs on Cloudflare Workers, Node 20+, Deno and Bun.

```sh
npm install gentlemail
```

Full guide: [gentlemail.dev/docs/sdk](https://gentlemail.dev/docs/sdk/).

## Send

```ts
import { GentleMail } from "gentlemail";

const mail = new GentleMail({ url: "https://mail.example.com", apiKey: process.env.GENTLEMAIL_KEY! });

await mail.send({
  from: "support@example.com",
  to: "Ada Lovelace <ada@example.org>",
  subject: "Your order has shipped",
  text: "It should arrive on Friday.",
  attachments: [{ filename: "invoice.pdf", content: pdfBytes }], // bytes or base64
});
```

## Read

```ts
const unread = await mail.messages.list({ mailbox: "support@example.com", unread: true });
const message = await mail.messages.get(unread[0].id); // with text and HTML
await mail.messages.update(message.id, "archive");      // needs Organize: read, unread, star, unstar, archive, trash, spam, inbox
await mail.messages.reply(message, { text: "Thanks, we're on it." });

const file = await mail.attachments.download(message.attachments[0].url); // a Response
```

## Webhooks

```ts
import { GentleMail, verifyWebhook } from "gentlemail";

export default {
  async fetch(request: Request, env: Env) {
    const event = await verifyWebhook(request, env.WEBHOOK_SECRET).catch(() => null);
    if (!event) return new Response("Bad signature", { status: 401 });

    if (event.event === "message.received") {
      const mail = new GentleMail({ url: env.GENTLEMAIL_URL, apiKey: env.GENTLEMAIL_KEY });
      await mail.messages.reply(event.data, { text: "Got it, thanks!" });
    }
    return new Response("OK");
  },
};
```

With Express, verify the raw body: `verifyWebhook({ body: req.body, headers: req.headers }, secret)` behind `express.raw({ type: "application/json" })`.

## Errors

API errors throw `GentleMailError` with the HTTP `status` and a stable `code` (`mailbox_not_allowed`, `missing_body`, `not_found`…). A refused webhook throws `WebhookVerificationError` with a `reason`: `bad_signature`, `expired`, `missing_headers` or `invalid_json`.

## Versions

The SDK is versioned on its own; see [CHANGELOG.md](CHANGELOG.md). It works with GentleMail 0.3.0 and later.

MIT licensed.

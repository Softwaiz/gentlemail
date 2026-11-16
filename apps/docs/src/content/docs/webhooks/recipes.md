---
title: Recipes
description: Small Workers that turn GentleMail webhooks into invoice pipelines, chat alerts, phone notifications and auto-replies.
---

Each recipe is a small Cloudflare Worker (any HTTP server works the same way) that receives a webhook. They all start by [checking the signature](/docs/webhooks/verify/), and keep their secrets in Worker secrets: `WEBHOOK_SECRET` for the webhook and `GENTLEMAIL_KEY` for the API.

```ts
export default {
  async fetch(request: Request, env: Env) {
    const event = await verify(request, env.WEBHOOK_SECRET);
    if (!event) return new Response("Bad signature", { status: 401 });
    if (event.event !== "message.received") return new Response("Ignored");

    await handle(event.data, env); // one of the recipes below
    return new Response("OK");
  },
};
```

## Invoices that pay themselves

A webhook on `invoices@`, and a key with **Read** on that mailbox only. Each PDF is saved to R2 and queued for your payment pipeline.

```ts
async function handle(mail, env) {
  for (const file of mail.attachments) {
    if (file.content_type !== "application/pdf") continue;
    const pdf = await fetch(file.url, {
      headers: { Authorization: `Bearer ${env.GENTLEMAIL_KEY}` },
    });
    const key = `${mail.id}/${file.filename}`;
    await env.INVOICE_FILES.put(key, await pdf.arrayBuffer());
    await env.PAYMENTS.send({ key, from: mail.from.address, subject: mail.subject });
  }
}
```

## Support that answers in minutes

A webhook on `support@` that posts to a Slack incoming webhook. Discord, Teams and Mattermost work the same way.

```ts
async function handle(mail, env) {
  await fetch(env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `New email to ${mail.mailbox.address} from ${mail.from.name || mail.from.address}\n*${mail.subject}*\n${mail.snippet}`,
    }),
  });
}
```

## Your inbox, in your pocket

One webhook on all mailboxes, sending each message to Telegram. Create a bot with BotFather and put its token and your chat ID in Worker secrets. For a real summary instead of the first lines, pass `mail.text` to a model first, for example with Workers AI.

```ts
async function handle(mail, env) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: `${mail.mailbox.address}\nFrom: ${mail.from.name || mail.from.address}\n${mail.subject}\n\n${mail.snippet}`,
    }),
  });
}
```

## Out of office, handled

A webhook on the person's mailbox for `message.received` only, and a key with **Read** and **Send** on that mailbox (a reply needs both). A KV namespace remembers who already got an answer, so each person is told once and automated senders are never answered.

```ts
async function handle(mail, env) {
  const sender = mail.from.address.toLowerCase();
  if (/^(no-?reply|mailer-daemon|postmaster)@/.test(sender)) return;
  if (await env.REPLIED.get(sender)) return;

  await fetch("https://mail.example.com/api/v1/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GENTLEMAIL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mail.mailbox.address,
      reply_to_message_id: mail.id,
      text: "Thanks for your message. I'm away until Monday. For anything urgent, write to team@example.com.",
    }),
  });
  await env.REPLIED.put(sender, "1", { expirationTtl: 7 * 24 * 3600 });
}
```

Turn the webhook off in Admin when they're back.

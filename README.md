# GentleMail

Open-source, multi-domain webmail and email API that runs entirely on your own Cloudflare account.
One deployment serves any number of domains and mailboxes for the $5/month Workers Paid plan: no per-seat pricing, no API keys handed to a third party.

**Website:** https://gentlemail.dev · **Deploy guide:** https://gentlemail.dev/deploy · **Docs:** https://gentlemail.dev/docs

- **Inbox and outbox**: a real webmail for people (conversations, search, attachments, spam folder, blocking) and a REST API for code.
- **Many domains, one deployment**: add domains and mailboxes in the Admin page; assign users to the mailboxes they can use.
- **Webhooks**: signed `message.received` / `message.sent` events with retries, to automate invoices, support alerts and more.
- **Your infrastructure**: mail is stored in your D1 database and R2 bucket, and sent with Cloudflare Email Service.

## Repository

pnpm workspace. Apps live in `apps/*`, shared code in `packages/*`.

| App | Path | What |
|---|---|---|
| Mail | [`apps/mail`](apps/mail) | The webmail, API and webhooks (RedwoodSDK + D1 + R2 + Email Service). Features, security model and layout are in its [README](apps/mail/README.md). |

```sh
pnpm install
pnpm dev:mail      # local dev
```

To run your own instance, follow the [deploy guide](https://gentlemail.dev/deploy). Values specific to a deployment are marked ◆ in [`apps/mail/wrangler.jsonc`](apps/mail/wrangler.jsonc).

## Fork it

Missing something your product needs, like a mailboxes API, forwarding, or delivery to Telegram? Fork it and add it: mail comes in through `src/lib/inbound.ts` and goes out through `src/lib/outbound.ts`. Pull requests are welcome too.

## License

[MIT](LICENSE) © Softwaiz

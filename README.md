<p align="center"><img src="https://gentlemail.dev/brand/gentlemail-mark.svg" width="96" height="96" alt="GentleMail"></p>

# GentleMail

Open-source, multi-domain webmail, email API and webhooks that run entirely on your own Cloudflare account.
One deployment serves any number of domains, mailboxes and people for the $5/month Workers Paid plan: no per-seat pricing, no API keys handed to a third party.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Softwaiz/gentlemail/tree/main/apps/mail)

**Website:** https://gentlemail.dev · **Deploy guide:** https://gentlemail.dev/deploy · **API and webhook docs:** https://gentlemail.dev/docs

- **Inbox and outbox**: a real webmail for people (conversations, search, attachments, spam folder, blocking) and a REST API for code.
- **Many domains, one deployment**: add domains and mailboxes in Admin, and choose which people can open which mailboxes.
- **Webhooks**: signed `message.received` and `message.sent` events with retries, to automate invoices, support alerts and more.
- **Your infrastructure**: mail is stored in your own D1 database and R2 bucket, and sent with Cloudflare Email Service.

## Deploy your own

1. **Deploy.** Click **Deploy to Cloudflare** above. Cloudflare copies the app into a new repository on your GitHub account, creates the database and storage, asks for a one-time `SETUP_TOKEN`, then builds and deploys.
   Using a fork or clone of this whole repository with Workers Builds instead? Set **Root directory** to `apps/mail`.
2. **Claim it.** Open `/setup` on your new Worker and create the admin account.
3. **Connect a domain.** Add it in **Admin → Domains** and run the three commands it shows.
4. **Create mailboxes and users**, then send yourself a test message.

You need a Cloudflare account on Workers Paid and a domain whose DNS is on Cloudflare. The full guide (every step, configuration, an end-to-end test, updating and troubleshooting) is in **[apps/mail/README.md](apps/mail/README.md)**.

## Repository

| Path | What |
|---|---|
| [`apps/mail`](apps/mail) | The app: webmail, API and webhooks (RedwoodSDK, D1, R2, Email Service). Self-contained, and the folder the Deploy button copies. |

```sh
pnpm install
pnpm dev:mail      # local development, see apps/mail/README.md#local-development
```

## Fork it

Missing something your product needs, like a mailboxes API, forwarding, or delivery to Telegram? Fork it and add it: mail comes in through `apps/mail/src/lib/inbound.ts` and goes out through `apps/mail/src/lib/outbound.ts`. Issues, discussions and pull requests are welcome.

## License

[MIT](LICENSE) © Softwaiz

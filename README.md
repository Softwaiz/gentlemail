# GentleMail

Open-source, multi-domain webmail and email API that runs entirely on your own Cloudflare account.
One deployment serves any number of domains and mailboxes for the $5/month Workers Paid plan: no per-seat pricing, no API keys handed to a third party.

**Website:** https://gentlemail.dev · **Deploy guide:** https://gentlemail.dev/deploy · **Docs:** https://gentlemail.dev/docs

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Softwaiz/gentlemail/tree/main/apps/mail)

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

## Deploy your own

Click **Deploy to Cloudflare** above. Cloudflare copies `apps/mail` into a new repository on your GitHub account, creates the D1 database and R2 bucket, asks for a one-time `SETUP_TOKEN`, then builds and deploys. You need a domain on Cloudflare and the Workers Paid plan ($5/month).

Deploying a fork or clone of this whole repository through Workers Builds instead? Set **Root directory** to `apps/mail` under Settings → Builds → Advanced settings ([details](apps/mail/README.md#workers-builds-from-a-fork-or-clone-of-this-repository)).

Then open `/setup` on your new Worker, create the admin account and add your domain. The [deploy guide](https://gentlemail.dev/deploy) walks through every step, and [`apps/mail/README.md`](apps/mail/README.md#deploy) covers the command-line route.

## Fork it

Missing something your product needs, like a mailboxes API, forwarding, or delivery to Telegram? Fork it and add it: mail comes in through `src/lib/inbound.ts` and goes out through `src/lib/outbound.ts`. Pull requests are welcome too.

## License

[MIT](LICENSE) © Softwaiz

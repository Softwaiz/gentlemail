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

## No Cloudflare API token
GentleMail never asks for a Cloudflare API token or account ID. It uses D1, R2 and Email Service through Worker bindings, so nothing sensitive is pasted into the app and there's no token to rotate. The only login involved is your own Cloudflare account, when you deploy.

## Tech stack
Cloudflare Workers · [RedwoodSDK](https://rwsdk.com) (React 19 server components, Vite) · D1 (SQLite, plain SQL, **no ORM**) · R2 · Email Routing + Email Service · `postal-mime` · Tailwind CSS 4 + shadcn/ui · TypeScript.
Details, the database and migration commands, and a file-by-file map are in [apps/mail/README.md](apps/mail/README.md#tech-stack).

## Repository
A small [pnpm workspace](https://pnpm.io/workspaces) monorepo. Today it holds one app, which is self-contained: it has its own `package.json`, `wrangler.jsonc` and migrations, and builds and deploys on its own with npm or pnpm.

```
.
├── apps/
│   └── mail/                  the app: webmail, REST API and webhooks (one Cloudflare Worker)
│       ├── migrations/        D1 schema as numbered SQL files
│       ├── src/worker.tsx     Worker entry and routes
│       ├── src/app/           pages, server functions, REST API, UI components
│       ├── src/lib/           mail in/out, auth, spam, API keys, webhooks, queries
│       └── wrangler.jsonc     Worker config (template: set your own name and hostname)
├── packages/                  reserved for shared packages (empty for now)
├── package.json               workspace scripts
└── pnpm-workspace.yaml
```

| Path | What |
|---|---|
| [`apps/mail`](apps/mail) | The app. The folder the Deploy button copies, and the **Root directory** for Workers Builds. Full guide in its [README](apps/mail/README.md). |

### Commands
From the repository root (pnpm):
```sh
pnpm install
pnpm dev:mail                                    # local dev server, http://localhost:5173
pnpm --filter @emails/mail db:migrate:local      # apply migrations to the local database
pnpm --filter @emails/mail types                 # type-check
```
Or work inside `apps/mail` with npm (`npm install`, `npm run dev`, `npm run build`, `npm run deploy`). See [Scripts](apps/mail/README.md#scripts) and [Database and migrations](apps/mail/README.md#database-and-migrations): deploying applies pending migrations to your D1 database first, and `npx wrangler d1 migrations apply DB --remote` does it by hand.

## Fork it

Missing something your product needs, like a mailboxes API, forwarding, or delivery to Telegram? Fork it and add it: mail comes in through `apps/mail/src/lib/inbound.ts` and goes out through `apps/mail/src/lib/outbound.ts`. Issues, discussions and pull requests are welcome.

## License

[MIT](LICENSE) © Softwaiz

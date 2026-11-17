# GentleMail

Multi-domain webmail, email API and webhooks that run entirely on your own Cloudflare account, built with [RedwoodSDK](https://rwsdk.com). One deployment serves any number of domains, mailboxes and people, for the $5/month Workers Paid plan.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Softwaiz/gentlemail/tree/main/apps/mail)

Website: https://gentlemail.dev · [Deploy guide](https://gentlemail.dev/docs/deploy/) · [API and webhook docs](https://gentlemail.dev/docs) · Source: https://github.com/Softwaiz/gentlemail

- **Receive**: Email Routing catch-all on your domain → this Worker's `email()` handler → parsed with `postal-mime`
- **Store**: messages, mailboxes, users and sessions in **D1**; raw `.eml`, attachments and oversized HTML in **R2**
- **Send**: Cloudflare Email Service `send_email` binding (no API key; Workers Paid includes 3,000 a month, then $0.35 per 1,000)

**No Cloudflare API token, no account ID.** GentleMail never calls the Cloudflare API. It talks to D1, R2 and Email Service through [bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/) declared in `wrangler.jsonc`, which the Worker gets automatically when it's deployed. So there's no `CLOUDFLARE_API_TOKEN` or account ID to create, paste or rotate in the app. The only Cloudflare login involved is your own: the Deploy button and Workers Builds use your dashboard session, and the command line uses `wrangler login`.

## Contents
1. [What you need](#what-you-need)
2. [Deploy](#1-deploy)
3. [Create the admin account](#2-create-the-admin-account)
4. [Connect a domain](#3-connect-a-domain)
5. [Create mailboxes and users](#4-create-mailboxes-and-users)
6. [Use your own hostname (optional)](#5-use-your-own-hostname-optional)
7. [Test it end to end](#6-test-it-end-to-end)
8. [Configuration](#configuration) · [Updating](#updating) · [Troubleshooting](#troubleshooting)
9. [Features](#features) · [Spam](#spam) · [API & webhooks](#api--webhooks) · [Security](#security-of-displayed-mail)
10. [Tech stack](#tech-stack) · [Database and migrations](#database-and-migrations) · [Layout](#layout) · [Scripts](#scripts) · [Local development](#local-development)

## What you need
- A **Cloudflare account on the Workers Paid plan** ($5/month). It includes the outbound email.
- At least one **domain whose DNS is on Cloudflare**, in the same account. A domain has a single Email Routing catch-all, so use a domain (or subdomain) that isn't already routed to another Worker.
- A **GitHub account**, for the Deploy button or Workers Builds.

## 1. Deploy
Pick one of three ways. They all end with the same Worker.

**Deploy to Cloudflare button (recommended).** Click the button above. Cloudflare copies this app into a new repository on your GitHub account, lets you choose the Worker name, creates the D1 database and the R2 bucket, asks for `SETUP_TOKEN` (any long random string, for example from `openssl rand -hex 32`), then builds and deploys. Every later push to that repository deploys again, with the database migrations applied first. The app sits at the root of that repository, so there's no path to set.

**Workers Builds from a fork or clone of the whole repository.** Connect the repository to a Worker, then in **Settings → Builds → Advanced settings** set:

| Setting | Value |
|---|---|
| Root directory | `apps/mail` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` (applies the D1 migrations, then deploys) |

Add `SETUP_TOKEN` as a secret under **Settings → Variables and Secrets**. The deploy command's migration step needs the D1 database to exist; if the very first build stops there, do the first deploy from the command line (below), then retry the build.

**Command line.** From `apps/mail`, the first time:
```sh
npm install
npm run build
npx wrangler deploy                            # creates the Worker, the D1 database and the R2 bucket named in wrangler.jsonc
npx wrangler d1 migrations apply DB --remote   # creates the tables
npx wrangler secret put SETUP_TOKEN            # any long random string, used once at /setup
```
Use `wrangler deploy` directly this first time: `npm run deploy` applies the migrations *before* deploying, and the database doesn't exist yet. From then on, deploy with `npm run build && npm run deploy` (the `deploy` script doesn't build).

## 2. Create the admin account
Open `https://<your-worker>.<your-subdomain>.workers.dev/setup`, enter your `SETUP_TOKEN` and create the admin account. The setup page works only once.

## 3. Connect a domain
1. In the app, open **Admin → Domains → Add domain** and enter the domain. Its page shows a live DNS check and these commands, already filled in:
   ```sh
   npx wrangler email sending enable example.com    # allow sending from *@example.com
   npx wrangler email routing enable example.com    # receive mail: adds the MX and SPF records
   npx wrangler email routing rules update example.com catch-all \
     --action-type worker --action-value <your-worker-name> --enabled true
   ```
2. The last command sends every address on the domain to GentleMail. In the dashboard, the same setting is the domain's **Email → Email Routing → Routing rules → Catch-all**: action **Send to a Worker**, your Worker, enabled.
3. Back on the domain's page, the DNS check should be green.

Address-specific routing rules (for example a forward to Gmail) keep priority over the catch-all. Mail to an address with no mailbox is rejected with 550.

## 4. Create mailboxes and users
In **Admin**, create mailboxes (`anything@any-connected-domain`) and users, and choose which mailboxes each user can open. Admins can open them all. There's no limit on either.

## 5. Use your own hostname (optional)
The app runs on `workers.dev` until you give it a hostname like `mail.example.com`: add it under the Worker's **Settings → Domains & Routes**, or uncomment `routes` in `wrangler.jsonc`. Then set `PUBLIC_URL` to it, so links in webhook payloads are absolute.

## 6. Test it end to end
1. **Receive:** from another address (Gmail, for example), write to one of your mailboxes. It should appear in its Inbox within seconds.
2. **Unknown address:** write to an address with no mailbox. The sender should get a bounce (550).
3. **Send:** reply from GentleMail. It should arrive in Gmail's inbox, and Gmail's **Show original** should say `SPF: PASS` and `DKIM: PASS`.
4. **API:** create a key with the `send` scope in **Admin → API & webhooks**, then:
   ```sh
   curl -X POST https://<your-app>/api/v1/send \
     -H "Authorization: Bearer gm_…" -H "Content-Type: application/json" \
     -d '{"from":"hello@example.com","to":"you@gmail.com","subject":"Test","text":"It works."}'
   ```
   It answers `201` with `"status": "sent"`, and the message shows in **Sent**.
5. **Webhook:** add a webhook for `message.received` pointing at a request inspector, send yourself a message, and check the signed JSON arrives.

## Configuration
Values in `wrangler.jsonc` (marked ◆), plus one secret:

| Name | What it does |
|---|---|
| `name` | The Worker name, and the Email Routing catch-all target. The app reads it at build time to fill in the domain setup commands. |
| `routes` | Optional hostnames to serve the app on (see step 5). |
| `PUBLIC_URL` | The app's public address, used for links in webhook payloads. Empty means relative links. |
| `APP_NAME` | Name shown in the interface and the browser tab. |
| `SPAM_SCORE_THRESHOLD` | Optional. Move mail to Spam when Cloudflare's spam score (`X-Cf-Spamh-Score`, up to 5, higher is spammier) reaches this value. Empty or `0` means off. If you turn it on, start at `5` and lower to `4` only if junk still gets through. |
| `SETUP_TOKEN` (secret) | One-time token for `/setup`. Listed in `.dev.vars.example`. |

## Updating
Your repository is yours to change. To pick up a new release, add this repository as a remote and pull from it. A repository made by the Deploy button has no history in common with this one, which is why the first pull needs the extra step below.
```sh
git remote add upstream https://github.com/Softwaiz/gentlemail

# Repository made by the Deploy button (the app is at its root):
git pull -X subtree=apps/mail upstream main && git push

# Fork or clone of the whole repository:
git pull upstream main && git push
```
The first pull into a Deploy-button repository also needs `--allow-unrelated-histories`, and Git reports every file changed since you deployed as a conflict. Keep GentleMail's version (`git checkout --theirs .`), restore your own `wrangler.jsonc` and any file you changed (`git checkout --ours wrangler.jsonc`), then commit. Later pulls merge normally.

Then deploy the update:
- **Repository connected to Workers Builds** (the Deploy button sets this up): the `git push` deploys, migrations included.
- **Command line**: a push deploys nothing. Run `npm run build && npm run deploy` from `apps/mail` (it applies the new migrations, then deploys).

## Troubleshooting
| Symptom | Check |
|---|---|
| The build fails right away on a full copy of the repository | Root directory must be `apps/mail` (step 1). |
| `/setup` says the token is missing | Set the `SETUP_TOKEN` secret, then reload. |
| Mail sent to you never arrives | Email Routing is enabled on the domain, and its catch-all is set to **Send to a Worker** with this Worker (step 3). |
| Senders get a 550 bounce | The address has no mailbox, or its domain or mailbox is turned off in **Admin**. |
| Sending fails | Run `npx wrangler email sending enable <domain>` for the sender's domain, and check the account is on Workers Paid. |
| Mail lands in Spam | See [Spam](#spam). **Not spam** moves it back and trusts the sender. |

## Features
- Admin adds domains (with a live DNS check and the exact setup commands), creates mailboxes (`anything@any-added-domain`) and users, and assigns who can use which mailbox
- Disabling a domain rejects its inbound mail and blocks sending from it
- Inbox / Sent / Archive / Spam / Trash, conversations (threaded by `In-Reply-To`/`References`, subject fallback), search
- Compose, reply, reply-all, forward (forwards original attachments), file attachments up to 25 MB
- Per-mailbox sender name + signature (toggle per message)
- Attachments: view (images/PDF/text) or download; inline `cid:` images; download original `.eml`
- HTML mail rendered in a sandboxed iframe, scripts blocked, remote images blocked unless you click "Open with images"
- Mail to unknown/disabled addresses is rejected with 550

## Spam
Cloudflare Email Routing rejects mail that fails SPF and DKIM, fails the sender's DMARC policy, or comes from a blocklisted server, before it reaches the app. Of the rest, a message goes to **Spam** when:
1. you blocked its sender (marking a conversation as spam blocks that address for the mailbox),
2. it arrives flagged `X-Spam-Flag: YES`,
3. DMARC failed but wasn't enforced (`p=none` or `p=quarantine`),
4. `SPAM_SCORE_THRESHOLD` is set and Cloudflare's `X-Cf-Spamh-Score` reaches it (off by default).

"Not spam" moves it back and trusts the sender from then on; trusted senders skip every rule. Both lists are under **Mailbox settings**. Spam doesn't trigger webhooks and is deleted after 30 days by the hourly purge.

## API & webhooks
Create keys and webhooks in **Admin → API & webhooks** (the page has a full quick reference).

- **API keys** carry exactly the access you give them: **Read** and/or **Send**, set separately on all mailboxes, on whole domains (which also covers mailboxes added to the domain later) and on individual mailboxes. A key can mix them, for example read on all of `example.com` plus send from `billing@other.com` only. Change a key's access at any time with **Edit access**; the program keeps the same key. Only a SHA-256 fingerprint of the key is stored.
  - `GET /api/v1/mailboxes` lists the mailboxes the key can use, with `"permissions": ["read", "send"]` on each.
  - `POST /api/v1/send`: JSON `{from, to, cc, bcc, subject, text, html, attachments: [{filename, content (base64), content_type}], reply_to_message_id, signature}`. Replying with `reply_to_message_id` also needs Read on that mailbox, since the reply quotes and threads the original.
  - `GET /api/v1/mailboxes`, `GET /api/v1/messages?mailbox=&folder=&unread=true&since=`, `GET /api/v1/messages/:id`, `POST /api/v1/messages/:id {"action": "archive"}`, `GET /api/v1/attachments/:id`
- **Webhooks** receive `message.received` (not for spam) and/or `message.sent` as signed JSON:
  `X-GentleMail-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>`. Non-2xx answers are retried after 1 min, 5 min, 30 min, 2 h, 6 h and 12 h by a once-a-minute cron.

## Two-step verification
Everyone can turn on two-step verification under **Security** (the menu under their name). It works with any authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden, Authy…): after the password, signing in asks for the 6-digit code from the app.
- Setting it up gives **10 recovery codes**, shown once, to download as a `.txt` or copy. Each signs in once without the phone. New codes can be made at any time (the old ones stop working).
- A sign-in allows 5 wrong codes, then asks for the password again; a code can't be used twice.
- **Admin → Users → Require two-step verification for everyone** makes it mandatory: people without it can only open the Security page until they've set it up. When it's off, each person decides for themselves.
- **Reset two-step** (Admin → Users) is for someone who lost their phone and their recovery codes: it turns two-step off and signs them out everywhere, so they sign in with their password and set it up again.

## Security of displayed mail
Incoming HTML is untrusted. Three independent layers keep it inert:
1. **Sanitising**: scripts, event handlers (`onclick`, `onerror`…), `javascript:` links, iframes, objects, forms, `<base>`, `<link>` and `<meta>` are stripped with Cloudflare's HTML parser before display.
2. **CSP**: `script-src 'none'`, no remote loads (images, CSS, fonts) unless you click "Open with images", `form-action 'none'`, `base-uri 'none'`.
3. **Sandbox**: the body is shown in an iframe without `allow-scripts`, and the same sandbox is sent as a CSP header, so it also holds when the body URL is opened directly.

Session cookies are `HttpOnly` and `SameSite=Lax`, and attachments of risky types (HTML, SVG…) are always downloaded, never displayed.

## Tech stack
| Layer | What | Notes |
|---|---|---|
| Runtime | [Cloudflare Workers](https://developers.cloudflare.com/workers/) | One Worker handles HTTP (`fetch`), inbound mail (`email`) and the cron (`scheduled`). |
| Framework | [RedwoodSDK](https://rwsdk.com) (`rwsdk`) on React 19 | Server components, server functions (`serverAction` / `serverQuery`), route middleware. Built with Vite and `@cloudflare/vite-plugin`. |
| Database | [D1](https://developers.cloudflare.com/d1/) (SQLite) | Plain SQL, no ORM. See [Database and migrations](#database-and-migrations). |
| File storage | [R2](https://developers.cloudflare.com/r2/) | Raw `.eml`, attachments, large HTML bodies. |
| Inbound mail | [Email Routing](https://developers.cloudflare.com/email-routing/) → Worker, parsed with [`postal-mime`](https://github.com/postalsys/postal-mime) | |
| Outbound mail | [Email Service](https://developers.cloudflare.com/email-service/) `send_email` binding | No API key. |
| UI | Tailwind CSS 4, [shadcn/ui](https://ui.shadcn.com) components on Radix, `lucide-react` icons, `sonner` toasts | |
| Auth | Own code: PBKDF2 password hashes, sessions in D1, `HttpOnly` cookie | No external identity provider. |
| Language / tooling | TypeScript, Wrangler 4, npm or pnpm | |

## Database and migrations
**No ORM.** Queries are plain SQL run through the D1 binding with prepared statements and bound parameters (`env.DB.prepare("… WHERE id = ?").bind(id)`). Row shapes are TypeScript types next to the queries (`src/lib/db.ts` and each `src/lib/*.ts`). There's no Drizzle, Kysely or Prisma to learn or generate.

**Schema changes are SQL files** in `migrations/`, numbered in order (`0001_init.sql`, `0002_domains.sql`, …). D1 records which ones it has applied in a `d1_migrations` table, so each runs once.

| When | Command (from `apps/mail`) |
|---|---|
| Deploying with the Deploy button, Workers Builds or `npm run deploy` | Nothing to do: the `deploy` script runs `wrangler d1 migrations apply DB --remote` before `wrangler deploy`. Exception: the very first command-line deploy, see [Deploy](#1-deploy). |
| Apply pending migrations to your Cloudflare D1 by hand | `npx wrangler d1 migrations apply DB --remote` |
| See which migrations are pending | `npx wrangler d1 migrations list DB --remote` |
| Apply them to your local dev database | `npm run db:migrate:local` |
| Add a migration (when changing the schema) | `npx wrangler d1 migrations create DB short_description`, then write the SQL in the new file |
| Run a query against production | `npx wrangler d1 execute DB --remote --command "SELECT COUNT(*) FROM messages"` |

`DB` is the binding name from `wrangler.jsonc`, so these commands work whatever you named the database. After pulling a new release, deploying it the usual way applies its migrations (see [Updating](#updating)).

## Layout
```
apps/mail/
├── wrangler.jsonc           Worker config: name, routes, D1/R2/Email bindings, cron, vars
├── vite.config.mts          Vite + Cloudflare plugin + RedwoodSDK; injects the Worker name at build time
├── package.json             scripts (see below) and the descriptions the Deploy button shows
├── .dev.vars.example        secrets the app expects (SETUP_TOKEN)
├── migrations/              D1 schema as numbered SQL files, applied in order
├── public/                  static files (favicon)
├── types/                   ambient TypeScript types
└── src/
    ├── worker.tsx           Worker entry (fetch, email, scheduled) and every route
    ├── client.tsx           browser entry (hydrates client components)
    ├── app/
    │   ├── document.tsx     HTML shell
    │   ├── headers.ts       security headers and CSP
    │   ├── http.ts          redirects, CSRF origin check, sign-in middleware
    │   ├── access.tsx       route middleware: admin only, mailbox access, 404 / 403
    │   ├── api.ts           public REST API (/api/v1)
    │   ├── actions/         server functions: serverAction (mutations), serverQuery (reads);
    │   │                    each checks access itself (guards.ts), whatever page it is posted to
    │   ├── pages/           pages (server components): mailbox, compose, admin, domains, developers, auth, errors
    │   └── components/      shared UI; ui/ holds the shadcn components
    └── lib/
        ├── db.ts            row types and shared queries (mailbox access, attachments…)
        ├── auth.ts          PBKDF2 passwords, D1 sessions
        ├── inbound.ts       receive: parse → spam rules → D1/R2 → webhooks
        ├── outbound.ts      send via the EMAIL binding → saved in Sent
        ├── threads.ts       conversation grouping
        ├── spam.ts          spam rules, sender lists, 30-day purge
        ├── apikeys.ts       API keys and their access checks
        └── webhooks.ts      webhook signing, delivery, retries
```

## Scripts
Run from `apps/mail` with `npm run <script>` (or `pnpm <script>`).

| Script | What it does |
|---|---|
| `dev` | Local dev server with local D1/R2 (Miniflare) on http://localhost:5173 |
| `build` | Production build into `dist/` |
| `deploy` | Applies remote D1 migrations, then `wrangler deploy` (what the Deploy button and Workers Builds run, after `build`). It doesn't build, so run `build` first; and the database must already exist (see [Deploy](#1-deploy)) |
| `db:migrate:local` / `db:migrate:remote` | Apply migrations to the local or the remote database |
| `generate` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` (after changing bindings or vars) |
| `types` | Type-check with `tsc` |
| `check` | `generate`, then `types` (calls pnpm) |
| `preview` | Serve the production build locally |
| `clean` | Delete Vite's cache (`node_modules/.vite`), the fix when the dev server reports a missing module |
| `release` | Clean, apply remote migrations, build and deploy in one go (calls pnpm; needs a Cloudflare login) |
| `dev:init` / `worker:run` | RedwoodSDK helpers: prepare the dev environment, and run a script inside the Worker environment (`npm run worker:run ./path/to/script.ts`) |

## Local development
```sh
echo 'SETUP_TOKEN=local-dev-setup-token' > .dev.vars
npm run db:migrate:local
npm run dev
# open http://localhost:5173/setup
# simulate inbound mail:
curl -X POST "http://localhost:5173/cdn-cgi/handler/email?from=a@example.org&to=hello@your-domain" --data-binary @some.eml
```
Outbound mail is simulated locally (written under `.wrangler/tmp/email`).

## License
[MIT](https://github.com/Softwaiz/gentlemail/blob/main/LICENSE) © Softwaiz

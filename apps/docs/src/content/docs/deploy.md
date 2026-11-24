---
title: Deploy
description: Deploy GentleMail to your Cloudflare account, create the admin account, connect a domain and test it end to end.
---

## Before you start

- **A domain on Cloudflare.** Its DNS must be managed by Cloudflare. Connect as many domains as you like, all in the same account.
- **The Workers Paid plan.** $5 a month per Cloudflare account. It lets the Worker send to any address and covers everything GentleMail uses: incoming mail is unlimited, 3,000 sent emails a month are included, and every mailbox, person and domain is free. See [pricing](https://gentlemail.dev/#pricing) for the rest.
- **A GitHub account,** for your copy of GentleMail: a repository of yours, where every push deploys again.

Then count about ten minutes from the first click to a working inbox on your own domain.

## 1. Deploy the Worker

Pick one of these ways. They all end with the same Worker; what changes is how you get our releases afterwards.

| | Our releases | Good for |
|---|---|---|
| **A clone in your own repository** (recommended) | `git pull`, your settings kept | An instance you keep |
| **Deploy to Cloudflare button** | Its copy doesn't follow them: the first update is settled by hand | Trying GentleMail |
| **Command line only** | `git pull`, then deploy yourself | Deploying from your computer |

### A clone in your own repository (recommended)

Your repository keeps GentleMail's history, so a release is one `git pull`. It can be private. You need Git, [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io/installation).

1. Create an empty repository on GitHub (no README), then:
   ```sh
   git clone https://github.com/Softwaiz/gentlemail my-gentlemail
   cd my-gentlemail
   git remote rename origin upstream      # where releases come from
   git remote add origin https://github.com/<you>/<your-repository>.git
   ```
2. Choose your Worker name: change `name` in `apps/mail/wrangler.jsonc`.
3. Deploy once from your computer. It creates the Worker, the database and the storage, which the builds need to exist:
   ```sh
   cd apps/mail
   pnpm install
   npx wrangler login
   pnpm run build
   npx wrangler deploy                            # the Worker, the D1 database and the R2 bucket
   npx wrangler d1 migrations apply DB --remote   # the tables
   npx wrangler secret put SETUP_TOKEN            # any long random string, used once at /setup
   ```
4. Commit your `wrangler.jsonc` and push:
   ```sh
   git commit -am "My settings"
   git push -u origin main
   ```
5. So that every push deploys, open your Worker in the Cloudflare dashboard, connect the repository under **Settings → Builds**, and set:

   | Setting | Value |
   |---|---|
   | Root directory | `apps/mail` |
   | Build command | `npm run build` |
   | Deploy command | `npm run deploy` (applies the database migrations, then deploys) |

Forking on GitHub works the same way, and updates with its **Sync fork** button. A fork of a public repository is always public, your `wrangler.jsonc` included.

### Deploy to Cloudflare button

The quickest way to try GentleMail. [Click it](https://deploy.workers.cloudflare.com/?url=https://github.com/Softwaiz/gentlemail/tree/main/apps/mail): Cloudflare copies the app into a new repository on your GitHub account, lets you choose the Worker name, creates the D1 database and the R2 bucket, asks for `SETUP_TOKEN` (any long random string, for example from `openssl rand -hex 32`), then builds and deploys. Every later push to that repository deploys again, with the database migrations applied first. The app sits at the root of that repository, so there's no path to set.

That copy isn't connected to GentleMail's repository: it doesn't follow our releases, and [updating it](/docs/updating/#a-repository-made-by-the-deploy-button) takes more steps.

### Command line only

Steps 1 to 3 above, without a repository of your own: clone, set the Worker name, deploy. From then on, deploy with `npm run build && npm run deploy` from `apps/mail` (the first time, `npm run deploy` would stop: it applies the migrations before the database exists, and it doesn't build).

## 2. Create the admin account

Open `https://<your-worker>.<your-subdomain>.workers.dev/setup`, enter your `SETUP_TOKEN` and create the admin account. The setup page works only once.

## 3. Connect a domain

1. In the app, open **Admin → Domains → Add domain**. Its page shows a live DNS check and these commands, already filled in:
   ```sh
   npx wrangler email sending enable example.com    # allow sending from *@example.com
   npx wrangler email routing enable example.com    # receive mail: adds the MX and SPF records
   npx wrangler email routing rules update example.com catch-all \
     --action-type worker --action-value <your-worker-name> --enabled true
   ```
2. The last command sends every address on the domain to GentleMail. In the dashboard it's the domain's **Email → Email Routing → Routing rules → Catch-all**: **Send to a Worker**, your Worker, enabled.
3. Back on the domain's page, the DNS check should be green.

Address-specific routing rules (a forward to Gmail, for example) keep priority over the catch-all. Mail to an address with no mailbox is rejected with 550.

## 4. Create mailboxes and users

In **Admin**, create mailboxes (`anything@any-connected-domain`) and users, and choose which mailboxes each user can open. Then ask everyone to turn on [two-step verification](/docs/guides/two-step/), or require it.

## 5. Use your own hostname (optional)

The app runs on `workers.dev` until you give it a hostname like `mail.example.com`: add it under the Worker's **Settings → Domains & Routes**, or in `routes` in `wrangler.jsonc`. Then set `PUBLIC_URL` to it, so links in webhook payloads are absolute.

## 6. Test it end to end

1. **Receive:** from another address, write to one of your mailboxes. It appears in its Inbox within seconds.
2. **Unknown address:** write to an address with no mailbox. The sender gets a bounce (550).
3. **Send:** reply from GentleMail. In Gmail, **Show original** should say `SPF: PASS` and `DKIM: PASS`.
4. **API:** create a key with **Send** on that mailbox in **Admin → API & webhooks**, then [send a message](/docs/api/send/).
5. **Webhook:** add a webhook for `message.received` pointing at a request inspector, and send yourself a message.

## Configuration

Values in `wrangler.jsonc`, plus one secret:

| Name | What it does |
|---|---|
| `name` | The Worker name, and the Email Routing catch-all target. |
| `routes` | Optional hostnames to serve the app on. |
| `PUBLIC_URL` | The app's public address, used for links in webhook payloads. Empty means relative links. |
| `APP_NAME` | Name shown in the interface and the browser tab. |
| `SPAM_SCORE_THRESHOLD` | Optional. See [Spam](/docs/guides/spam/). |
| `SETUP_TOKEN` (secret) | One-time token for `/setup`. |

## Troubleshooting

| Symptom | Check |
|---|---|
| The build fails right away on a full copy of the repository | Root directory must be `apps/mail`. |
| `/setup` says the token is missing | Set the `SETUP_TOKEN` secret, then reload. |
| Mail sent to you never arrives | Email Routing is on for the domain, and its catch-all sends to this Worker. |
| Senders get a 550 bounce | The address has no mailbox, or its domain or mailbox is turned off in Admin. |
| Sending fails | Run `npx wrangler email sending enable <domain>`, and check the account is on Workers Paid. |
| Errors right after an update | A database migration wasn't applied. See [Updating](/docs/updating/). |

# GentleMail

Multi-domain webmail, email API and webhooks that run entirely on your own Cloudflare account, built with [RedwoodSDK](https://rwsdk.com). One deployment serves any number of domains, mailboxes and people, for the $5/month Workers Paid plan.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Softwaiz/gentlemail/tree/main/apps/mail)

Website: https://gentlemail.dev · [Deploy guide](https://gentlemail.dev/deploy) · [API and webhook docs](https://gentlemail.dev/docs) · Source: https://github.com/Softwaiz/gentlemail

- **Receive**: Email Routing catch-all on your domain → this Worker's `email()` handler → parsed with `postal-mime`
- **Store**: messages, mailboxes, users and sessions in **D1**; raw `.eml`, attachments and oversized HTML in **R2**
- **Send**: Cloudflare Email Service `send_email` binding (no API key; Workers Paid includes 3,000 a month, then $0.35 per 1,000)

## Contents
1. [What you need](#what-you-need)
2. [Deploy](#1-deploy)
3. [Create the admin account](#2-create-the-admin-account)
4. [Connect a domain](#3-connect-a-domain)
5. [Create mailboxes and users](#4-create-mailboxes-and-users)
6. [Use your own hostname (optional)](#5-use-your-own-hostname-optional)
7. [Test it end to end](#6-test-it-end-to-end)
8. [Configuration](#configuration) · [Updating](#updating) · [Troubleshooting](#troubleshooting)
9. [Features](#features) · [Spam](#spam) · [API & webhooks](#api--webhooks) · [Security](#security-of-displayed-mail) · [Layout](#layout) · [Local development](#local-development)

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

Add `SETUP_TOKEN` as a secret under **Settings → Variables and Secrets**.

**Command line.** From `apps/mail`:
```sh
npm install
npx wrangler secret put SETUP_TOKEN   # any long random string, used once at /setup
npm run build && npm run deploy       # applies D1 migrations, then deploys
```
Wrangler creates the D1 database and the R2 bucket named in `wrangler.jsonc` on the first deploy.

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
Your repository is yours to change. To pick up a new release, pull it and push: the push deploys.
```sh
git remote add upstream https://github.com/Softwaiz/gentlemail

# Repository made by the Deploy button (the app is at its root):
git pull -X subtree=apps/mail upstream main && git push

# Fork or clone of the whole repository:
git pull upstream main && git push
```
The first pull into a Deploy-button repository also needs `--allow-unrelated-histories`, and Git reports every file changed since you deployed as a conflict. Keep GentleMail's version (`git checkout --theirs .`), restore your own `wrangler.jsonc` and any file you changed (`git checkout --ours wrangler.jsonc`), then commit. Later pulls merge normally.

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

- **API keys** are limited to one mailbox or all, and to `send` and/or `read`. Only a SHA-256 fingerprint is stored.
  - `POST /api/v1/send`: JSON `{from, to, cc, bcc, subject, text, html, attachments: [{filename, content (base64), content_type}], reply_to_message_id, signature}`
  - `GET /api/v1/mailboxes`, `GET /api/v1/messages?mailbox=&folder=&unread=true&since=`, `GET /api/v1/messages/:id`, `POST /api/v1/messages/:id {"action": "archive"}`, `GET /api/v1/attachments/:id`
- **Webhooks** receive `message.received` (not for spam) and/or `message.sent` as signed JSON:
  `X-GentleMail-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>`. Non-2xx answers are retried after 1 min, 5 min, 30 min, 2 h, 6 h and 12 h by a once-a-minute cron.

## Security of displayed mail
Incoming HTML is untrusted. Three independent layers keep it inert:
1. **Sanitising**: scripts, event handlers (`onclick`, `onerror`…), `javascript:` links, iframes, objects, forms, `<base>`, `<link>` and `<meta>` are stripped with Cloudflare's HTML parser before display.
2. **CSP**: `script-src 'none'`, no remote loads (images, CSS, fonts) unless you click "Open with images", `form-action 'none'`, `base-uri 'none'`.
3. **Sandbox**: the body is shown in an iframe without `allow-scripts`, and the same sandbox is sent as a CSP header, so it also holds when the body URL is opened directly.

Session cookies are `HttpOnly` and `SameSite=Lax`, and attachments of risky types (HTML, SVG…) are always downloaded, never displayed.

## Layout
```
migrations/                D1 schema (0001 init, 0002 domains, 0003 API keys + webhooks, 0004 sender rules)
src/worker.tsx             routes + Worker entry (fetch + email)
src/lib/inbound.ts         receive → D1/R2
src/lib/outbound.ts        send via EMAIL binding → saved in "sent"
src/lib/threads.ts         conversation grouping
src/lib/apikeys.ts         API key creation and checks
src/lib/webhooks.ts        webhook signing, delivery, retries
src/app/api.ts             public /api/v1 routes
src/app/actions/           server functions: serverAction (mutations) and serverQuery (data only);
                           each checks access itself (guards.ts), whatever page it is posted to
src/lib/spam.ts            spam rules, sender lists, 30-day purge
src/lib/auth.ts            PBKDF2 passwords, D1 sessions
src/app/pages/*            UI (server components + plain HTML forms)
```

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

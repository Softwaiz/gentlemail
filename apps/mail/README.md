# Mail

Self-hosted, multi-domain, multi-mailbox webmail running entirely on Cloudflare, built with [RedwoodSDK](https://rwsdk.com).
One shared deployment serves any number of domains. Domains, mailboxes and users are managed in the app's **Admin** page.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Softwaiz/gentlemail/tree/main/apps/mail)

Website and guides: https://gentlemail.dev · [Deploy guide](https://gentlemail.dev/deploy) · [API and webhook docs](https://gentlemail.dev/docs)

- **Receive**: Email Routing catch-all on your domain → this Worker's `email()` handler → parsed with `postal-mime`
- **Store**: messages, mailboxes, users, sessions in **D1**; raw `.eml`, attachments and oversized HTML in **R2**
- **Send**: Cloudflare Email Service `send_email` binding (no API key; included in Workers Paid: 3,000/month, then $0.35/1,000)

## Features
- Admin adds domains (with a live DNS check and the exact setup commands), creates mailboxes (`anything@any-added-domain`) and users, and assigns who can use which mailbox
- Disabling a domain rejects its inbound mail and blocks sending from it
- Inbox / Sent / Archive / Spam / Trash, conversations (threaded by `In-Reply-To`/`References`, subject fallback), search
- Compose, reply, reply-all, forward (forwards original attachments), file attachments up to 25 MB
- Per-mailbox sender name + signature (toggle per message)
- Attachments: view (images/PDF/text) or download; inline `cid:` images; download original `.eml`
- HTML mail rendered in a sandboxed iframe, scripts blocked, remote images blocked unless you click "Open with images"
- Mail to unknown/disabled addresses is rejected with 550

## Security of displayed mail
Incoming HTML is untrusted. Three independent layers keep it inert:
1. **Sanitising**: scripts, event handlers (`onclick`, `onerror`…), `javascript:` links, iframes, objects, forms, `<base>`, `<link>` and `<meta>` are stripped with Cloudflare's HTML parser before display.
2. **CSP**: `script-src 'none'`, no remote loads (images, CSS, fonts) unless you click "Open with images", `form-action 'none'`, `base-uri 'none'`.
3. **Sandbox**: the body is shown in an iframe without `allow-scripts`, and the same sandbox is sent as a CSP header, so it also holds when the body URL is opened directly.

Session cookies are `HttpOnly` and `SameSite=Lax`, and attachments of risky types (HTML, SVG…) are always downloaded, never displayed.

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
pnpm db:migrate:local
pnpm dev
# open http://localhost:5173/setup
# simulate inbound mail:
curl -X POST "http://localhost:5173/cdn-cgi/handler/email?from=a@example.org&to=hello@your-domain" --data-binary @some.eml
```
Outbound mail is simulated locally (written under `.wrangler/tmp/email`).

## Deploy

### One click
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Softwaiz/gentlemail/tree/main/apps/mail)

The button copies this folder into a new repository on your GitHub account, creates the D1 database and the R2 bucket, asks for `SETUP_TOKEN` (any long random string, typed once at `/setup`), then builds and deploys. Every later push to that repository deploys again, with the database migrations applied first.

You need a domain on Cloudflare and the Workers Paid plan ($5/month), which includes the outbound email. When the deploy finishes:
1. Open `https://<your-worker>.workers.dev/setup` and create the admin account with your `SETUP_TOKEN`.
2. Add your domain in **Admin → Domains** and run the commands it shows (below).
3. Optional: serve the app on your own hostname by uncommenting `routes` in `wrangler.jsonc`, or under **Settings → Domains & Routes** in the dashboard.

### From the command line
```sh
npx wrangler secret put SETUP_TOKEN   # first deploy only: any long random string, used once at /setup
pnpm build && pnpm run deploy         # applies D1 migrations, then deploys
```
Wrangler creates the D1 database and R2 bucket named in `wrangler.jsonc` on the first deploy.

### Workers Builds from a fork or clone of this repository
If you connect a copy of the whole repository to Workers Builds yourself (instead of using the button), tell Cloudflare where the app is. In your Worker, open **Settings → Builds → Advanced settings** and set:

| Setting | Value |
|---|---|
| Root directory | `apps/mail` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` (applies the D1 migrations, then deploys) |

The Deploy button doesn't need this: it copies `apps/mail` to the root of your new repository.

### Configuration
`wrangler.jsonc` is the template every deployment starts from; values marked ◆ are yours to change in your copy (Worker name, hostnames, `PUBLIC_URL`, `APP_NAME`). The Worker name shown in the setup steps is read from `name` at build time, so renaming the Worker needs no other change. To pick up new releases, pull them into your repository and push:

```sh
git remote add upstream https://github.com/Softwaiz/gentlemail

# Repository made by the Deploy button (the app is at its root):
git pull -X subtree=apps/mail upstream main && git push

# Fork or clone of the whole repository:
git pull upstream main && git push
```

The first pull into a Deploy-button repository needs `--allow-unrelated-histories`, and Git reports every file changed since you deployed as a conflict. Keep GentleMail's version (`git checkout --theirs .`), restore your own `wrangler.jsonc` and any file you changed (`git checkout --ours wrangler.jsonc`), then commit. Later pulls merge normally.

## Adding a domain
The domain must be a zone in the same Cloudflare account as the Worker.

1. **Admin → Domains → Add domain**
2. Run the commands shown on the domain's "Setup & status" page:
   ```sh
   npx wrangler email sending enable example.com
   npx wrangler email routing enable example.com
   npx wrangler email routing rules update example.com catch-all \
     --action-type worker --action-value <worker-name> --enabled true
   ```
3. Create mailboxes on it in **Admin**.

Address-specific routing rules (for example a forward to Gmail) keep priority over the catch-all. Mail to addresses with no mailbox is rejected with 550.

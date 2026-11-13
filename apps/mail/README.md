# Mail

Self-hosted, multi-domain, multi-mailbox webmail running entirely on Cloudflare, built with [RedwoodSDK](https://rwsdk.com).
One shared deployment serves any number of domains. Domains, mailboxes and users are managed in the app's **Admin** page.

**Current deployment:** Worker `gentlemail` → https://mailer.softwaiz.com (also https://mail.kariboo.app), D1 + R2 named `kariboo-mail`.

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

## API & webhooks
Create keys and webhooks in **Admin → API & webhooks** (the page has a full quick reference).

- **API keys** are limited to one mailbox or all, and to `send` and/or `read`. Only a SHA-256 fingerprint is stored.
  - `POST /api/v1/send`: JSON `{from, to, cc, bcc, subject, text, html, attachments: [{filename, content (base64), content_type}], reply_to_message_id, signature}`
  - `GET /api/v1/mailboxes`, `GET /api/v1/messages?mailbox=&folder=&unread=true&since=`, `GET /api/v1/messages/:id`, `POST /api/v1/messages/:id {"action": "archive"}`, `GET /api/v1/attachments/:id`
- **Webhooks** receive `message.received` (not for spam) and/or `message.sent` as signed JSON:
  `X-GentleMail-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>`. Non-2xx answers are retried after 1 min, 5 min, 30 min, 2 h, 6 h and 12 h by a once-a-minute cron.

## Layout
```
migrations/                D1 schema (0001 init, 0002 domains, 0003 API keys + webhooks)
src/worker.tsx             routes + Worker entry (fetch + email)
src/lib/inbound.ts         receive → D1/R2
src/lib/outbound.ts        send via EMAIL binding → saved in "sent"
src/lib/threads.ts         conversation grouping
src/lib/apikeys.ts         API key creation and checks
src/lib/webhooks.ts        webhook signing, delivery, retries
src/app/api.ts             public /api/v1 routes
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
```sh
pnpm release                          # migrate remote D1, build, deploy
npx wrangler secret put SETUP_TOKEN   # first deploy only: any long random string, used once at /setup
```
Open `/setup` on the first deploy to create the admin account.

## Adding a domain
The domain must be a zone in the same Cloudflare account as the Worker.

1. **Admin → Domains → Add domain**
2. Run the commands shown on the domain's "Setup & status" page:
   ```sh
   npx wrangler email sending enable example.com
   npx wrangler email routing enable example.com
   npx wrangler email routing rules update example.com catch-all \
     --action-type worker --action-value gentlemail --enabled true
   ```
3. Create mailboxes on it in **Admin**.

Address-specific routing rules (for example a forward to Gmail) keep priority over the catch-all. Mail to addresses with no mailbox is rejected with 550.

## Running a separate instance
To run a second deployment, create your own D1 database and R2 bucket, then edit the ◆ values in `wrangler.jsonc` (Worker name, `WORKER_NAME`, hostnames, D1/R2, `APP_NAME`).

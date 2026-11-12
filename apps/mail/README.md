# Mail

Self-hosted, multi-mailbox webmail running entirely on Cloudflare, built with [RedwoodSDK](https://rwsdk.com).
Not tied to any one domain: the domain, hostname, resource names and display name all live in `wrangler.jsonc`.

**Current deployment:** `kariboo.app` → https://mail.kariboo.app (D1 + R2 both named `kariboo-mail`).

- **Receive**: Email Routing catch-all on your domain → this Worker's `email()` handler → parsed with `postal-mime`
- **Store**: messages, mailboxes, users, sessions in **D1**; raw `.eml`, attachments and oversized HTML in **R2**
- **Send**: Cloudflare Email Service `send_email` binding (no API key; included in Workers Paid: 3,000/month, then $0.35/1,000)

## Features
- Admin creates mailboxes (`anything@your-domain`) and users, and assigns who can use which mailbox
- Inbox / Sent / Archive / Spam / Trash, conversations (threaded by `In-Reply-To`/`References`, subject fallback), search
- Compose, reply, reply-all, forward (forwards original attachments), file attachments up to 25 MB
- Per-mailbox sender name + signature (toggle per message)
- Attachments: view (images/PDF/text) or download; inline `cid:` images; download original `.eml`
- HTML mail rendered in a sandboxed iframe, scripts blocked, remote images blocked unless you click "Open with images"
- Mail to unknown/disabled addresses is rejected with 550

## Layout
```
migrations/0001_init.sql   D1 schema
src/worker.tsx             routes + Worker entry (fetch + email)
src/lib/inbound.ts         receive → D1/R2
src/lib/outbound.ts        send via EMAIL binding → saved in "sent"
src/lib/threads.ts         conversation grouping
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

## Deploy: kariboo.app (first instance)
```sh
pnpm release                                    # migrate remote D1, build, deploy to mail.kariboo.app
npx wrangler secret put SETUP_TOKEN             # any long random string, used once at /setup
npx wrangler email routing enable kariboo.app   # adds MX/SPF records for receiving
npx wrangler email routing rules update kariboo.app catch-all \
  --action-type worker --action-value kariboo-mail --enabled true   # all *@kariboo.app → this Worker
```

Open https://mail.kariboo.app/setup, enter the token and create your admin account, then create mailboxes in **Admin**.

## Using it for another domain
1. `npx wrangler d1 create <name>` and `npx wrangler r2 bucket create <name>`
2. Edit the ◆ values in `wrangler.jsonc` (Worker name, hostname, D1/R2, `MAIL_DOMAINS`, `APP_NAME`), or add a separate wrangler `env`
3. `npx wrangler email sending enable <domain>`, then run the deploy steps above with the new names

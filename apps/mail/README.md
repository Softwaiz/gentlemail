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

## Layout
```
migrations/                D1 schema (0001 init, 0002 domains)
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

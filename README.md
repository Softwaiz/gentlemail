# emails

pnpm workspace. Apps live in `apps/*`, shared code in `packages/*`.

| App | Path | What |
|---|---|---|
| Mail | `apps/mail` | Generic multi-mailbox webmail on Cloudflare (rwsdk + D1 + R2 + Email Service). First deployment: kariboo.app → https://mail.kariboo.app |

```sh
pnpm install
pnpm dev:mail      # local dev
pnpm deploy:mail   # migrate remote D1 + build + deploy
```

# Changelog

Everything that changed in GentleMail, newest first. This file is the record of what was done and when: if it matters to someone running, upgrading or building on GentleMail, it's here.

**How it's kept**
- Every pull request adds its lines under **Unreleased**, in the same pull request.
- A release is its own pull request: it turns **Unreleased** into a version and a date and sets the same version in `apps/mail/package.json`. Merging it deploys it; the merge commit is then tagged `vX.Y.Z` with a GitHub release holding that section. Versions follow [Semantic Versioning](https://semver.org): while GentleMail is 0.x, a new minor version (0.3.0) can contain anything; a patch (0.2.1) only fixes.
- Sections: **Added**, **Changed**, **Fixed**, **Security**, **Removed**. A release with a database migration or anything to do by hand also gets **Upgrading**.
- Lines describe the effect for the people using the app, not the code. Link the pull request.

## Unreleased

## 0.6.1 (2026-11-19)

### Added
- The [MCP docs page](https://gentlemail.dev/docs/mcp/) has its own social card, shown when its link is shared: the assistants it works with, and "Only what you allow". ([#29](https://github.com/Softwaiz/gentlemail/pull/29))

### Security
- Read no longer lets an API key or an AI assistant mark or move messages. That's a new permission, **Organize** (mark read or unread, star, archive, spam, trash, back to the inbox), ticked per mailbox beside Read and Send. Before, an assistant allowed only to read a mailbox could still archive or trash its mail. A read-only assistant no longer sees or can call the `update_message` tool (no assistant can call a tool it isn't shown), and the API answers `403 organize_required`. Organize works without Read, so a program can file a message by its ID from a webhook. `GET /api/v1/mailboxes` lists `"organize"` among a mailbox's permissions. ([#30](https://github.com/Softwaiz/gentlemail/pull/30))

### Upgrading
- Migration `0009_organize_permission.sql`. **No existing key or assistant gets Organize.** Tick it on API keys that mark or move messages (**Admin → API & webhooks → Edit access**), or they get `403 organize_required`; connect assistants again to give it to them. See [Updating](https://gentlemail.dev/docs/updating/). ([#30](https://github.com/Softwaiz/gentlemail/pull/30))

## 0.6.0 (2026-11-19)

### Added
- An [MCP server](https://gentlemail.dev/docs/mcp/) at `/mcp`, so AI assistants such as Claude, ChatGPT or Cursor can search, read, mark and answer your mail. You connect one by signing in and ticking what it may read and send, mailbox by mailbox; it never reaches more than you can open. **Security → Connected assistants** lists yours, with a **Disconnect** button; admins see everyone's on API & webhooks. API keys work on `/mcp` too. ([#27](https://github.com/Softwaiz/gentlemail/pull/27))
- The [Updating guide](https://gentlemail.dev/docs/updating/) lists every release that changes the database, with its migration, and the steps from 0.5 to 0.6. The MCP page has examples of what to ask an assistant. ([#27](https://github.com/Softwaiz/gentlemail/pull/27))
- `GET /api/v1/messages` takes `q` to search subject, sender, recipients (To and Cc) and text, as the webmail's search does. ([#27](https://github.com/Softwaiz/gentlemail/pull/27))
- An automated test, run on every pull request, that checks API keys reach exactly the mailboxes they are allowed to: each kind of grant (all mailboxes, a domain, a mailbox; read, send) on every `/api/v1` endpoint, including look-alike domains, subdomains, revoked keys and replies. ([#26](https://github.com/Softwaiz/gentlemail/pull/26))
- The JavaScript SDK, [`gentlemail` on npm](https://www.npmjs.com/package/gentlemail): send, read, reply and verify webhooks, typed, on Workers, Node, Deno and Bun. It has its own versions ([packages/sdk/CHANGELOG.md](packages/sdk/CHANGELOG.md)) and a [docs page](https://gentlemail.dev/docs/sdk/). The webhook docs now describe the `ping` test event. ([#17](https://github.com/Softwaiz/gentlemail/pull/17))
- A **Before you start** section at the top of the [deploy guide](https://gentlemail.dev/docs/deploy/): what you need (a domain on Cloudflare, the Workers Paid plan, a GitHub account) and what it costs. The deploy guide is now the one place that explains deploying; the website's /deploy page leads there. ([#22](https://github.com/Softwaiz/gentlemail/pull/22))
- The docs header shows the "gentlemail." wordmark with a "docs" label, as on the social card, instead of the "g." icon and typed title. ([#24](https://github.com/Softwaiz/gentlemail/pull/24))
- The docs have a social card (shown when a docs link is shared), a footer like the website's with links back to it, and on phones a menu that unrolls from the header with its groups arriving one after another, like the website's. ([#23](https://github.com/Softwaiz/gentlemail/pull/23))
- An [SDK changelog](https://gentlemail.dev/docs/sdk/changelog/) page in the docs, and every section of the SDK page says which SDK version added it. ([#20](https://github.com/Softwaiz/gentlemail/pull/20))
- The Quick reference on API & webhooks shows each example with the JavaScript SDK or over HTTP (one switch, remembered in the browser), with links to the SDK guide, API reference and webhook docs. ([#21](https://github.com/Softwaiz/gentlemail/pull/21))
- A theme choice in the user menu: Dark, Light or Same as device. It applies at once and is remembered in that browser. ([#21](https://github.com/Softwaiz/gentlemail/pull/21))

### Fixed
- The webmail's search also looks in Cc, as the API's does, and finds `%` and `_` as typed instead of treating them as wildcards. ([#27](https://github.com/Softwaiz/gentlemail/pull/27))
- Signing in with a recovery code shows how many are left, then offers to continue to the page you were opening, instead of dropping it. ([#27](https://github.com/Softwaiz/gentlemail/pull/27))
- `GET /api/v1/messages` with `limit=0` returned 25 messages; it now returns 1, as values out of range are brought to 1–100. ([#27](https://github.com/Softwaiz/gentlemail/pull/27))
- A reply through the API to a message sent from your own mailbox, without `to`, went back to that mailbox. It now goes to the original recipients, as in the webmail. ([#27](https://github.com/Softwaiz/gentlemail/pull/27))

### Security
- Resetting someone's two-step verification also disconnects their AI assistants and cancels their unfinished assistant sign-ins. ([#27](https://github.com/Softwaiz/gentlemail/pull/27))
- Changing a person's password in Admin, your own included, also disconnects their AI assistants and cancels their unfinished assistant sign-ins. Changing your own also signs you out in your other browsers. ([#27](https://github.com/Softwaiz/gentlemail/pull/27))
- The page you return to after signing in can no longer be another site, written as `/\example.com` or with a tab or line break after the first `/`. ([#27](https://github.com/Softwaiz/gentlemail/pull/27))

### Changed
- In the API key dialog, on an instance without domains, an admin's mailbox list is headed "Mailboxes" instead of "Other mailboxes". ([#27](https://github.com/Softwaiz/gentlemail/pull/27))
- The README shows the product: the GentleMail banner, and screenshots of the inbox, API & webhooks and the phone layout. ([#25](https://github.com/Softwaiz/gentlemail/pull/25))
- The webmail is dark by default; it used to follow the device, so phones in light mode showed it in cream. ([#21](https://github.com/Softwaiz/gentlemail/pull/21))
- On phones, the menu opens as a full-screen layer over the page, with the mailbox switcher, folders and your account, instead of unfolding above the inbox. The top bar stays at the top while you scroll. ([#21](https://github.com/Softwaiz/gentlemail/pull/21))
- The webmail uses Google Sans, like the website and the docs, and the GentleMail logo: the "gentlemail." wordmark in the sidebar and on the sign-in screens, and the "g." icon as its favicon. An instance renamed with `APP_NAME` keeps showing its own name. ([#21](https://github.com/Softwaiz/gentlemail/pull/21))
- API & webhooks and Admin fit on phones and tablets: their tables become cards, code samples scroll inside their box, and long webhook URLs and errors no longer push the page sideways. ([#21](https://github.com/Softwaiz/gentlemail/pull/21))

### Upgrading
- Migrations `0007_oauth.sql` and `0008_oauth_retry.sql` add the tables for assistant sign-ins. **Apply them with the deploy:** until they run, the API, **API & webhooks** and **Security** fail. The new `ratelimits` entry in `wrangler.jsonc` limits assistant app registrations per address; copy it if you keep your own `wrangler.jsonc`. Once applied, nothing changes until someone connects an assistant. See [Updating](https://gentlemail.dev/docs/updating/#from-05-to-06). ([#27](https://github.com/Softwaiz/gentlemail/pull/27))

## 0.5.0 (2026-11-16)

### Added
- Documentation at [gentlemail.dev/docs](https://gentlemail.dev/docs/), with search: deploying, updating (including database migrations), two-step verification, spam, the API (keys, sending, reading, errors), webhooks and recipes, and this changelog. It lives in the repository (`apps/docs`), so docs change in the same pull request as the code. ([#13](https://github.com/Softwaiz/gentlemail/pull/13))

### Changed
- The docs use Google Sans, like gentlemail.dev. ([#14](https://github.com/Softwaiz/gentlemail/pull/14))

## 0.4.0 (2026-11-16)

### Added
- Two-step verification with any authenticator app: set up from **Security** (the menu under your name) with a QR code, 10 single-use recovery codes to download or copy, new codes on demand, and turning it off with a code. Signing in asks for the code after the password; 5 wrong codes and the password is needed again, and a code can't be reused. ([#10](https://github.com/Softwaiz/gentlemail/pull/10))
- Admins can require two-step verification for everyone (people without it can only open Security until it's set up), see who has it on, and reset it for someone who lost their phone. ([#10](https://github.com/Softwaiz/gentlemail/pull/10))
- Admins see the running version at the bottom of the sidebar, linked to the changelog. A build with changes not yet released shows `+dev` after the last release number (`0.3.0+dev`). Each release is tagged `vX.Y.Z` on GitHub with its changelog section as release notes. ([#9](https://github.com/Softwaiz/gentlemail/pull/9))

### Upgrading
- Migration `0006_mfa.sql` adds the two-step columns and tables. Nothing changes for anyone until they turn it on or an admin requires it.

## 0.3.0 (2026-11-16)

### Added
- This changelog, and [AGENTS.md](AGENTS.md) with the rules for changing the repository: every pull request adds its changelog lines. ([#8](https://github.com/Softwaiz/gentlemail/pull/8))
- API keys get **Read** and/or **Send** on all mailboxes, on a whole domain (mailboxes added to it later included) or on the mailboxes you pick, and **Edit access** changes an existing key's access without replacing the key. `GET /api/v1/mailboxes` returns the key's `permissions` on each mailbox. ([#6](https://github.com/Softwaiz/gentlemail/pull/6))
- README: tech stack, database and migration commands (plain SQL, no ORM), monorepo layout, every script, and an explicit note that no Cloudflare API token or account ID is ever needed. ([#5](https://github.com/Softwaiz/gentlemail/pull/5))

### Changed
- Replying through the API with `reply_to_message_id` needs Read on the mailbox as well as Send, since the reply quotes and threads the original. ([#6](https://github.com/Softwaiz/gentlemail/pull/6))
- Opening a conversation marks it read through a server action once it's on screen, instead of while the page loads. ([#7](https://github.com/Softwaiz/gentlemail/pull/7))

### Fixed
- Conversations of more than 100 messages open again, and bulk actions (archive, trash, mark read…) work on selections holding more than 100 messages. ([#7](https://github.com/Softwaiz/gentlemail/pull/7))
- An incoming reply with a very long `References` header (a long email chain) is stored instead of failing. ([#7](https://github.com/Softwaiz/gentlemail/pull/7))
- Command-line deploy instructions: the first deploy creates the database before migrations run, and `deploy` needs a `build` first. ([#5](https://github.com/Softwaiz/gentlemail/pull/5))

### Upgrading
- Migration `0005_api_key_grants.sql` runs on deploy. Existing keys keep exactly the access they had (one mailbox or all mailboxes, with their read/send scopes). Keys with no known scope get no access.

## 0.2.0 (2026-11-16)

### Added
- "Not found" and "Access restricted" pages with the right HTTP status (404 / 403): for an unknown page, mailbox, conversation, domain or webhook, and for a mailbox or admin page you aren't allowed to open. They show inside the app, with a way to sign in as someone else. ([#4](https://github.com/Softwaiz/gentlemail/pull/4))

### Fixed
- Deleting a mailbox returns to the mailbox list instead of showing "Not found". ([#4](https://github.com/Softwaiz/gentlemail/pull/4))
- Confirm buttons such as "Delete forever" use the destructive colour, and their text stays readable on hover. ([#4](https://github.com/Softwaiz/gentlemail/pull/4))

## 0.1.0 (2026-11-13)

First public release.

### Added
- Multi-domain webmail on Cloudflare Workers: domains, mailboxes and users managed in Admin, with each person given access to the mailboxes they need.
- Receiving through Email Routing, storage in D1 and R2, sending with Cloudflare Email Service. Conversations, search, attachments, signatures, sender name per mailbox.
- Spam folder with rules, per-mailbox allowed and blocked senders, learning from "Spam" / "Not spam", and a 30-day purge.
- REST API with API keys, and signed webhooks (`message.received`, `message.sent`) with retries. ([#1](https://github.com/Softwaiz/gentlemail/pull/1))
- Sanitised HTML mail display with remote images blocked by default, theme-aware mail bodies.
- Deploy to Cloudflare button, `/setup` with a one-time `SETUP_TOKEN`, MIT license. ([#2](https://github.com/Softwaiz/gentlemail/pull/2))
- The Worker name comes from `wrangler.jsonc`, and a complete deploy guide covers setup, domains, testing, configuration, updating and troubleshooting. ([#3](https://github.com/Softwaiz/gentlemail/pull/3))

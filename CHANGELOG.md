# Changelog

Everything that changed in GentleMail, newest first. This file is the record of what was done and when: if it matters to someone running, upgrading or building on GentleMail, it's here.

**How it's kept**
- Every pull request adds its lines under **Unreleased**, in the same pull request.
- Work is merged into `dev`; `main` holds releases only. A release starts with a version pull request into `dev`: it turns **Unreleased** into a version and a date and sets the same version in `apps/mail/package.json`. A promotion pull request then brings `dev` into `main`; its merge commit is tagged `vX.Y.Z` with a GitHub release holding that section. Versions follow [Semantic Versioning](https://semver.org): while GentleMail is 0.x, a new minor version (0.3.0) can contain anything; a patch (0.2.1) only fixes.
- Sections: **Added**, **Changed**, **Fixed**, **Security**, **Removed**. A release with a database migration or anything to do by hand also gets **Upgrading**.
- Lines describe the effect for the people using the app, not the code. Link the pull request.

## Unreleased

### Changed
- If the editor fails while you write, the rest of the page stays, and your text goes on in a plain field you can send. ([#42](https://github.com/Softwaiz/gentlemail/pull/42))
- The workflow that makes releases does nothing in copies of the repository, where it failed on every push to `main`. ([#42](https://github.com/Softwaiz/gentlemail/pull/42))

### Fixed
- Images inside a message stay in place when you reply to it or forward it. They arrived as broken pictures, and a forward added them as loose files. In a reply, an image that would take the message past the limits is left out of the quote. ([#45](https://github.com/Softwaiz/gentlemail/pull/45))
- Adding a link is no longer lost when the text it was for changed while its card was open. ([#42](https://github.com/Softwaiz/gentlemail/pull/42))

## 0.7.2 (2026-11-24)

### Fixed
- Files attached to a message arrive as they were sent. Files sent from the webmail or with `POST /api/v1/send`, and those passed on by a forward, could reach the recipient as base64 text, a third larger and impossible to open. The copies in **Sent** are intact: once updated, forward the message to send its files again. ([#46](https://github.com/Softwaiz/gentlemail/pull/46))

## 0.7.1 (2026-11-23)

### Fixed
- The page no longer goes blank while writing a message. It happened when the mouse pointer was over a link or an address in the message and you kept typing, and the message was lost. ([#40](https://github.com/Softwaiz/gentlemail/pull/40))
- Pressing Enter in To, Cc, Bcc or Subject no longer sends the message; only **Send** does. A message with nothing written and no file attached isn't sent either: the composer says so. Forwarding without adding a word still works, and the API is unchanged. ([#40](https://github.com/Softwaiz/gentlemail/pull/40))

## 0.7.0 (2026-11-23)

### Added
- Formatting in the webmail composer: bold, italic, underline, strikethrough, subscript, superscript, links, bulleted and numbered lists, quotes and inline code, from a toolbar or keyboard shortcuts (Ctrl/⌘ B, I, U, K…). Messages go out as HTML with a matching plain-text part. Only this formatting is sent, whatever the page posts. ([#32](https://github.com/Softwaiz/gentlemail/pull/32))
- Password fields (sign-in, first-run setup, adding a user) have a button on the right to show or hide what you typed. The password is hidden again when the form is sent. ([#37](https://github.com/Softwaiz/gentlemail/pull/37))
- The webmail in French. Each person picks English, Français or "Same as browser" in the menu under their name; the choice is saved on their account and follows them to every device. Without a choice, the webmail follows the browser's language, then English. Dates and sizes follow the language too. The API, webhooks, MCP tools and the text GentleMail adds to outgoing mail stay in English; when replying, the composer shows that line exactly as it is sent. [Languages](https://gentlemail.dev/docs/guides/languages/) explains how to add one. ([#37](https://github.com/Softwaiz/gentlemail/pull/37))

### Changed
- The 25 MB limit on a sent message now counts its text and HTML, not only its attachments, in the webmail and in `POST /api/v1/send`. A send just over it with attachments, which the email service would have refused anyway, now gets `422` with "The message and its attachments exceed the 25 MB limit." ([#32](https://github.com/Softwaiz/gentlemail/pull/32))
- A wrong password on the sign-in page keeps the email filled in and puts the cursor back in the password field; a wrong setup token or too short a password on the setup page keeps the name and email. The card gives a short shake, except when the device asks for reduced motion. ([#37](https://github.com/Softwaiz/gentlemail/pull/37))

### Security
- A link to a GentleMail page could make it show any text in its message box (for example `/login?err=Your account is locked, call…`). Each page now shows only its own messages, chosen by a code in the link; anything else, including another page's code, is ignored. ([#37](https://github.com/Softwaiz/gentlemail/pull/37))

### Fixed
- Very long messages in scripts such as Chinese or Japanese are saved properly: the Sent copy, and received mail, measured their size in characters while the database counts bytes. A long sent message could go out and then fail to be saved, showing "Sending failed" and inviting a second send. Its HTML now goes to storage, as for received mail. ([#32](https://github.com/Softwaiz/gentlemail/pull/32))
- On phones, the buttons that act on the selected conversations (Archive, Spam, Trash and the others) have names for screen readers; they were announced only as "button". ([#38](https://github.com/Softwaiz/gentlemail/pull/38))

### Upgrading
- New migration `0010_user_language.sql` (each person's language). With the Deploy button's setup it's applied on the push; otherwise run `npx wrangler d1 migrations apply DB --remote` right after deploying, or signing in fails.

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

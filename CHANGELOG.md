# Changelog

Everything that changed in GentleMail, newest first. This file is the record of what was done and when: if it matters to someone running, upgrading or building on GentleMail, it's here.

**How it's kept**
- Every pull request adds its lines under **Unreleased**, in the same pull request.
- A release turns **Unreleased** into a version and a date when it's deployed. Versions follow [Semantic Versioning](https://semver.org): while GentleMail is 0.x, a new minor version (0.3.0) can contain anything; a patch (0.2.1) only fixes.
- Sections: **Added**, **Changed**, **Fixed**, **Security**, **Removed**. A release with a database migration or anything to do by hand also gets **Upgrading**.
- Lines describe the effect for the people using the app, not the code. Link the pull request.

## Unreleased

### Added
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

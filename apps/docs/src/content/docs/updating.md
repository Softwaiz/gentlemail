---
title: Updating
description: Pick up a new GentleMail release, apply its database migrations and check what changed.
---

Every release is listed in the [changelog](/docs/changelog/) and on [GitHub releases](https://github.com/Softwaiz/gentlemail/releases). Read its **Upgrading** notes before you deploy it: they say when a release changes the database.

## Pull the release

Your repository is yours to change. Add GentleMail as a remote and pull from it:

```sh
git remote add upstream https://github.com/Softwaiz/gentlemail

# Repository made by the Deploy button (the app is at its root):
git pull -X subtree=apps/mail upstream main && git push

# Fork or clone of the whole repository:
git pull upstream main && git push
```

A repository made by the Deploy button has no history in common with GentleMail, so the first pull also needs `--allow-unrelated-histories`, and Git reports every file changed since you deployed as a conflict. Keep GentleMail's version (`git checkout --theirs .`), restore your own `wrangler.jsonc` and anything you changed (`git checkout --ours wrangler.jsonc`), then commit. Later pulls merge normally.

## Deploy it, migrations first

Some releases add a database migration (a numbered file in `migrations/`). **The new code needs it**: deploy the code without it and pages fail until it's applied.

- **Workers Builds with the deploy command `npm run deploy`** (what the Deploy button sets up): the push deploys, and the migrations are applied first. Nothing else to do.
- **Command line:** run `npm run build && npm run deploy` from `apps/mail`. It applies the migrations, then deploys.
- **Any other deploy command** (for example plain `npx wrangler deploy`): apply the migrations yourself, right before or right after the deploy:
  ```sh
  npx wrangler d1 migrations apply DB --remote
  ```

To see what's pending: `npx wrangler d1 migrations list DB --remote`.

Skipping releases is fine: the same command applies every pending migration, oldest first.

## Releases with a migration

| Release | Migration | What it adds |
|---|---|---|
| 0.6.1 | `0009_organize_permission.sql` | The **Organize** permission for API keys and assistants. Existing ones don't get it. |
| 0.6.0 | `0007_oauth.sql`, `0008_oauth_retry.sql` | Sign-ins for [AI assistants (MCP)](/docs/mcp/): two columns on `api_keys`, three new tables, and a column on `oauth_tokens`. |
| 0.4.0 | `0006_mfa.sql` | [Two-step verification](/docs/guides/two-step/). |
| 0.3.0 | `0005_api_key_grants.sql` | Per-mailbox and per-domain access for API keys. Existing keys keep their access. |
| Before 0.3.0 | `0001` to `0004` | The first tables: mail, domains, API keys, webhooks and sender rules. |

### From 0.6.0 to 0.6.1

1. Pull the release, as above.
2. Apply `0009_organize_permission.sql`. With the Deploy button's setup it happens on the push; otherwise run `npx wrangler d1 migrations apply DB --remote`.
3. Marking and moving messages (read, unread, star, archive, spam, trash, inbox) now needs **Organize** instead of Read, and no existing key or assistant has it:
    - API keys that mark or move messages: tick **Organize** with **Edit access** in **Admin → API & webhooks**. Until then they get `403 organize_required`. Reading and sending work as before.
    - Assistants that should keep doing it: disconnect them under **Security → Connected assistants** and connect them again, ticking Organize.

Until the migration is applied, the API, `/mcp`, **API & webhooks** and **Security** fail.

### From 0.5 to 0.6

1. Pull the release, as above.
2. Apply `0007_oauth.sql` and `0008_oauth_retry.sql`. With the Deploy button's setup it happens on the push; otherwise run `npx wrangler d1 migrations apply DB --remote`.
3. If you keep your own `wrangler.jsonc`, add the new `ratelimits` entry from the repository's: it limits how often one address can register an assistant app. It needs nothing created in Cloudflare. Without it, GentleMail still works and logs a warning, and keeps at most 5,000 registrations that never signed in.
4. No new secret or setting. Assistants connect at your address followed by `/mcp`, and nothing changes until someone connects one.

Until the migrations are applied, the API, **API & webhooks** and **Security** fail.

## Check the version

Admins see the running version at the bottom of the sidebar. A build of `main` between two releases shows the last release followed by `+dev` (for example `0.4.0+dev`).

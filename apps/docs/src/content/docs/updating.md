---
title: Updating
description: Pick up a new GentleMail release, apply its database migrations and check what changed.
---

Every release is listed in the [changelog](/docs/changelog/) and on [GitHub releases](https://github.com/Softwaiz/gentlemail/releases). Read its **Upgrading** notes before you deploy it: they say when a release changes the database.

## Being told about releases

Admins see a notice when a newer version is out, with what changed, the **Upgrading** notes of every release in between and how to update. **Later** closes it for that version; the line by the version number, at the bottom of the sidebar, stays. Members see neither. Nothing is ever installed by itself.

To know, GentleMail reads [gentlemail.dev/docs/releases.json](https://gentlemail.dev/docs/releases.json) about once a day. GentleMail adds nothing about your instance, your mail or your users to that request. Cloudflare adds the name of the domain your Worker belongs to, as it does to every request a Worker makes (the [`CF-Worker` header](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-worker)). To stop it, turn off **Check for new versions** at the bottom of **Admin**.

## Pull the release

Your repository is yours to change. How you pull a release depends on how you installed GentleMail.

### A clone or fork

Your repository shares GentleMail's history. From your clone, with GentleMail as the `upstream` remote (if you don't have it: `git remote add upstream https://github.com/Softwaiz/gentlemail`):

```sh
git pull --no-rebase upstream main && git push
```

Your `wrangler.jsonc` is kept. If a release changes the same lines as you, Git shows a conflict there: keep your values and take the new lines. On a fork, **Sync fork** on GitHub does the same without a terminal.

### A repository made by the Deploy button

It has no history in common with GentleMail, so the first update is settled by hand. Clone your repository, then:

```sh
git remote add upstream https://github.com/Softwaiz/gentlemail
git pull --no-rebase --allow-unrelated-histories -X subtree=apps/mail upstream main
```

Git reports every file changed since you deployed as a conflict. Keep GentleMail's version of everything but your settings and anything you changed yourself, then commit and push:

```sh
git checkout --theirs . && git checkout --ours wrangler.jsonc
git add -A && git commit --no-edit && git push
```

Keeping your `wrangler.jsonc` also leaves out what releases added to it. Compare it with [ours](https://github.com/Softwaiz/gentlemail/blob/main/apps/mail/wrangler.jsonc) and copy any new entry.

Later updates merge normally: `git pull --no-rebase -X subtree=apps/mail upstream main && git push`.

To stop needing this, move to a clone: follow [Deploy](/docs/deploy/#a-clone-in-your-own-repository-recommended) with your own `wrangler.jsonc` in `apps/mail` (same Worker name, same database and bucket), skip its step 3, and connect the new repository to your Worker in place of the old one.

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
| 0.8.0 | `0011_signatures.sql` | Formatted [signatures](/docs/guides/signatures/) and their logo. Until it's applied, mailbox settings can't be saved. |
| 0.7.0 | `0010_user_language.sql` | Each person's [language](/docs/guides/languages/), saved on their account. Until it's applied, signing in fails. |
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

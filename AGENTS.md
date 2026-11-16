# Working on GentleMail

Instructions for anyone changing this repository, human or AI coding agent. The app lives in `apps/mail`; its [README](apps/mail/README.md) has the stack, layout, scripts and database commands.

## Every change goes in the changelog
[CHANGELOG.md](CHANGELOG.md) is the record of what was done and when. A pull request isn't finished until it updates it.

- Add your lines under **Unreleased**, in the same pull request as the change.
- Put each line under **Added**, **Changed**, **Fixed**, **Security** or **Removed**. If the change has a database migration or anything an operator must do by hand, add an **Upgrading** line too.
- Write what changed for the people using or running GentleMail, not what the code does. Link the pull request: `([#12](https://github.com/Softwaiz/gentlemail/pull/12))`.
- Changes nobody would notice (refactors, comments, tests only) can skip it. When in doubt, add a line.
- A release turns **Unreleased** into `## x.y.z (YYYY-MM-DD)` and leaves an empty **Unreleased** above it (see Releases). While GentleMail is 0.x, a minor version (0.4.0) can hold anything and a patch (0.3.1) only fixes.

## Releases
Merging to `main` deploys, so a release is cut in a pull request and deployed by merging it.
1. **Release pull request**, with nothing else in it: turn **Unreleased** into `## x.y.z (YYYY-MM-DD)` (the date it merges) and set the same version in `apps/mail/package.json`. If the release has a migration or anything to do by hand, it's under **Upgrading**.
2. **Right after merging**, tag the merge commit and publish its notes: `git tag vX.Y.Z <merge commit> && git push origin vX.Y.Z`, then `gh release create vX.Y.Z --notes-file <that changelog section>`.
3. Between releases, builds show the last version with `+dev` (the changelog has lines under **Unreleased**), so admins can tell a release from a build of `main`.
4. Packages in `packages/` (such as the SDK) have their own versions and changelogs, released independently of the app.

## Code conventions
- **Data access is plain SQL** through the D1 binding with bound parameters (`env.DB.prepare("… WHERE id = ?").bind(id)`). No ORM.
- **D1 accepts at most 100 bound values per query.** Never build `IN (?, ?, …)` from a list that can grow; split it with `chunks()` from `src/lib/util.ts`, or express the filter as a join or subquery.
- **Schema changes are new numbered files in `apps/mail/migrations/`** (`npx wrangler d1 migrations create DB name`). Never edit a migration that has been released. Deploys apply pending migrations.
- **The browser changes data only through server functions**: `serverAction` for writes and `serverQuery` for reads, in `src/app/actions/`. Each one checks access itself (`signedIn`, `adminOnly`, mailbox access). Page renders only read. Plain routes are kept for sign-in, file downloads and the public `/api/v1`.
- **Access is checked on the server, every time**, whatever page a form was posted from.
- **No secrets, account IDs or deployment-specific domains in this repository.** `apps/mail/wrangler.jsonc` stays a template, and `.dev.vars` is never committed.

## Before opening a pull request
From `apps/mail`: `npx tsc --noEmit` and `npm run build` pass, and the change is tried locally (`npm run db:migrate:local`, `npm run dev`).

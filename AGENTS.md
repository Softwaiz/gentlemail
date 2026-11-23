# Working on GentleMail

Instructions for anyone changing this repository, human or AI coding agent. The app lives in `apps/mail`; its [README](apps/mail/README.md) has the stack, layout, scripts and database commands. The documentation site lives in `apps/docs`.

## Every change goes in the changelog
[CHANGELOG.md](CHANGELOG.md) is the record of what was done and when. A pull request isn't finished until it updates it.

- Add your lines under **Unreleased**, in the same pull request as the change.
- Put each line under **Added**, **Changed**, **Fixed**, **Security** or **Removed**. If the change has a database migration or anything an operator must do by hand, add an **Upgrading** line too.
- Write what changed for the people using or running GentleMail, not what the code does. Link the pull request: `([#12](https://github.com/Softwaiz/gentlemail/pull/12))`.
- Changes nobody would notice (refactors, comments, tests only) can skip it. When in doubt, add a line.
- A release turns **Unreleased** into `## x.y.z (YYYY-MM-DD)` and leaves an empty **Unreleased** above it (see Releases). While GentleMail is 0.x, a minor version (0.4.0) can hold anything and a patch (0.3.1) only fixes.

## Docs follow the code
The documentation is `apps/docs` ([Astro Starlight](https://starlight.astro.build)), served at [gentlemail.dev/docs](https://gentlemail.dev/docs/). Pages are Markdown files in `apps/docs/src/content/docs/`.

- A pull request that changes what people see or do (a page, a setting, an API field or error, a webhook, a deploy or upgrade step) updates the docs page about it, in the same pull request.
- The changelog page is built from `CHANGELOG.md` at build time. Don't copy release notes into the docs.
- Links between pages start with `/docs/` (`[API keys](/docs/api/keys/)`).
- From `apps/docs`: `npm run dev` to preview, `npm run build` must pass.
- **The SDK's docs follow its versions.** A pull request that changes `packages/sdk` updates `apps/docs/src/content/docs/sdk.md` in the same pull request: a new function or option goes in its section with `<p class="since">Since X.Y.Z</p>` (the version it will ship in), a change says what changed and from which version. Its line goes in `packages/sdk/CHANGELOG.md`, which is the [SDK changelog](https://gentlemail.dev/docs/sdk/changelog/) page. If it's something new the SDK can do, add it with its version to `sdk.features` on the website (`gentlemail-site`, `src/app/content.ts`).

## Branches
People run GentleMail from `main`: the Deploy to Cloudflare button copies it, operators update with `git pull upstream main`, and merging to it deploys the docs. So `main` only ever holds releases.

- **Work goes to `dev`.** Branch from `dev` and open the pull request against `dev`. Never against `main`.
- **`main` changes only by a promotion** from `dev` (see Releases), which is merged and tagged as one release.
- **A fix that can't wait** for the next release: branch from `main` and open a pull request against `main` titled `Fix: …`. It releases itself as a patch: its changelog section is the new version (`## 0.7.1 (date)`) and it sets that version in `apps/mail/package.json`. Once merged, it's tagged and released, and a `Sync main into dev after x.y.z` pull request opens so the fix isn't lost.

## Releases
A release promotes what is in `dev` into `main`. [`release.yml`](.github/workflows/release.yml) does the bookkeeping:
1. **A promotion pull request stays open** from `dev` into `main`, titled `Release next`. Every merge into `dev` updates it with the lines under **Unreleased** and the pull requests waiting.
2. **Version pull request into `dev`**: run **Prepare release** in the Actions tab. It opens `Version x.y.z`, turning **Unreleased** into `## x.y.z (YYYY-MM-DD)` and setting the same version in `apps/mail/package.json`. It suggests the version from the changelog (a minor version for anything Added, Changed, Removed or with an Upgrading step, a patch for fixes only); give one to override it. If the release has a migration or anything to do by hand, it's under **Upgrading**. Merging it renames the promotion `Release x.y.z`.
3. **Merging the promotion** deploys the docs and makes the release available. Its merge commit on `main` is tagged `vX.Y.Z` and the GitHub release is published with that changelog section, automatically.
4. Between releases, builds show the last version with `+dev` (the changelog has lines under **Unreleased**), so admins can tell a release from a build of `dev`.
5. Packages in `packages/` (such as the SDK) have their own versions and changelogs, released independently of the app. Their changes go through `dev` too; tag them (`sdk-vX.Y.Z`) on `main` once promoted.

## Code conventions
- **Data access is plain SQL** through the D1 binding with bound parameters (`env.DB.prepare("… WHERE id = ?").bind(id)`). No ORM.
- **D1 accepts at most 100 bound values per query.** Never build `IN (?, ?, …)` from a list that can grow; split it with `chunks()` from `src/lib/util.ts`, or express the filter as a join or subquery.
- **Schema changes are new numbered files in `apps/mail/migrations/`** (`npx wrangler d1 migrations create DB name`). Never edit a migration that has been released. Deploys apply pending migrations.
- **The browser changes data only through server functions**: `serverAction` for writes and `serverQuery` for reads, in `src/app/actions/`. Each one checks access itself (`signedIn`, `adminOnly`, mailbox access). Page renders only read. Plain routes are kept for sign-in, file downloads and the public `/api/v1`. Sign-in includes the OAuth endpoints for AI assistants and their consent form (`/oauth/*`), whose answer is a redirect to the app.
- **Access is checked on the server, every time**, whatever page a form was posted from.
- **Every screen and component has stories** ([Storybook](apps/mail/README.md#storybook), `npm run storybook`): a new one comes with its stories, a changed one updates them, in the same pull request. Made-up data only, with fixed dates; checks on state, not on animation.
- **Pages load, views draw.** A page in `src/app/pages/` reads the database and the request, then renders a view (`<page>-views.tsx`) that only draws its props, so stories can show it. Splitting a page moves its markup unchanged, and `npm run compare-pages` must show every page identical to `dev`.
- **No secrets, account IDs or deployment-specific domains in this repository.** `apps/mail/wrangler.jsonc` stays a template, and `.dev.vars` is never committed.

## Before opening a pull request
Open it against `dev` (see Branches) and fill in the [template](.github/pull_request_template.md): what and why, what you'll see (screenshots for anything on screen), how it was tested, and its checklist. Title it `Area: what changes` (`Composer: formatted messages`). Release work has fixed titles: `Version x.y.z` (the version pull request into `dev`), `Release x.y.z` (the promotion into `main`), `Fix: …` (a hotfix into `main`) and `Sync main into dev after x.y.z`.

A security fix that would show a hole before it's deployed is prepared in a private fork from a GitHub security advisory, then merged, released and published together.

From `apps/mail`: `npx tsc --noEmit`, `npm run build` and `npm test` pass, and the change is tried locally (`npm run db:migrate:local`, `npm run dev`). If you changed `apps/docs`, its `npm run build` passes too.

`npm test` runs the built Worker locally against a throwaway database and checks that API keys reach exactly the mailboxes their grants allow, on every `/api/v1` endpoint. A change to API keys or the API adds its cases there (`apps/mail/test/api-access.test.mjs`). It also runs the MCP endpoint and its OAuth sign-in end to end (`apps/mail/test/mcp.test.mjs`): a change to either adds its cases there.

<!--
Title: "Area: what changes", for example "Composer: formatted messages" or "Docs: a social card for the MCP page".
Release work has fixed titles: "Version x.y.z" (into dev), "Release x.y.z" (dev into main),
"Fix: …" (hotfix into main), "Sync main into dev after x.y.z". See Branches and Releases in AGENTS.md.
Base branch: dev. Only a hotfix goes into main.
-->

## What and why
<!-- What changes for the people using or running GentleMail, and why. -->


## What you'll see
<!-- Screenshots for anything on screen (desktop and phone), or the API/MCP request and answer. -->


## Tested
<!-- What you tried locally, and what the tests now cover. -->


## Checklist
- [ ] Against `dev` (a hotfix: against `main`, then a sync pull request into `dev`)
- [ ] Lines under **Unreleased** in [CHANGELOG.md](../blob/dev/CHANGELOG.md) (Added / Changed / Fixed / Security / Removed, plus **Upgrading** for a migration or a manual step), or no line because nobody would notice
- [ ] Docs updated for what people see or do, or nothing in the docs changes
- [ ] From `apps/mail`: `npx tsc --noEmit`, `npm run build` and `npm test` pass; tried locally
- [ ] A schema change is a new numbered migration, never an edit to a released one
- [ ] A change to API keys, the API or MCP adds its cases to `test/api-access.test.mjs` or `test/mcp.test.mjs`
- [ ] No secrets, account IDs or deployment-specific domains
- [ ] A new feature had its PRD agreed before work started

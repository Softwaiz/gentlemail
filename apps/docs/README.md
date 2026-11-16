# GentleMail docs

The documentation site, served at [gentlemail.dev/docs](https://gentlemail.dev/docs/). Built with [Astro Starlight](https://starlight.astro.build); pages are Markdown in `src/content/docs/`, and the changelog page is rendered from the repository's `CHANGELOG.md` at build time.

```sh
npm run dev       # preview at localhost:4321/docs/
npm run build     # writes dist/docs
npm run preview   # build, then serve it the way Cloudflare does (wrangler dev)
```

## How it's served

The build is a static-assets Worker, `gentlemail-docs` (see `wrangler.jsonc`), with no address of its own. The website's Worker forwards `/docs` and `/docs/*` to it through a service binding. To deploy it with Workers Builds, connect this repository with root directory `apps/docs`, build command `npm run build` and deploy command `npx wrangler deploy`.

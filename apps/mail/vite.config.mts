import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { unstable_readConfig } from "wrangler";
import { existsSync, readFileSync } from "node:fs";

// The Worker name as deployed: whatever "name" says in wrangler.jsonc (the Deploy to Cloudflare
// button writes the name you choose there). Shown in the per-domain setup steps.
const workerName = unstable_readConfig({ config: "wrangler.jsonc", env: process.env.CLOUDFLARE_ENV }, { hideWarnings: true }).name ?? "";

// The version shown to admins: the last release, from package.json. A build that also holds
// changes listed under "Unreleased" in CHANGELOG.md gets "+dev", so it isn't mistaken for the
// release itself. (Deploy-button copies hold only apps/mail, without the changelog: release number only.)
const release: string = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
const changelog = new URL("../../CHANGELOG.md", import.meta.url);
const unreleased = existsSync(changelog)
  ? /^- /m.test(readFileSync(changelog, "utf8").split(/^## Unreleased\s*$/m)[1]?.split(/^## /m)[0] ?? "")
  : false;
const version = unreleased ? `${release}+dev` : release;

export default defineConfig({
  define: {
    __WORKER_NAME__: JSON.stringify(workerName),
    __APP_VERSION__: JSON.stringify(version),
  },
  environments: {
    ssr: {},
  },
  plugins: [
    cloudflare({
      viteEnvironment: { name: "worker" },
    }),
    redwood(),
    tailwindcss(),
  ],
});

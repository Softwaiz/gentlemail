import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { unstable_readConfig } from "wrangler";
import { readFileSync } from "node:fs";

// The Worker name as deployed: whatever "name" says in wrangler.jsonc (the Deploy to Cloudflare
// button writes the name you choose there). Shown in the per-domain setup steps.
const version: string = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

const workerName = unstable_readConfig({ config: "wrangler.jsonc", env: process.env.CLOUDFLARE_ENV }, { hideWarnings: true }).name ?? "";

export default defineConfig({
  define: {
    __WORKER_NAME__: JSON.stringify(workerName),
    // The release, from package.json; bumped when CHANGELOG.md cuts a version.
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

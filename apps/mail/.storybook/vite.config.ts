import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Server actions (src/app/actions/*) are replaced by the fakes in fakes/actions/, which
 * succeed, fail or are slow on demand. A component importing actions that have no fake
 * fails to build, on purpose: nothing in a story may reach the real ones.
 */
function fakeServerActions(): Plugin {
  return {
    name: "gentlemail:fake-server-actions",
    enforce: "pre",
    resolveId(id, importer) {
      // By here the "@" alias has already turned the import into a path under src/.
      if (importer?.includes("/.storybook/")) return null;
      const m = id.match(/(?:^@|\/src)\/app\/actions\/([\w-]+)(?:\.ts)?$/);
      if (!m) return null;
      const fake = here(`./fakes/actions/${m[1]}.ts`);
      if (!existsSync(fake)) throw new Error(`No fake for @/app/actions/${m[1]}: add .storybook/fakes/actions/${m[1]}.ts`);
      return fake;
    },
  };
}

export default defineConfig({
  plugins: [fakeServerActions(), tailwindcss()],
  resolve: {
    alias: {
      "cloudflare:workers": here("./fakes/cloudflare-workers.ts"),
      "rwsdk/client": here("./fakes/rwsdk-client.ts"),
      "@": here("../src"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-storybook"),
    __WORKER_NAME__: JSON.stringify("gentlemail"),
  },
});

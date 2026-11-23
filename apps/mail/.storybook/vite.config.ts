import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const ACTIONS = here("../src/app/actions");
const ANSWERS = here("./fakes/actions");
const VIRTUAL = "\0fake-actions:";

/** "mail" for <dir>/mail.ts; nothing for a file elsewhere. */
const moduleName = (file: string, dir: string) =>
  file.startsWith(`${dir}/`) ? file.slice(dir.length + 1).match(/^([\w-]+)\.ts$/)?.[1] : undefined;

/**
 * Server actions are replaced by fakes, generated from each module in src/app/actions/:
 * every serverAction answers { ok: true }, every serverQuery answers nothing (components keep
 * what the story gave them). The "Server" toolbar makes them fail or be slow instead.
 * fakes/actions/<module>.ts can give specific answers; what it exports replaces the generated fake.
 * A module exporting anything else at runtime stops the build: no story may reach real server code.
 */
function fakeServerActions(): Plugin {
  return {
    name: "gentlemail:fake-server-actions",
    enforce: "pre",
    async resolveId(id, importer, options) {
      if (!importer || importer.includes("/node_modules/")) return null;
      // Where the import really leads, however it's written ("@/app/actions/mail", "../actions/mail").
      const file = (await this.resolve(id, importer, { ...options, skipSelf: true }))?.id.split("?")[0];
      const name = file && moduleName(file, ACTIONS);
      if (!name) return null;
      // Helpers that aren't server functions (guards.ts) stay as they are; components only import their types.
      return /^["']use server["']/m.test(readFileSync(file, "utf8")) ? VIRTUAL + name : null;
    },
    load(id) {
      if (!id.startsWith(VIRTUAL)) return null;
      const name = id.slice(VIRTUAL.length);
      const file = `${ACTIONS}/${name}.ts`;
      this.addWatchFile(file);
      const source = readFileSync(file, "utf8");
      const lines: string[] = [];
      for (const [, what, kind] of source.matchAll(/^export (?:async )?(?:const|let|function|class) (\w+)(?: = server(Action|Query)\()?/gm)) {
        if (!kind) throw new Error(`Storybook can't fake ${what} in src/app/actions/${name}.ts: only serverAction and serverQuery can be exported there.`);
        lines.push(`export const ${what} = override.${what} ?? fake${kind}(${JSON.stringify(what)});`);
      }
      const custom = `${ANSWERS}/${name}.ts`;
      return [
        `import { fakeAction, fakeQuery } from ${JSON.stringify(here("./fakes/server.ts"))};`,
        existsSync(custom) ? `import * as override from ${JSON.stringify(custom)};` : "const override = {};",
        ...lines,
      ].join("\n");
    },
    // A fake is made from its actions module, and from the file of specific answers: when either
    // changes, or the answers appear or go, make it again.
    hotUpdate({ file, modules }) {
      const name = moduleName(file, ACTIONS) ?? moduleName(file, ANSWERS);
      const fake = name && this.environment.moduleGraph.getModuleById(VIRTUAL + name);
      if (fake) return [...modules, fake];
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

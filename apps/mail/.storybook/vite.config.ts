import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const ACTIONS = here("../src/app/actions");
const VIRTUAL = "\0fake-actions:";

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
    resolveId(id) {
      // By here the "@" alias has already turned the import into a path under src/.
      const m = id.match(/(?:^@|\/src)\/app\/actions\/([\w-]+)(?:\.ts)?$/);
      if (!m) return null;
      const source = readFileSync(`${ACTIONS}/${m[1]}.ts`, "utf8");
      // Helpers that aren't server functions (guards.ts) stay as they are; components only import their types.
      return /^["']use server["']/m.test(source) ? VIRTUAL + m[1] : null;
    },
    load(id) {
      if (!id.startsWith(VIRTUAL)) return null;
      const name = id.slice(VIRTUAL.length);
      const source = readFileSync(`${ACTIONS}/${name}.ts`, "utf8");
      const lines: string[] = [];
      for (const [, what, kind] of source.matchAll(/^export (?:async )?(?:const|let|function|class) (\w+)(?: = server(Action|Query)\()?/gm)) {
        if (!kind) throw new Error(`Storybook can't fake ${what} in src/app/actions/${name}.ts: only serverAction and serverQuery can be exported there.`);
        lines.push(`export const ${what} = override.${what} ?? fake${kind}(${JSON.stringify(what)});`);
      }
      const custom = here(`./fakes/actions/${name}.ts`);
      return [
        `import { fakeAction, fakeQuery } from ${JSON.stringify(here("./fakes/server.ts"))};`,
        existsSync(custom) ? `import * as override from ${JSON.stringify(custom)};` : "const override = {};",
        ...lines,
      ].join("\n");
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

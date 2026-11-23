import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lingui } from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, normalizePath, parseSync, type Plugin } from "vite";

/** A path the way Vite writes it, with forward slashes on Windows too. */
const here = (p: string) => normalizePath(fileURLToPath(new URL(p, import.meta.url)));

const ACTIONS = here("../src/app/actions");
const ANSWERS = here("./fakes/actions");
const VIRTUAL = "\0fake-actions:";

/** "mail" for <dir>/mail.ts; nothing for a file elsewhere. */
const moduleName = (file: string, dir: string) =>
  file.startsWith(`${dir}/`) ? file.slice(dir.length + 1).match(/^([\w-]+)\.ts$/)?.[1] : undefined;

type Fake = { name: string; kind: "Action" | "Query" };

/** What an actions module exports at runtime. Throws on anything that isn't a serverAction or a serverQuery. */
function serverFunctions(file: string): Fake[] {
  const { program, errors } = parseSync(file, readFileSync(file, "utf8"));
  const where = file.slice(ACTIONS.length + 1);
  if (errors.length) throw new Error(`Storybook can't read src/app/actions/${where}: ${errors[0].message}`);
  const refuse = (what: string): never => {
    throw new Error(`Storybook can't fake ${what} in src/app/actions/${where}: only serverAction and serverQuery can be exported there, by name.`);
  };

  // Every top-level variable made by serverAction(…) or serverQuery(…), with or without type annotations.
  const kinds = new Map<string, Fake["kind"]>();
  for (const node of program.body) {
    const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const { id, init } of declaration.declarations) {
      let value = init;
      while (
        value?.type === "TSAsExpression" || value?.type === "TSSatisfiesExpression" ||
        value?.type === "TSNonNullExpression" || value?.type === "ParenthesizedExpression"
      ) value = value.expression;
      if (id.type !== "Identifier" || value?.type !== "CallExpression" || value.callee.type !== "Identifier") continue;
      const kind = value.callee.name.match(/^server(Action|Query)$/)?.[1];
      if (kind) kinds.set(id.name, kind as Fake["kind"]);
    }
  }

  const fakes: Fake[] = [];
  const add = (name: string, local = name) => {
    const kind = kinds.get(local);
    if (kind) fakes.push({ name, kind });
    else refuse(name);
  };
  for (const node of program.body) {
    if (node.type === "ExportDefaultDeclaration") refuse("the default export");
    else if (node.type === "ExportAllDeclaration") {
      if (node.exportKind !== "type") refuse(`export * from "${node.source.value}"`);
    } else if (node.type === "ExportNamedDeclaration" && node.exportKind !== "type") {
      const { declaration } = node;
      if (declaration?.type === "VariableDeclaration")
        for (const { id } of declaration.declarations) id.type === "Identifier" ? add(id.name) : refuse("a destructured export");
      else if (declaration) refuse("id" in declaration && declaration.id && "name" in declaration.id ? String(declaration.id.name) : "an export");
      for (const s of node.specifiers) {
        if (s.exportKind === "type") continue;
        if (node.source || s.local.type !== "Identifier" || s.exported.type !== "Identifier" || s.exported.name === "default") refuse("a re-export or default export");
        else add(s.exported.name, s.local.name);
      }
    }
  }
  return fakes;
}

/** The names a file of specific answers exports. */
function answerNames(file: string): string[] {
  const { program, errors } = parseSync(file, readFileSync(file, "utf8"));
  if (errors.length) throw new Error(`Storybook can't read ${file}: ${errors[0].message}`);
  return program.body.flatMap((node) => {
    if (node.type !== "ExportNamedDeclaration" || node.exportKind === "type") return [];
    const { declaration } = node;
    if (declaration?.type === "VariableDeclaration") return declaration.declarations.flatMap(({ id }) => (id.type === "Identifier" ? [id.name] : []));
    if (declaration?.type === "FunctionDeclaration") return declaration.id ? [declaration.id.name] : [];
    return node.specifiers.flatMap((s) => (s.exportKind !== "type" && s.exported.type === "Identifier" ? [s.exported.name] : []));
  });
}

/**
 * Server actions are replaced by fakes, generated from each module in src/app/actions/:
 * every serverAction answers { ok: true }, every serverQuery answers nothing (components keep
 * what the story gave them). The "Server" toolbar makes them fail or be slow instead.
 * fakes/actions/<module>.ts can give specific answers; what it exports replaces the generated fake, and must be an action there.
 * A module exporting anything else at runtime stops the build: no story may reach real server code.
 */
function fakeServerActions(): Plugin {
  return {
    name: "gentlemail:fake-server-actions",
    enforce: "pre",
    buildStart() {
      for (const file of readdirSync(ANSWERS))
        if (!existsSync(`${ACTIONS}/${file}`)) throw new Error(`.storybook/fakes/actions/${file} answers for src/app/actions/${file}, which doesn't exist.`);
    },
    async resolveId(id, importer, options) {
      if (!importer || importer.includes("/node_modules/")) return null;
      // Where the import really leads, however it's written ("@/app/actions/mail", "../actions/mail").
      const file = (await this.resolve(id, importer, { ...options, skipSelf: true }))?.id.split("?")[0];
      if (!file?.startsWith(`${ACTIONS}/`)) return null;
      // Helpers that aren't server functions (guards.ts) stay as they are; components only import their types.
      if (!/^["']use server["']/m.test(readFileSync(file, "utf8"))) return null;
      const name = moduleName(file, ACTIONS);
      if (!name) throw new Error(`Storybook can't fake ${file.slice(ACTIONS.length + 1)}: server functions go in .ts files directly in src/app/actions/.`);
      return VIRTUAL + name;
    },
    load(id) {
      if (!id.startsWith(VIRTUAL)) return null;
      const name = id.slice(VIRTUAL.length);
      const file = `${ACTIONS}/${name}.ts`;
      this.addWatchFile(file);
      const fakes = serverFunctions(file);
      const custom = `${ANSWERS}/${name}.ts`;
      const answered = existsSync(custom) ? answerNames(custom) : [];
      const unknown = answered.find((a) => !fakes.some((f) => f.name === a));
      if (unknown) throw new Error(`.storybook/fakes/actions/${name}.ts answers for ${unknown}, which isn't in src/app/actions/${name}.ts.`);
      return [
        `import { fakeAction, fakeQuery } from ${JSON.stringify(here("./fakes/server.ts"))};`,
        ...(answered.length ? [`export { ${answered.join(", ")} } from ${JSON.stringify(custom)};`] : []),
        ...fakes.filter((f) => !answered.includes(f.name)).map((f) => `export const ${f.name} = fake${f.kind}(${JSON.stringify(f.name)});`),
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
  // lingui compiles t`…` / msg`…` macros, as in the app's config.
  plugins: [lingui({ macroTransform: true }), fakeServerActions(), tailwindcss()],
  resolve: {
    alias: {
      "cloudflare:workers": here("./fakes/cloudflare-workers.ts"),
      "rwsdk/client": here("./fakes/rwsdk-client.ts"),
      "@": here("../src"),
    },
  },
  // Found late (it comes from a macro), it makes Vite bundle again and reload the first story.
  optimizeDeps: { include: ["@lingui/core", "@lingui/react/server"] },
  define: {
    __APP_VERSION__: JSON.stringify("0.0.0-storybook"),
    __WORKER_NAME__: JSON.stringify("gentlemail"),
  },
});

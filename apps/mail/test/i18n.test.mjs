// Translations: every word on screen comes from a catalog key (see src/lib/i18n.ts), and every
// key has its English and French text. Run with `npm test`; `npm run i18n` updates the catalogs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(tsx?|mts)$/.test(name)) out.push(path);
  }
  return out;
}

/** Messages in a .po catalog: key -> text. */
function catalog(locale) {
  const po = readFileSync(join(root, `locales/${locale}/messages.po`), "utf8");
  const out = new Map();
  for (const m of po.matchAll(/msgid "([^"]+)"\nmsgstr ((?:"(?:[^"\\]|\\.)*"\n?)+)/g)) {
    out.set(m[1], [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((p) => p[1]).join(""));
  }
  return out;
}

// What the webmail shows is in src/app; the API, MCP and the shadcn primitives stay English.
const screens = files(join(root, "app")).filter((f) => f.endsWith(".tsx") && !f.includes("/components/ui/"));

// Text that is the same in every language: names, code and examples of code.
const ALLOWED = new Set(["SPF", "DMARC", "HTTP", "GentleMail", "npm install gentlemail", "English", "Français"]);

test("no text is written straight in a page or component", () => {
  const found = [];
  for (const file of screens) {
    // Text inside <Trans> is translated as a whole, and code shown as code stays as it is.
    const source = readFileSync(file, "utf8").replace(/<Trans\b[\s\S]*?<\/Trans>|<(code|pre|Code|script)\b[^>]*>[^<]*<\/\1>/g, (block) =>
      block.replace(/[^\n]/g, " "),
    );
    source.split("\n").forEach((line, i) => {
      // Comments, and type annotations such as Promise<Check[]>, aren't text on screen.
      if (/^\s*(\/\/|\*|\/\*)/.test(line) || /\b(Promise|Record|Array|Map|Set)</.test(line)) return;
      const where = `${relative(root, file)}:${i + 1}`;
      // <span>Some words</span>
      for (const m of line.matchAll(/(?:<[A-Za-z][\w.]*(?:\s[^<>]*)?>|\/>)([^<>{}`=]*[A-Za-z]{2,}[^<>{}`=]*)</g)) {
        const text = m[1].trim();
        if (text && !ALLOWED.has(text) && /[a-z]/.test(text)) found.push(`${where}  >${text}<`);
      }
      // title="Some words", aria-label="…", placeholder="…"
      for (const m of line.matchAll(/\b(title|label|placeholder|aria-label|alt|description|hint|submitLabel|confirmLabel|onLabel|offLabel|empty)="([^"]*[A-Za-z]{2,}[^"]*)"/g)) {
        if (!ALLOWED.has(m[2])) found.push(`${where}  ${m[1]}="${m[2]}"`);
      }
    });
  }
  assert.deepEqual(found, [], `Put these in t({ id, message }) or <Trans id>:\n${found.join("\n")}`);
});

test("every key used in the code is in the English catalog", () => {
  const en = catalog("en");
  const missing = [];
  for (const file of files(root)) {
    for (const m of readFileSync(file, "utf8").matchAll(/\b(?:t|msg)\(\{\s*id: "([^"]+)"|<Trans id="([^"]+)"/g)) {
      const key = m[1] ?? m[2];
      if (!en.has(key)) missing.push(`${relative(root, file)}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `Run npm run i18n to update the catalogs:\n${missing.join("\n")}`);
});

test("every English key is translated into French, with the same placeholders", () => {
  const en = catalog("en");
  const fr = catalog("fr");
  const placeholders = (s) => [...new Set([...s.matchAll(/\{(\w+)[,}]|<\/?(\d+)>/g)].map((m) => m[1] ?? `<${m[2]}>`))].sort();
  const problems = [];
  for (const [key, text] of en) {
    const french = fr.get(key);
    if (!french) problems.push(`${key}: not translated`);
    else if (placeholders(french).join() !== placeholders(text).join()) problems.push(`${key}: placeholders differ`);
  }
  assert.deepEqual(problems, []);
});

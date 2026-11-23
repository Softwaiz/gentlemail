/*
 * Checks that a change leaves the pages exactly as they were: builds this tree and a base
 * (origin/dev by default), renders the same pages from the same made-up data in both, and
 * compares the HTML. Run it when splitting a page into a loader and a view.
 *
 *   npm run compare-pages               # against origin/dev
 *   npm run compare-pages -- main       # against another branch, tag or commit
 *
 * The base is built once per commit in .compare-pages/ at the repository root (a git worktree,
 * ignored by git; not under node_modules, where Vite would treat the source as a dependency).
 * The rendered pages are kept there too, to look at when something differs.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const APP = resolve(import.meta.dirname, "..");
const ROOT = resolve(APP, "../..");
const CACHE = join(ROOT, ".compare-pages");
const ref = process.argv[2] ?? "origin/dev";

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" }).trim();
const step = (s) => console.log(`\n» ${s}`);
/** Builds a tree with its own Vite (not whichever `vite` comes first on PATH). */
const build = (app) => run(join(app, "node_modules/.bin/vite"), ["build"], app);

/* ---------- Builds ---------- */

const sha = run("git", ["rev-parse", "--short", ref], ROOT);
const baseRoot = join(CACHE, `base-${sha}`);
const baseApp = join(baseRoot, "apps/mail");
if (!existsSync(join(baseApp, "dist/worker/wrangler.json"))) {
  step(`Building ${ref} (${sha}) in ${baseRoot}`);
  rmSync(baseRoot, { recursive: true, force: true });
  run("git", ["worktree", "prune"], ROOT);
  run("git", ["worktree", "add", "--detach", baseRoot, sha], ROOT);
  run("pnpm", ["install", "--frozen-lockfile"], baseRoot);
  build(baseApp);
} else step(`${ref} (${sha}) already built`);

step("Building this tree");
build(APP);

/* ---------- Pages ---------- */

/** The made-up data both builds render: two domains, a turned-off mailbox, mail in each folder, an admin and a member. */
async function seed(app) {
  const { sha256, q } = await import(join(app, "test/harness.mjs"));
  const t = 1795000000000; // fixed, so dates read the same in both
  const rows = [
    `INSERT INTO domains (id, name, active, created_at) VALUES ('dA', 'alpha.test', 1, ${t});`,
    `INSERT INTO domains (id, name, active, created_at) VALUES ('dB', 'beta.test', 1, ${t});`,
    `INSERT INTO mailboxes (id, address, display_name, active, created_at) VALUES ('mA1', 'one@alpha.test', 'One', 1, ${t});`,
    `INSERT INTO mailboxes (id, address, display_name, active, created_at) VALUES ('mA2', 'two@alpha.test', 'Two', 0, ${t});`,
    `INSERT INTO mailboxes (id, address, display_name, active, created_at) VALUES ('mB1', 'one@beta.test', 'Beta', 1, ${t});`,
  ];
  for (const [id, email, role, mailboxes] of [["uAdmin", "admin@alpha.test", "admin", []], ["uMember", "member@alpha.test", "member", ["mA1"]]]) {
    rows.push(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (${q(id)}, ${q(email)}, ${q(id)}, 'x', ${q(role)}, ${t});`);
    rows.push(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (${q(sha256(`session-${id}`))}, ${q(id)}, ${Date.now() + 3600e3}, ${t});`);
    for (const mb of mailboxes) rows.push(`INSERT INTO mailbox_members (mailbox_id, user_id) VALUES (${q(mb)}, ${q(id)});`);
  }
  const mail = [["mA1", "inbox", 0], ["mA1", "inbox", 0], ["mA1", "inbox", 1], ["mA1", "archive", 0], ["mA1", "spam", 0], ["mA1", "sent", 1], ["mB1", "inbox", 0]];
  mail.forEach(([mb, folder, read], i) =>
    rows.push(
      `INSERT INTO messages (id, mailbox_id, thread_id, folder, direction, from_addr, from_name, to_json, subject, snippet, text_body, is_read, date, created_at)
       VALUES ('m${i}', ${q(mb)}, 't${i}', ${q(folder)}, ${q(folder === "sent" ? "out" : "in")}, 'sender@elsewhere.test', 'Sender', '[]', 'Subject ${i}', 'hi', 'Body ${i}', ${read}, ${t - i * 1000}, ${t});`,
    ),
  );
  return rows.join("\n");
}

/** Who opens which page. Add a page here when you split it. */
const PAGES = {
  admin: [
    "/mb/mA1/inbox", "/mb/mA1/sent", "/mb/mA1/archive", "/mb/mA1/spam", "/mb/mA1/trash", "/mb/mA1/settings",
    "/mb/mA1/compose", "/mb/mA1/thread/t0?f=inbox", "/mb/mA2/inbox", "/mb/mB1/inbox", "/mb/mA1/inbox?q=Subject",
    "/admin", "/admin/api", "/account/security", "/mb/nope/inbox", "/nope",
  ],
  member: ["/mb/mA1/inbox", "/mb/mA1/settings", "/account/security", "/admin", "/mb/mB1/inbox"],
  signedOut: ["/login", "/login?err=Wrong%20email%20or%20password.&next=/mb", "/setup", "/login/verify", "/mb/mA1/inbox"],
};

/** Removes what differs between any two builds or requests, so only real changes are left. */
const normalize = (html, root) =>
  html
    .replace(/nonce="[^"]*"/g, 'nonce=""') // new on every request
    // Page data is cut into chunks of a fixed size, so a path can be split in two: join them first.
    .replaceAll('")</script><script nonce="">(self.__FLIGHT_DATA||=[]).push("', "")
    .replaceAll(root, "<root>") // dev builds write source paths into the page data
    .replace(/\/assets\/[\w.-]+?-[\w-]{8}\.(js|css)/g, "/assets/<hashed>.$1"); // build hashes

/**
 * Starts a tree's built Worker from inside that tree. Miniflare names the Worker's modules
 * relative to the current folder: from outside, the names start with "../" and workerd
 * refuses to start ("internal error").
 */
async function start(app) {
  const { startWorker } = await import(join(app, "test/harness.mjs"));
  process.chdir(app);
  return startWorker(await seed(app));
}

async function render(app, root, out) {
  const { mf, request } = await start(app);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  try {
    for (const [who, paths] of Object.entries(PAGES))
      for (const path of paths) {
        const headers = who === "signedOut" ? {} : { Cookie: `kb_session=session-u${who[0].toUpperCase()}${who.slice(1)}` };
        const r = await request(path, { headers });
        const name = `${who}${path.replace(/[^\w]+/g, "_")}.html`;
        writeFileSync(join(out, name), `${r.status} ${r.headers.get("location") ?? ""}\n${normalize(await r.text(), root)}`);
      }
  } finally {
    await mf.dispose();
  }
}

step("Rendering the pages");
const baseOut = join(CACHE, "pages/base");
const headOut = join(CACHE, "pages/this");
await render(baseApp, baseRoot, baseOut);
await render(APP, ROOT, headOut);

/* ---------- Comparison ---------- */

const names = Object.entries(PAGES).flatMap(([who, paths]) => paths.map((p) => `${who}${p.replace(/[^\w]+/g, "_")}.html`));
const differ = names.filter((n) => readFileSync(join(baseOut, n), "utf8") !== readFileSync(join(headOut, n), "utf8"));

console.log();
for (const n of names) {
  const status = readFileSync(join(headOut, n), "utf8").split("\n", 1)[0];
  console.log(`${differ.includes(n) ? "✗ differs  " : "✓ identical"}  ${status.padEnd(5)} ${n}`);
}
for (const n of differ) {
  const a = readFileSync(join(baseOut, n), "utf8");
  const b = readFileSync(join(headOut, n), "utf8");
  let i = 0;
  while (a[i] === b[i]) i++;
  console.log(`\n${n}, first difference:\n  ${ref}: …${a.slice(Math.max(0, i - 120), i + 120)}…\n  this: …${b.slice(Math.max(0, i - 120), i + 120)}…`);
}
console.log(`\n${names.length - differ.length} of ${names.length} pages identical to ${ref}. Pages kept in ${join(CACHE, "pages")}.`);
process.exit(differ.length ? 1 : 0);

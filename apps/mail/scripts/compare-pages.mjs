/*
 * Checks that a change leaves the pages exactly as they were: builds this tree and a base
 * (origin/dev by default), renders the same pages from the same made-up data in both, and
 * compares the HTML. Run it when splitting a page into a loader and a view.
 *
 *   npm run compare-pages               # against where this branch left origin/dev
 *   npm run compare-pages -- main       # against another branch, tag or commit
 *
 * The base is the last commit this branch shares with that ref (fetched first when it's a remote
 * branch), so what others merged since doesn't count as a difference. It's built once per commit in
 * .compare-pages/ at the repository root (a git worktree, ignored by git; not under node_modules,
 * where Vite would treat the source as a dependency). The rendered pages are kept there too, to
 * look at when something differs.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BASE, q, sha256, startWorker } from "../test/harness.mjs";

const APP = resolve(import.meta.dirname, "..");
const ref = process.argv[2] ?? "origin/dev";

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" }).trim();
const step = (s) => console.log(`\n» ${s}`);
/** Builds a tree with its own Vite (not whichever `vite` comes first on PATH). */
const build = (app) => run(join(app, "node_modules/.bin/vite"), ["build"], app);

/** The repository, and where the app is in it: apps/mail/ here, the top of a copy made by the Deploy button. */
const ROOT = resolve(run("git", ["rev-parse", "--show-toplevel"], APP));
const APP_IN_ROOT = run("git", ["rev-parse", "--show-prefix"], APP);
const CACHE = join(ROOT, ".compare-pages");

/* ---------- Builds ---------- */

const [remote, ...branch] = ref.split("/");
if (branch.length && run("git", ["remote"], ROOT).split("\n").includes(remote)) {
  try {
    run("git", ["fetch", "--quiet", remote, branch.join("/")], ROOT);
  } catch {
    console.warn(`Couldn't fetch ${ref}: comparing with the copy fetched last.`);
  }
}
let sha;
try {
  sha = run("git", ["rev-parse", "--short", run("git", ["merge-base", "HEAD", ref], ROOT)], ROOT);
} catch {
  console.error(`There's no ${ref} to compare with here. Name a branch, tag or commit: npm run compare-pages -- main`);
  process.exit(2);
}
const baseRoot = join(CACHE, `base-${sha}`);
const baseApp = join(baseRoot, APP_IN_ROOT);
/** Written once the base is built, so a build that failed or was stopped is done again. */
const built = join(baseRoot, ".built");
if (!existsSync(built)) {
  step(`Building ${ref} (${sha}) in ${baseRoot}`);
  rmSync(baseRoot, { recursive: true, force: true });
  run("git", ["worktree", "prune"], ROOT);
  run("git", ["worktree", "add", "--detach", baseRoot, sha], ROOT);
  // A copy made by the Deploy button holds neither pnpm's lockfile nor its workspace settings: npm there.
  if (existsSync(join(baseRoot, "pnpm-lock.yaml"))) run("pnpm", ["install", "--frozen-lockfile"], baseRoot);
  else run("npm", existsSync(join(baseApp, "package-lock.json")) ? ["ci"] : ["install", "--no-package-lock"], baseApp);
  build(baseApp);
  writeFileSync(built, "");
  // Each base is a whole checkout and install: keep only this one.
  for (const old of readdirSync(CACHE).filter((d) => d.startsWith("base-") && d !== `base-${sha}`)) rmSync(join(CACHE, old), { recursive: true, force: true });
  run("git", ["worktree", "prune"], ROOT);
} else step(`${ref} (${sha}) already built`);

step("Building this tree");
build(APP);

/* ---------- Pages ---------- */

/** The made-up data both builds render: two domains, a turned-off mailbox, mail in each folder, an admin, a member and someone with no mailbox. */
function seed() {
  const t = 1795000000000; // fixed, so dates read the same in both
  const rows = [
    `INSERT INTO domains (id, name, active, created_at) VALUES ('dA', 'alpha.test', 1, ${t});`,
    `INSERT INTO domains (id, name, active, created_at) VALUES ('dB', 'beta.test', 1, ${t});`,
    `INSERT INTO mailboxes (id, address, display_name, active, created_at) VALUES ('mA1', 'one@alpha.test', 'One', 1, ${t});`,
    `INSERT INTO mailboxes (id, address, display_name, active, created_at) VALUES ('mA2', 'two@alpha.test', 'Two', 0, ${t});`,
    `INSERT INTO mailboxes (id, address, display_name, active, created_at) VALUES ('mB1', 'one@beta.test', 'Beta', 1, ${t});`,
  ];
  for (const [id, email, role, mailboxes] of [["uAdmin", "admin@alpha.test", "admin", []], ["uMember", "member@alpha.test", "member", ["mA1"]], ["uNobody", "nobody@beta.test", "member", []]]) {
    rows.push(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (${q(id)}, ${q(email)}, ${q(id)}, 'x', ${q(role)}, ${t});`);
    rows.push(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (${q(sha256(`session-${id}`))}, ${q(id)}, ${Date.now() + 3600e3}, ${t});`);
    for (const mb of mailboxes) rows.push(`INSERT INTO mailbox_members (mailbox_id, user_id) VALUES (${q(mb)}, ${q(id)});`);
  }
  // An AI assistant asking to connect.
  rows.push(`INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES ('client1', 'Made-up assistant', '["https://assistant.test/back"]', ${t});`);
  // An admin whose password was right and whose two-step code is still due.
  rows.push(`INSERT INTO login_challenges (id, user_id, next, expires_at) VALUES (${q(sha256("challenge-uAdmin"))}, 'uAdmin', '/', ${Date.now() + 600e3});`);
  const mail = [["mA1", "inbox", 0], ["mA1", "inbox", 0], ["mA1", "inbox", 1], ["mA1", "archive", 0], ["mA1", "spam", 0], ["mA1", "sent", 1], ["mB1", "inbox", 0]];
  mail.forEach(([mb, folder, read], i) =>
    rows.push(
      `INSERT INTO messages (id, mailbox_id, thread_id, folder, direction, from_addr, from_name, to_json, subject, snippet, text_body, is_read, date, created_at)
       VALUES ('m${i}', ${q(mb)}, 't${i}', ${q(folder)}, ${q(folder === "sent" ? "out" : "in")}, 'sender@elsewhere.test', 'Sender', '[]', 'Subject ${i}', 'hi', 'Body ${i}', ${read}, ${t - i * 1000}, ${t});`,
    ),
  );
  return rows.join("\n");
}

const session = (user) => ({ Cookie: `kb_session=session-${user}` });

/** What the made-up assistant sends people to. */
const consent = `/oauth/authorize?${new URLSearchParams({
  response_type: "code", client_id: "client1", redirect_uri: "https://assistant.test/back", state: "s",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", code_challenge_method: "S256",
})}`;

const french = { "Accept-Language": "fr" };

/**
 * Who opens which page, on which data. A page must answer 200; write the status in front when it
 * shouldn't ("303 /setup"), so a page that starts redirecting fails instead of comparing two redirects.
 * "POST /login email=…" sends a form: errors come back on the page that was posted to.
 * Add a page here when you split it.
 */
const SCENARIOS = {
  admin: {
    headers: session("uAdmin"),
    pages: [
      "/mb/mA1/inbox", "/mb/mA1/sent", "/mb/mA1/archive", "/mb/mA1/spam", "/mb/mA1/trash", "/mb/mA1/settings",
      "/mb/mA1/compose", "/mb/mA1/thread/t0?f=inbox", "/mb/mA2/inbox", "/mb/mB1/inbox", "/mb/mA1/inbox?q=Subject",
      "/admin", "/admin/api", "/account/security", "404 /mb/nope/inbox", "404 /nope", consent, "/oauth/authorize?client_id=nope",
    ],
  },
  adminFrench: {
    headers: { ...session("uAdmin"), ...french },
    pages: ["/mb/mA1/inbox", "/mb/mA1/settings", "/admin", "/account/security", "404 /nope", consent],
  },
  member: {
    headers: session("uMember"),
    pages: ["/mb/mA1/inbox", "/mb/mA1/settings", "/account/security", "403 /admin", "403 /mb/mB1/inbox"],
  },
  /** Signed in, with no mailbox to open. */
  noMailbox: { headers: session("uNobody"), pages: ["303 /", "/no-mailbox"] },
  signedOut: {
    pages: [
      "/login", "/login?err=signin_timeout&next=/mb", "401 POST /login email=nobody@alpha.test&password=wrong&next=/mb",
      "303 /setup", "303 /login/verify", "303 /mb/mA1/inbox",
    ],
  },
  signedOutFrench: { headers: french, pages: ["/login", "401 POST /login email=nobody@alpha.test&password=wrong"] },
  /** The password was right; the two-step code is due. */
  codeDue: { headers: { Cookie: "kb_mfa=challenge-uAdmin" }, pages: ["/login/verify", "401 POST /login/verify code=000000"] },
  codeDueFrench: { headers: { Cookie: "kb_mfa=challenge-uAdmin", ...french }, pages: ["/login/verify"] },
  /** A new instance: nobody has an account yet. */
  firstRun: {
    empty: true,
    bindings: { SETUP_TOKEN: "made-up" },
    pages: [
      "/setup", "403 POST /setup token=wrong&name=Ada&email=ada@alpha.test&password=long-enough",
      "400 POST /setup token=made-up&name=Ada&email=ada@alpha.test&password=short", "303 /login",
    ],
  },
  firstRunFrench: { empty: true, bindings: { SETUP_TOKEN: "made-up" }, headers: french, pages: ["/setup"] },
  firstRunNoToken: { empty: true, pages: ["/setup"] },
};

const PAGES = Object.entries(SCENARIOS).flatMap(([who, { pages }]) =>
  pages.map((p) => {
    const [, status, post, path, form] = p.match(/^(?:(\d{3}) )?(POST )?(\S+)(?: (.*))?$/);
    const name = `${who}_${[post, path, form].join("").replace(/[^\w]+/g, "_")}`.replace(/_+/g, "_").replace(/_$/, "");
    return { who, path, body: post && new URLSearchParams(form), status: Number(status ?? 200), name: `${name.slice(0, 100)}.html` };
  }),
);

/** Removes what differs between any two builds or requests, so only real changes are left. */
const normalize = (html, root, version) =>
  html
    .replace(/nonce="[^"]*"/g, 'nonce=""') // new on every request
    // Page data is cut into chunks of a fixed size, so a path can be split in two: join them first.
    .replaceAll('")</script><script nonce="">(self.__FLIGHT_DATA||=[]).push("', "")
    .replaceAll(root, "<root>") // dev builds write source paths into the page data
    .replace(version, "<version>") // the version admins see, with or without "+dev"
    .replace(/\/assets\/[\w.-]+?-[\w-]{8}\.(js|css)/g, "/assets/<hashed>.$1"); // build hashes

/** Matches the version in a tree's package.json, as its build writes it. */
function versionOf(app) {
  const { version } = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  return new RegExp(`(?<![\\w.])${version.replace(/[.+]/g, "\\$&")}(\\+dev)?(?![\\w.+-])`, "g");
}

/**
 * Renders every page from a tree's built Worker, started from inside that tree. Miniflare names
 * the Worker's modules relative to the current folder: from outside, the names start with "../"
 * and workerd refuses to start ("internal error").
 */
async function render(app, root, out) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  process.chdir(app);
  const version = versionOf(app);
  for (const [who, { headers = {}, empty, bindings }] of Object.entries(SCENARIOS)) {
    const { mf, request } = await startWorker(empty ? "" : seed(), { app, bindings });
    try {
      for (const page of PAGES.filter((p) => p.who === who)) {
        const { path, body } = page;
        const r = await request(path, body ? { method: "POST", body: String(body), headers: { ...headers, Origin: BASE, "Content-Type": "application/x-www-form-urlencoded" } } : { headers });
        writeFileSync(join(out, page.name), `${r.status} ${r.headers.get("location") ?? ""}\n${normalize(await r.text(), root, version)}`);
      }
    } finally {
      await mf.dispose();
    }
  }
}

step("Rendering the pages");
const baseOut = join(CACHE, "pages/base");
const headOut = join(CACHE, "pages/this");
await render(baseApp, baseRoot, baseOut);
await render(APP, ROOT, headOut);

/* ---------- Comparison ---------- */

const read = (dir, { name }) => readFileSync(join(dir, name), "utf8");
const statusOf = (html) => Number(html.slice(0, 3));
let same = 0;
const details = [];

console.log();
for (const page of PAGES) {
  const a = read(baseOut, page);
  const b = read(headOut, page);
  const wrong = [[ref, a], ["this", b]].filter(([, html]) => statusOf(html) !== page.status);
  if (wrong.length) {
    // Two redirects are the same whatever the page draws: that's not a comparison.
    for (const [where, html] of wrong) details.push(`${page.name}: expected ${page.status}, ${where} answered ${html.split("\n", 1)[0].trim()}`);
  } else if (a !== b) {
    let i = 0;
    while (a[i] === b[i]) i++;
    details.push(`${page.name}, first difference:\n  ${ref}: …${a.slice(Math.max(0, i - 120), i + 120)}…\n  this: …${b.slice(Math.max(0, i - 120), i + 120)}…`);
  } else same++;
  console.log(`${wrong.length ? "✗ status   " : a !== b ? "✗ differs  " : "✓ identical"}  ${statusOf(b)}  ${page.name}`);
}
for (const d of details) console.log(`\n${d}`);
console.log(`\n${same} of ${PAGES.length} pages identical to ${ref} (${sha}). Pages kept in ${join(CACHE, "pages")}.`);
process.exit(details.length ? 1 : 0);

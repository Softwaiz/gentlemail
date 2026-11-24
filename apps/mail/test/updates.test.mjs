/*
 * New versions: what is read from gentlemail.dev and when, who is told, and that it can be
 * turned off. Also the list itself, made from CHANGELOG.md by the docs.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { Response as WorkerResponse } from "miniflare";
import { encodeReply } from "react-server-dom-webpack/client.edge";
import { BASE, q, sha256, startWorker } from "./harness.mjs";

const { version: RUNNING } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const ADMIN = "session-admin", ADMIN2 = "session-admin2", MEMBER = "session-member";

let mf, db, request;
let asked = []; // requests that left the Worker
let answer; // what gentlemail.dev answers

const release = (version, sections = { Added: [`New in ${version}`] }) => ({ version, date: "2026-12-01", sections });
const list = (...releases) => () => WorkerResponse.json({ releases });

before(async () => {
  const t = Date.now();
  ({ mf, db, request } = await startWorker(
    [
      `INSERT INTO domains (id, name, active, created_at) VALUES ('d1', 'alpha.test', 1, ${t});`,
      `INSERT INTO mailboxes (id, address, display_name, active, created_at) VALUES ('mb1', 'hello@alpha.test', 'Hello', 1, ${t});`,
      ...[["u1", "admin", ADMIN], ["u2", "admin", ADMIN2], ["u3", "member", MEMBER]].flatMap(([id, role, session]) => [
        `INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('${id}', '${id}@alpha.test', 'U', 'x', '${role}', ${t});`,
        `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (${q(sha256(session))}, '${id}', ${t + 3600e3}, ${t});`,
      ]),
      `INSERT INTO mailbox_members (mailbox_id, user_id) VALUES ('mb1', 'u3');`,
    ].join("\n"),
    {
      outbound: (req) => {
        asked.push({ url: req.url, headers: Object.fromEntries(req.headers) });
        return answer();
      },
    },
  ));
});
after(() => mf?.dispose());
beforeEach(async () => {
  asked = [];
  answer = list(release("99.1.0"), release("99.0.0", { Upgrading: ["Run the migration"], Security: ["A hole"] }), release(RUNNING), release("0.0.1"));
  await db.prepare("DELETE FROM settings").run();
});

/** The cron, at `minute` past the hour. */
async function cron(minute = 0) {
  const worker = await mf.getWorker();
  await worker.scheduled({ cron: "* * * * *", scheduledTime: new Date(Date.UTC(2026, 11, 1, 10, minute)) });
}
const page = async (session, path = "/mb/mb1/inbox") => (await request(path, { headers: { Cookie: `kb_session=${session}` } })).text();
async function action(name, args, session = ADMIN) {
  const body = await encodeReply(args);
  const multipart = new Response(body);
  const res = await request(`/admin?__rsc&__rsc_action_id=${encodeURIComponent(`/src/app/actions/updates.ts#${name}`)}`, {
    method: "POST",
    headers: { Cookie: `kb_session=${session}`, Origin: BASE, "Content-Type": multipart.headers.get("content-type") },
    body: await multipart.arrayBuffer(),
  });
  return res.text();
}
const setting = async (key) => (await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first())?.value;
const told = (html) => html.includes("GentleMail 99.1.0 is available");
/** The notice's news, as the page hands it to the browser. */
const later = (html) => /\\?"later\\?":(true|false)/.exec(html)?.[1];

describe("the check", () => {
  test("reads the list once a day, at the hour", async () => {
    await cron(7);
    assert.equal(asked.length, 0);
    await cron();
    await cron();
    assert.deepEqual(asked.map((r) => r.url), ["https://gentlemail.dev/docs/releases.json"]);
    const stored = JSON.parse(await setting("update_releases"));
    await db.prepare("UPDATE settings SET value = ? WHERE key = 'update_releases'").bind(JSON.stringify({ ...stored, checked_at: Date.now() - 24 * 3600e3 })).run();
    await cron();
    assert.equal(asked.length, 2);
  });

  test("sends nothing of its own about the instance", async () => {
    await cron();
    const { headers } = asked[0];
    for (const name of ["cookie", "authorization", "referer", "origin", "x-forwarded-for"]) assert.equal(headers[name], undefined, name);
    assert.ok(!JSON.stringify(asked[0]).includes("alpha.test"));
  });

  test("an answer that can't be used changes nothing, and is asked again", async () => {
    await cron();
    const good = await setting("update_releases");
    await db.prepare("UPDATE settings SET value = ? WHERE key = 'update_releases'").bind(good.replace(/"checked_at":\d+/, '"checked_at":1')).run();
    const before = await setting("update_releases");
    for (const bad of [
      () => new WorkerResponse("gone", { status: 500 }),
      () => new WorkerResponse(null, { status: 302, headers: { Location: "https://elsewhere.example/" } }),
      () => new WorkerResponse("<html>"),
      () => new WorkerResponse("null"),
      () => WorkerResponse.json({ releases: "x" }),
      () => WorkerResponse.json({ releases: [{ version: "latest" }, null, 3] }),
      () => new WorkerResponse(JSON.stringify({ releases: [release("99.9.9")], pad: "x".repeat(250_000) })),
    ]) {
      answer = bad;
      const n = asked.length;
      await cron();
      assert.equal(asked.length, n + 1);
      assert.equal(await setting("update_releases"), before);
    }
    assert.ok(told(await page(ADMIN)));
  });

  test("turned off, it asks nothing and says nothing; turned on, it asks at once", async () => {
    await cron();
    assert.ok(told(await page(ADMIN)));
    await action("setUpdateCheckAction", ["update_check", false]);
    asked = [];
    await cron();
    assert.equal(asked.length, 0);
    assert.ok(!told(await page(ADMIN)));
    assert.equal(await setting("update_releases"), undefined);
    await action("setUpdateCheckAction", ["update_check", true]);
    assert.equal(asked.length, 1);
    assert.ok(told(await page(ADMIN)));
  });
});

describe("the notice", () => {
  test("is for admins, with the releases they don't have", async () => {
    assert.ok(!told(await page(ADMIN)));
    await cron();
    const html = await page(ADMIN);
    assert.ok(told(html));
    for (const part of ["Run the migration", "A hole", "New in 99.1.0"]) assert.ok(html.includes(part), part);
    assert.ok(!html.includes("New in 0.0.1") && !html.includes(`New in ${RUNNING}`));
    const member = await page(MEMBER);
    assert.ok(member.includes("hello@alpha.test") && !/99\.1\.0/.test(member));
  });

  test("isn't shown when the newest release is the one running, or older", async () => {
    answer = list(release(RUNNING), release("0.0.1"));
    await cron();
    assert.ok(!/is available/.test(await page(ADMIN)));
  });

  test("goes once the new version runs", async () => {
    await cron();
    const stored = JSON.parse(await setting("update_releases"));
    stored.releases = [release(RUNNING)]; // read before the deploy
    await db.prepare("UPDATE settings SET value = ? WHERE key = 'update_releases'").bind(JSON.stringify(stored)).run();
    assert.ok(!/is available/.test(await page(ADMIN)));
  });

  test("Later is kept for that person and that version", async () => {
    await cron();
    assert.equal(later(await page(ADMIN)), "false");
    await action("updateLater", []);
    const html = await page(ADMIN);
    assert.ok(told(html));
    assert.equal(later(html), "true");
    assert.equal(later(await page(ADMIN2)), "false");
    answer = list(release("99.2.0"), release("99.1.0"));
    await db.prepare("DELETE FROM settings WHERE key = 'update_releases'").run();
    await cron();
    assert.equal(later(await page(ADMIN)), "false");
  });

  test("what the list says is text", async () => {
    answer = list(release("99.1.0", { Added: ['</script><img src=x onerror="alert(1)">'], "<b>x": ["no"] }));
    await cron();
    const html = await page(ADMIN);
    assert.ok(told(html));
    // Outside the scripts, where the page's data travels as JavaScript strings. Those can't be ended by the text either.
    const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    assert.ok(!markup.includes("onerror="), markup.slice(Math.max(0, markup.indexOf("onerror=") - 200), markup.indexOf("onerror=") + 50));
    assert.ok(!html.includes("<b>x"));
  });

  test("members can't turn the check off", async () => {
    await cron();
    await action("setUpdateCheckAction", ["update_check", false], MEMBER);
    await action("updateLater", [], MEMBER);
    assert.equal(await setting("update_check"), undefined);
    assert.equal(await setting("update_later:u3"), undefined);
  });
});

// Deploy-button copies hold only apps/mail: no docs, no changelog.
const docs = new URL("../../docs/src/lib/releases.ts", import.meta.url);
describe("the list", { skip: !existsSync(docs) }, () => {
  test("is the changelog, without what isn't released", async () => {
    const { parseReleases } = await import(docs.href);
    const releases = parseReleases(readFileSync(new URL("../../../CHANGELOG.md", import.meta.url), "utf8"));
    assert.equal(releases[0].version, RUNNING);
    const r061 = releases.find((r) => r.version === "0.6.1");
    assert.match(r061.sections.Upgrading[0], /^Migration 0009_organize_permission\.sql\. No existing key/);
    assert.ok(!/\]\(|\*\*|`|#\d+/.test(JSON.stringify(releases[0])));
  });

  test("reads sections, wrapped lines and links", async () => {
    const { parseReleases } = await import(docs.href);
    const md = "# C\n\n## Unreleased\n\n### Added\n- no\n\n## 1.2.0 (2026-12-01)\n\n### Fixed\n- **Bold** and `code`\n  wrapped. ([#1](https://x/1))\n- See [docs](https://x). ([#2](https://x/2), [#3](https://x/3))\n";
    assert.deepEqual(parseReleases(md), [{ version: "1.2.0", date: "2026-12-01", sections: { Fixed: ["Bold and code wrapped.", "See docs."] } }]);
  });
});

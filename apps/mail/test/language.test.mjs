/*
 * Which language a page is in, how a choice is saved, and what never follows it: the mail that goes out.
 * Runs the built Worker in Miniflare (see harness.mjs).
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { encodeReply } from "react-server-dom-webpack/client.edge";
import { BASE, q, sha256, startWorker } from "./harness.mjs";

let mf, db, request;
const SESSION = "session-language";
const API_KEY = `gm_test_language_${"x".repeat(24)}`;
const SIGNED_IN = `kb_session=${SESSION}`;
// A month whose name differs in French ("févr.").
const FEBRUARY = Date.UTC(2026, 1, 18, 11, 6);

before(async () => {
  const t = Date.now();
  ({ mf, db, request } = await startWorker(
    [
      `INSERT INTO domains (id, name, active, created_at) VALUES ('d1', 'alpha.test', 1, ${t});`,
      `INSERT INTO mailboxes (id, address, display_name, active, created_at) VALUES ('mb1', 'hello@alpha.test', 'Hello', 1, ${t});`,
      `INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('u1', 'u1@alpha.test', 'U', 'x', 'admin', ${t});`,
      `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (${q(sha256(SESSION))}, 'u1', ${t + 3600e3}, ${t});`,
      `INSERT INTO mailbox_members (mailbox_id, user_id) VALUES ('mb1', 'u1');`,
      `INSERT INTO messages (id, mailbox_id, thread_id, folder, direction, from_addr, from_name, to_json, subject, snippet, text_body, is_read, date, created_at)
       VALUES ('m1', 'mb1', 't1', 'inbox', 'in', 'ada@elsewhere.test', 'Ada', '[{"name":"","address":"hello@alpha.test"}]', 'Hi', 'hi', 'Hello', 0, ${FEBRUARY}, ${t});`,
      `INSERT INTO api_keys (id, name, prefix, key_hash, scopes, created_at) VALUES ('k1', 'k1', 'gm_test', ${q(sha256(API_KEY))}, '', ${t});`,
      `INSERT INTO api_key_grants (key_id, target_type, target_id, can_read, can_organize, can_send) VALUES ('k1', 'mailbox', 'mb1', 1, 0, 1);`,
    ].join("\n"),
  ));
});
after(() => mf?.dispose());

const account = (language) => db.prepare("UPDATE users SET language = ? WHERE id = 'u1'").bind(language).run();
const saved = async () => (await db.prepare("SELECT language FROM users WHERE id = 'u1'").first()).language;
const langCookie = (res) => res.headers.getSetCookie().find((c) => c.startsWith("lang="));

/** Opens a page; returns its language and the lang cookie it sets, if any. */
async function open(path, { cookie, browser }) {
  const res = await request(path, { headers: { ...(cookie && { Cookie: cookie }), ...(browser && { "Accept-Language": browser }) } });
  assert.equal(res.status, 200);
  return { lang: (await res.text()).match(/<html[^>]* lang="(\w+)"/)?.[1], set: langCookie(res) };
}

/** Calls a server action as the browser does. */
async function action(id, args, headers = {}) {
  const body = await encodeReply(args);
  const encoded = new Response(body);
  return request(`/mb/mb1/inbox?__rsc&__rsc_action_id=${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { Cookie: SIGNED_IN, Origin: BASE, "Content-Type": encoded.headers.get("content-type"), ...headers },
    body: await encoded.arrayBuffer(),
  });
}

describe("the language of a page", () => {
  beforeEach(() => account(null));

  test("signed in: the account's, whatever the cookie and the browser say", async () => {
    await account("fr");
    assert.equal((await open("/account/security", { cookie: `${SIGNED_IN}; lang=en`, browser: "en" })).lang, "fr");
  });

  test("signed in with none saved: the browser's, never the cookie", async () => {
    assert.equal((await open("/account/security", { cookie: `${SIGNED_IN}; lang=fr`, browser: "en" })).lang, "en");
    assert.equal((await open("/account/security", { cookie: `${SIGNED_IN}; lang=en`, browser: "fr-CA,en;q=0.5" })).lang, "fr");
  });

  test("signed out: the cookie, then the browser's, then English", async () => {
    assert.equal((await open("/login", { cookie: "lang=fr", browser: "en" })).lang, "fr");
    assert.equal((await open("/login", { browser: "fr" })).lang, "fr");
    assert.equal((await open("/login", { browser: "de-DE" })).lang, "en");
    assert.equal((await open("/login", { cookie: "lang=xx" })).lang, "en");
  });

  test("the device's cookie follows the account, and is cleared when it has none", async () => {
    assert.match((await open("/account/security", { cookie: `${SIGNED_IN}; lang=fr`, browser: "en" })).set, /^lang=;.*Max-Age=0/);
    assert.equal((await open("/account/security", { cookie: SIGNED_IN, browser: "fr" })).set, undefined);
    await account("fr");
    assert.match((await open("/account/security", { cookie: SIGNED_IN, browser: "en" })).set, /^lang=fr;/);
    assert.equal((await open("/account/security", { cookie: `${SIGNED_IN}; lang=fr`, browser: "en" })).set, undefined);
    assert.equal((await open("/login", { cookie: "lang=fr" })).set, undefined);
  });
});

describe("picking a language", () => {
  const pick = (language, headers) => action("/src/app/actions/language.ts#setLanguageAction", [language], headers);
  beforeEach(() => account(null));

  test("saves it and sets the cookie, in one answer", async () => {
    const res = await pick("fr");
    assert.equal(res.status, 200);
    assert.equal(await saved(), "fr");
    assert.match(langCookie(res), /^lang=fr;/);
  });

  test('"Same as browser" clears both', async () => {
    await account("fr");
    const res = await pick(null, { Cookie: `${SIGNED_IN}; lang=fr` });
    assert.equal(await saved(), null);
    assert.match(langCookie(res), /^lang=;.*Max-Age=0/);
  });

  test("an unknown language, or nobody signed in, changes neither", async () => {
    await account("fr");
    const unknown = await pick("xx");
    assert.match(await unknown.text(), /Langue inconnue/);
    assert.equal(langCookie(unknown), undefined);
    assert.equal(langCookie(await pick("en", { Cookie: "x=y" })), undefined);
    assert.equal(await saved(), "fr");
  });
});

describe("mail that goes out stays in English", () => {
  const WHEN = "18 Feb 2026, 11:06 UTC";
  const lastSent = () => db.prepare("SELECT text_body, html_body FROM messages WHERE folder = 'sent' ORDER BY rowid DESC LIMIT 1").first();
  const check = async (words) => {
    const { text_body, html_body } = await lastSent();
    assert.ok(text_body.includes(words), text_body);
    assert.ok(html_body.includes(WHEN), html_body);
    assert.ok(!/févr/.test(text_body + html_body));
  };
  before(() => account("fr"));
  after(() => account(null));

  for (const [mode, words] of [["reply", `On ${WHEN}, Ada <ada@elsewhere.test> wrote:`], ["forward", `Date: ${WHEN}`]]) {
    test(`a ${mode} from the webmail in French`, async () => {
      const form = new FormData();
      for (const [k, v] of Object.entries({ mailbox_id: "mb1", to: "ada@elsewhere.test", subject: mode, body: "Bonjour", original: "m1", mode })) form.set(k, v);
      const res = await action("/src/app/actions/mail.ts#sendMessage", [form]);
      assert.equal(res.status, 200, await res.clone().text());
      await check(words);
    });
  }

  test("the composer in French shows the line a reply is sent with", async () => {
    const html = await (await request("/mb/mb1/compose?reply=m1", { headers: { Cookie: SIGNED_IN } })).text();
    assert.match(html, /<html[^>]* lang="fr"/);
    assert.ok(html.includes(`<span lang="en">On ${WHEN}, Ada &lt;ada@elsewhere.test&gt; wrote:</span>`));
    assert.ok(!html.includes("a écrit"));
  });

  test("an API send with a quote, asked in French", async () => {
    const res = await request("/api/v1/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", "Accept-Language": "fr" },
      body: JSON.stringify({ from: "hello@alpha.test", reply_to_message_id: "m1", text: "API", quote: true }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    await check(`On ${WHEN}, Ada`);
  });

  test("an assistant's reply, asked in French", async () => {
    const res = await request("/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", "Accept-Language": "fr" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "reply", arguments: { message_id: "m1", text: "MCP" } } }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const { text_body } = await lastSent();
    assert.match(text_body, /^MCP/);
    await check(`On ${WHEN}, Ada`);
  });
});

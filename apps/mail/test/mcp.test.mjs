/*
 * The MCP endpoint and the OAuth sign-in in front of it, end to end: an assistant
 * registers, a person signs in and picks what it may do, the assistant trades the
 * code for tokens and calls the tools. It must reach only what was allowed, never
 * more than the person can open, and nothing once disconnected.
 *
 * Runs the built Worker in Miniflare (see harness.mjs). Run from apps/mail: pnpm test.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { BASE, q, sha256, startWorker } from "./harness.mjs";

/* ---------- The world ---------- */

const MAILBOXES = [
  { id: "mA1", address: "one@alpha.test", domain: "dA" },
  { id: "mA2", address: "two@alpha.test", domain: "dA" },
  { id: "mB1", address: "one@beta.test", domain: "dB" },
];
// The member can open one@alpha.test only; the admin can open everything.
const USERS = [
  { id: "uAdmin", email: "admin@alpha.test", role: "admin", session: "session-admin" },
  { id: "uMember", email: "member@alpha.test", role: "member", session: "session-member", mailboxes: ["mA1"] },
];
const API_KEY = "gm_test_mcpkey_xxxxxxxxxxxxxxxxxxxxxxxx"; // read on two@alpha.test

function seedSql() {
  const t = Date.now();
  const rows = [
    `INSERT INTO domains (id, name, active, created_at) VALUES ('dA', 'alpha.test', 1, ${t});`,
    `INSERT INTO domains (id, name, active, created_at) VALUES ('dB', 'beta.test', 1, ${t});`,
  ];
  for (const m of MAILBOXES)
    rows.push(`INSERT INTO mailboxes (id, address, display_name, active, created_at) VALUES (${q(m.id)}, ${q(m.address)}, ${q(m.id)}, 1, ${t});`);
  for (const u of USERS) {
    rows.push(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (${q(u.id)}, ${q(u.email)}, ${q(u.id)}, 'x', ${q(u.role)}, ${t});`);
    rows.push(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (${q(sha256(u.session))}, ${q(u.id)}, ${t + 3600e3}, ${t});`);
    for (const mb of u.mailboxes ?? []) rows.push(`INSERT INTO mailbox_members (mailbox_id, user_id) VALUES (${q(mb)}, ${q(u.id)});`);
  }
  const msg = (id, mb, thread, subject, text, html, offset) =>
    rows.push(
      `INSERT INTO messages (id, mailbox_id, thread_id, folder, direction, from_addr, from_name, to_json, subject, snippet, text_body, html_body, is_read, date, created_at)
       VALUES (${q(id)}, ${q(mb)}, ${q(thread)}, 'inbox', 'in', 'sender@elsewhere.test', 'Sender', ${q(JSON.stringify([{ name: "", address: MAILBOXES.find((m) => m.id === mb).address }, { name: "", address: "colleague@elsewhere.test" }]))}, ${q(subject)}, 'hi', ${q(text)}, ${q(html)}, 0, ${t - offset}, ${t});`,
    );
  msg("m1", "mA1", "tA", "Invoice 42", "Please pay invoice 42.", null, 3000);
  msg("m2", "mA1", "tA", "Re: Invoice 42", "Paid, thanks.", null, 2000);
  msg("m3", "mA1", "tH", "Newsletter", null, "<p>Only <b>HTML</b> here</p>", 1000);
  msg("m4", "mA2", "tB", "For two", "Hello two", null, 1000);
  msg("m5", "mB1", "tC", "Beta secret", "Only for beta", null, 1000);
  // A conversation across mailboxes: one old message the member can read, then 30 newer ones they can't.
  msg("mx", "mA1", "tX", "Shared", "Readable", null, 900000);
  for (let i = 0; i < 30; i++) msg(`mx${i}`, "mB1", "tX", "Re: Shared", "Not for the member", null, 1000 + i);
  rows.push(`INSERT INTO api_keys (id, name, prefix, key_hash, scopes, created_at) VALUES ('kRead', 'kRead', 'gm_test', ${q(sha256(API_KEY))}, '', ${t});`);
  rows.push(`INSERT INTO api_key_grants (key_id, target_type, target_id, can_read, can_send) VALUES ('kRead', 'mailbox', 'mA2', 1, 0);`);
  return rows.join("\n");
}

let mf, request, db;
before(async () => ({ mf, request, db } = await startWorker(seedSql())));
after(() => mf?.dispose());

/* ---------- OAuth helpers ---------- */

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const pkce = () => {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
};
const cookie = (user) => `kb_session=${USERS.find((u) => u.id === user).session}`;
const form = (values) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) for (const x of [v].flat()) body.append(k, x);
  return body;
};

async function register(redirect_uris = ["http://127.0.0.1:5555/callback"], extra = {}) {
  const res = await request("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Test assistant", redirect_uris, ...extra }),
  });
  return { status: res.status, body: await res.json() };
}

const authorizeParams = (client, challenge, extra = {}) =>
  new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    // Another port than registered: loopback redirect URIs match on any port.
    redirect_uri: "http://127.0.0.1:6666/callback",
    state: "st4te",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${BASE}/mcp`,
    ...extra,
  });

/** Signs in as `user`, allows `grants` ({ read: [...targets], send: [...] }) and returns the code. */
async function allow(client, user, grants, challenge) {
  const params = authorizeParams(client, challenge);
  const res = await request("/oauth/authorize", {
    method: "POST",
    headers: { Cookie: cookie(user), "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ ...Object.fromEntries(params), decision: "allow", read: grants.read ?? [], send: grants.send ?? [] }),
  });
  assert.equal(res.status, 303);
  const to = new URL(res.headers.get("location"));
  assert.equal(to.origin + to.pathname, "http://127.0.0.1:6666/callback");
  assert.equal(to.searchParams.get("state"), "st4te");
  assert.equal(to.searchParams.get("iss"), BASE);
  return to.searchParams.get("code");
}

async function token(values) {
  const res = await request("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(values) });
  return { status: res.status, body: await res.json() };
}

/** A connected assistant: register, allow, exchange. */
async function connect(user, grants) {
  const { body: client } = await register();
  const { verifier, challenge } = pkce();
  const code = await allow(client, user, grants, challenge);
  const res = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id, redirect_uri: "http://127.0.0.1:6666/callback" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { client, ...res.body };
}

/* ---------- MCP helpers ---------- */

let rpcId = 0;
async function rpc(bearer, method, params = {}) {
  const res = await request("/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

/** Calls a tool; returns { error } for a tool error, otherwise the parsed result. */
async function tool(bearer, name, args = {}) {
  const res = await rpc(bearer, "tools/call", { name, arguments: args });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const out = res.body.result;
  const text = out.content[0].text;
  return out.isError ? { error: text } : JSON.parse(text);
}

const toolNames = async (bearer) => (await rpc(bearer, "tools/list")).body.result.tools.map((t) => t.name).sort();

/* ---------- Tests ---------- */

describe("discovery", () => {
  test("/mcp without a token answers 401 and points to the sign-in metadata", async () => {
    const res = await request("/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("www-authenticate"), `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
  });

  test("metadata documents name the endpoints", async () => {
    const pr = await (await request("/.well-known/oauth-protected-resource/mcp")).json();
    assert.equal(pr.resource, `${BASE}/mcp`);
    assert.deepEqual(pr.authorization_servers, [BASE]);
    const as = await (await request("/.well-known/oauth-authorization-server")).json();
    assert.equal(as.issuer, BASE);
    assert.equal(as.registration_endpoint, `${BASE}/oauth/register`);
    assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  });

  test("GET /mcp is refused: no event stream", async () => {
    const res = await request("/mcp", { headers: { Authorization: `Bearer ${API_KEY}` } });
    assert.equal(res.status, 405);
  });
});

describe("registration", () => {
  test("accepts https, localhost and app schemes; refuses plain http and javascript:", async () => {
    assert.equal((await register(["https://claude.ai/api/mcp/auth_callback"])).status, 201);
    assert.equal((await register(["http://localhost:1234/cb"])).status, 201);
    assert.equal((await register(["cursor://anysphere.cursor-mcp/oauth/callback"])).status, 201);
    assert.equal((await register(["http://evil.test/cb"])).status, 400);
    assert.equal((await register(["javascript:alert(1)"])).status, 400);
    assert.equal((await register([])).status, 400);
  });

  test("a confidential client gets a secret, and must use it", async () => {
    const { body: client } = await register(undefined, { token_endpoint_auth_method: "client_secret_post" });
    assert.ok(client.client_secret);
    const { verifier, challenge } = pkce();
    const code = await allow(client, "uMember", { read: ["mailbox:mA1"] }, challenge);
    const base = { grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id };
    assert.equal((await token({ ...base, client_secret: "wrong" })).status, 401);
    assert.equal((await token({ ...base, client_secret: client.client_secret })).status, 200);
  });
});

describe("consent screen", () => {
  test("asks to sign in first", async () => {
    const { body: client } = await register();
    const res = await request(`/oauth/authorize?${authorizeParams(client, pkce().challenge)}`);
    assert.equal(res.status, 303);
    assert.match(res.headers.get("location"), /^\/login\?next=%2Foauth%2Fauthorize/);
  });

  test("shows the app and the person's own mailboxes, and lets the answer go back to the app", async () => {
    const { body: client } = await register();
    const res = await request(`/oauth/authorize?${authorizeParams(client, pkce().challenge)}`, { headers: { Cookie: cookie("uMember") } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /calls itself (<!-- -->)?<span[^>]*>“(<!-- -->)?Test assistant(<!-- -->)?”/);
    assert.match(html, /one@alpha\.test/);
    assert.doesNotMatch(html, /one@beta\.test/);
    assert.doesNotMatch(html, /All mailboxes/);
    assert.match(res.headers.get("content-security-policy"), /form-action 'self' http:\/\/127\.0\.0\.1:6666/);
  });

  test("an admin may grant all mailboxes", async () => {
    const { body: client } = await register();
    const res = await request(`/oauth/authorize?${authorizeParams(client, pkce().challenge)}`, { headers: { Cookie: cookie("uAdmin") } });
    const html = await res.text();
    assert.match(html, /All mailboxes/);
    assert.match(html, /one@beta\.test/);
  });

  test("an unknown app or an unregistered redirect is shown here, never followed", async () => {
    const { body: client } = await register();
    const unknown = await request(`/oauth/authorize?${authorizeParams({ client_id: "nope" }, pkce().challenge)}`, { headers: { Cookie: cookie("uMember") } });
    assert.equal(unknown.status, 200);
    assert.match(await unknown.text(), /isn.t registered/);
    const elsewhere = await request(`/oauth/authorize?${authorizeParams(client, pkce().challenge, { redirect_uri: "https://evil.test/cb" })}`, {
      headers: { Cookie: cookie("uMember") },
    });
    assert.equal(elsewhere.status, 200);
    assert.match(await elsewhere.text(), /didn.t register/);
  });

  test("required two-step setup comes back to the consent screen", async () => {
    const { body: client } = await register();
    const path = `/oauth/authorize?${authorizeParams(client, pkce().challenge)}`;
    await db.prepare("INSERT INTO settings (key, value) VALUES ('require_mfa', '1')").run();
    try {
      const res = await request(path, { headers: { Cookie: cookie("uMember") } });
      assert.equal(res.status, 303);
      assert.equal(res.headers.get("location"), `/account/security?next=${encodeURIComponent(path)}`);
    } finally {
      await db.prepare("DELETE FROM settings WHERE key = 'require_mfa'").run();
    }
  });

  test("puts where the access goes first, since apps name themselves", async () => {
    const { body: client } = await register(["https://evil.test/cb"], { client_name: "Claude" });
    const params = authorizeParams(client, pkce().challenge, { redirect_uri: "https://evil.test/cb" });
    const html = await (await request(`/oauth/authorize?${params}`, { headers: { Cookie: cookie("uMember") } })).text();
    assert.match(html, /calls itself/);
    assert.match(html, />evil\.test</);
  });

  test("PKCE is required", async () => {
    const { body: client } = await register();
    const res = await request(`/oauth/authorize?${authorizeParams(client, "", { code_challenge_method: "plain" })}`, { headers: { Cookie: cookie("uMember") } });
    assert.equal(res.status, 303);
    assert.equal(new URL(res.headers.get("location")).searchParams.get("error"), "invalid_request");
  });

  test("Cancel sends access_denied back to the app", async () => {
    const { body: client } = await register();
    const params = authorizeParams(client, pkce().challenge);
    const res = await request("/oauth/authorize", {
      method: "POST",
      headers: { Cookie: cookie("uMember"), "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ ...Object.fromEntries(params), decision: "deny", read: "mailbox:mA1" }),
    });
    assert.equal(new URL(res.headers.get("location")).searchParams.get("error"), "access_denied");
  });

  test("nothing ticked: back to the screen with an error", async () => {
    const { body: client } = await register();
    const params = authorizeParams(client, pkce().challenge);
    const res = await request("/oauth/authorize", {
      method: "POST",
      headers: { Cookie: cookie("uMember"), "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ ...Object.fromEntries(params), decision: "allow", read: "mailbox:mB1" }), // not theirs: dropped
    });
    assert.match(res.headers.get("location"), /^\/oauth\/authorize\?.*err=/);
  });
});

describe("tokens", () => {
  test("a code works once, with the right verifier", async () => {
    const { body: client } = await register();
    const { verifier, challenge } = pkce();
    const code = await allow(client, "uMember", { read: ["mailbox:mA1"] }, challenge);
    const base = { grant_type: "authorization_code", code, client_id: client.client_id };
    assert.equal((await token({ ...base, code_verifier: pkce().verifier })).body.error, "invalid_grant");
    // The failed try used the code up.
    assert.equal((await token({ ...base, code_verifier: verifier })).body.error, "invalid_grant");

    const code2 = await allow(client, "uMember", { read: ["mailbox:mA1"] }, challenge);
    const ok = await token({ ...base, code: code2, code_verifier: verifier });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.token_type, "Bearer");
    assert.equal((await token({ ...base, code: code2, code_verifier: verifier })).body.error, "invalid_grant");
  });

  test("a refresh token is replaced each time it is used", async () => {
    const c = await connect("uMember", { read: ["mailbox:mA1"] });
    const next = await token({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: c.client.client_id });
    assert.equal(next.status, 200);
    assert.notEqual(next.body.refresh_token, c.refresh_token);
    assert.equal((await token({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: c.client.client_id })).body.error, "invalid_grant");
    assert.ok((await tool(next.body.access_token, "list_mailboxes")).length);
  });

  test("another app can't use a connection's refresh token", async () => {
    const c = await connect("uMember", { read: ["mailbox:mA1"] });
    const { body: other } = await register();
    assert.equal((await token({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: other.client_id })).body.error, "invalid_grant");
  });

  test("signing in again with the same app keeps one connection, and the other device's tokens", async () => {
    const first = await connect("uMember", { read: ["mailbox:mA1"] });
    const { verifier, challenge } = pkce();
    const code = await allow(first.client, "uMember", { read: ["mailbox:mA1"], send: ["mailbox:mA1"] }, challenge);
    const second = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: first.client.client_id });
    assert.equal(second.status, 200);
    const rows = await db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE client_id = ?").bind(first.client.client_id).first();
    assert.equal(rows.n, 1);
    // The new access applies to both; the first device keeps working.
    assert.deepEqual((await tool(first.access_token, "list_mailboxes"))[0].permissions, ["read", "send"]);
    assert.equal((await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: first.client.client_id })).status, 200);
  });

  test("tokens from signing in don't work on the HTTP API", async () => {
    const c = await connect("uMember", { read: ["mailbox:mA1"] });
    const res = await request("/api/v1/mailboxes", { headers: { Authorization: `Bearer ${c.access_token}` } });
    assert.equal(res.status, 401);
  });
});

describe("a member's assistant", () => {
  let c;
  before(async () => {
    // Asks for a mailbox the member can't open too: it is dropped.
    c = await connect("uMember", { read: ["mailbox:mA1", "mailbox:mB1"], send: ["mailbox:mA1"] });
  });

  test("initialize names the server", async () => {
    const res = await rpc(c.access_token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.equal(res.body.result.protocolVersion, "2025-06-18");
    assert.equal(res.body.result.serverInfo.name, "gentlemail");
    assert.ok(res.body.result.capabilities.tools);
  });

  test("notifications get 202 and no body", async () => {
    const res = await request("/mcp", {
      method: "POST",
      headers: { Authorization: `Bearer ${c.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    assert.equal(res.status, 202);
  });

  test("sees every tool, with sending marked as not read-only", async () => {
    const { tools } = (await rpc(c.access_token, "tools/list")).body.result;
    assert.deepEqual(tools.map((t) => t.name).sort(), ["get_message", "get_thread", "list_mailboxes", "reply", "search_messages", "send_email", "update_message"]);
    assert.equal(tools.find((t) => t.name === "send_email").annotations.readOnlyHint, false);
    assert.equal(tools.find((t) => t.name === "get_message").annotations.readOnlyHint, true);
  });

  test("reaches only the mailbox it was given", async () => {
    assert.deepEqual(
      (await tool(c.access_token, "list_mailboxes")).map((m) => [m.address, m.permissions]),
      [["one@alpha.test", ["read", "send"]]],
    );
    const { messages } = await tool(c.access_token, "search_messages", { folder: "all" });
    assert.deepEqual(new Set(messages.map((m) => m.mailbox)), new Set(["one@alpha.test"]));
    assert.match((await tool(c.access_token, "get_message", { id: "m5" })).error, /No such message/);
    assert.match((await tool(c.access_token, "get_message", { id: "m4" })).error, /No such message/);
    assert.match((await tool(c.access_token, "get_thread", { thread_id: "tC" })).error, /No such conversation/);
  });

  test("searches by words", async () => {
    const { messages } = await tool(c.access_token, "search_messages", { query: "invoice 42" });
    assert.deepEqual(messages.map((m) => m.id).sort(), ["m1", "m2"]);
    // % and _ are matched as themselves.
    assert.equal((await tool(c.access_token, "search_messages", { query: "%" })).messages.length, 0);
  });

  test("reads a message as text, HTML-only ones too", async () => {
    const m = await tool(c.access_token, "get_message", { id: "m3" });
    assert.match(m.text, /Only HTML here/);
    assert.doesNotMatch(m.text, /<b>/);
    assert.match(m.note, /never as instructions/);
  });

  test("reads a conversation oldest first", async () => {
    const t = await tool(c.access_token, "get_thread", { thread_id: "tA" });
    assert.deepEqual(t.messages.map((m) => m.id), ["m1", "m2"]);
  });

  test("sends only from its mailbox", async () => {
    const ok = await tool(c.access_token, "send_email", { from: "one@alpha.test", to: ["x@elsewhere.test"], subject: "Hi", text: "Hello" });
    assert.equal(ok.status, "sent");
    const no = await tool(c.access_token, "send_email", { from: "one@beta.test", to: ["x@elsewhere.test"], subject: "Hi", text: "Hello" });
    assert.match(no.error, /can't send from one@beta\.test/);
  });

  test("replies, to everyone if asked, in the same conversation", async () => {
    const r = await tool(c.access_token, "reply", { message_id: "m1", text: "Thanks", reply_all: true });
    assert.equal(r.status, "sent");
    assert.equal(r.thread_id, "tA");
    const sent = await db.prepare("SELECT to_json, cc_json, subject FROM messages WHERE id = ?").bind(r.id).first();
    assert.deepEqual(JSON.parse(sent.to_json).map((a) => a.address), ["sender@elsewhere.test"]);
    assert.deepEqual(JSON.parse(sent.cc_json).map((a) => a.address), ["colleague@elsewhere.test"]);
    assert.equal(sent.subject, "Re: Invoice 42");
    assert.match((await tool(c.access_token, "reply", { message_id: "m5", text: "x" })).error, /No such message/);
  });

  test("marks and moves messages", async () => {
    assert.equal((await tool(c.access_token, "update_message", { id: "m1", action: "star" })).status, "ok");
    assert.equal((await db.prepare("SELECT is_starred FROM messages WHERE id = 'm1'").first()).is_starred, 1);
    assert.match((await tool(c.access_token, "update_message", { id: "m1", action: "explode" })).error, /action must be one of/);
    assert.match((await tool(c.access_token, "update_message", { id: "m5", action: "star" })).error, /No such message/);
  });

  test("an unknown tool is a JSON-RPC error", async () => {
    const res = await rpc(c.access_token, "tools/call", { name: "delete_everything", arguments: {} });
    assert.equal(res.body.error.code, -32602);
  });

  test("reads its part of a conversation, however many newer messages it can't see", async () => {
    const t = await tool(c.access_token, "get_thread", { thread_id: "tX" });
    assert.deepEqual(t.messages.map((m) => m.id), ["mx"]);
  });

  test("loses a mailbox as soon as the person does, and gets it back with them", async () => {
    await db.prepare("DELETE FROM mailbox_members WHERE user_id = 'uMember' AND mailbox_id = 'mA1'").run();
    try {
      assert.deepEqual(await tool(c.access_token, "list_mailboxes"), []);
      assert.match((await tool(c.access_token, "get_message", { id: "m1" })).error, /No such message/);
      assert.deepEqual((await tool(c.access_token, "search_messages", { folder: "all" })).messages, []);
      assert.match((await tool(c.access_token, "get_thread", { thread_id: "tA" })).error, /No such conversation/);
      assert.match((await tool(c.access_token, "send_email", { from: "one@alpha.test", to: ["x@elsewhere.test"], subject: "s", text: "t" })).error, /can't send/);
    } finally {
      await db.prepare("INSERT INTO mailbox_members (mailbox_id, user_id) VALUES ('mA1', 'uMember')").run();
    }
    assert.deepEqual((await tool(c.access_token, "list_mailboxes")).map((m) => m.address), ["one@alpha.test"]);
  });

  test("an admin who becomes a member keeps only their mailboxes", async () => {
    await db.batch([
      db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('uDemoted', 'demoted@alpha.test', 'd', 'x', 'admin', 0)"),
      db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('${sha256("session-demoted")}', 'uDemoted', ${Date.now() + 3600e3}, 0)`),
      db.prepare("INSERT INTO mailbox_members (mailbox_id, user_id) VALUES ('mA2', 'uDemoted')"),
    ]);
    USERS.push({ id: "uDemoted", session: "session-demoted" });
    const d = await connect("uDemoted", { read: ["all"] });
    assert.equal((await tool(d.access_token, "list_mailboxes")).length, 3);
    await db.prepare("UPDATE users SET role = 'member' WHERE id = 'uDemoted'").run();
    assert.deepEqual((await tool(d.access_token, "list_mailboxes")).map((m) => m.address), ["two@alpha.test"]);
  });
});

describe("disconnecting", () => {
  test("revoking a token ends the connection", async () => {
    const c = await connect("uMember", { read: ["mailbox:mA1"] });
    const res = await request("/oauth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ token: c.refresh_token, client_id: c.client.client_id }),
    });
    assert.equal(res.status, 200);
    assert.equal((await rpc(c.access_token, "tools/list")).status, 401);
    assert.equal((await token({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: c.client.client_id })).body.error, "invalid_grant");
  });

  test("a disconnected app can sign in again with its registration, after the hourly clean-up", async () => {
    const c = await connect("uMember", { read: ["mailbox:mA1"] });
    await db.prepare("DELETE FROM api_keys WHERE client_id = ?").bind(c.client.client_id).run(); // Disconnect
    await db.prepare("UPDATE oauth_clients SET created_at = 0 WHERE id = ?").bind(c.client.client_id).run();
    const { body: unused } = await register();
    await db.prepare("UPDATE oauth_clients SET created_at = 0 WHERE id = ?").bind(unused.client_id).run();
    await (await mf.getWorker()).scheduled({ scheduledTime: new Date(Date.UTC(2026, 0, 1, 12, 0)), cron: "0 * * * *" });
    assert.equal(await db.prepare("SELECT id FROM oauth_clients WHERE id = ?").bind(unused.client_id).first(), null);
    const { verifier, challenge } = pkce();
    const code = await allow(c.client, "uMember", { read: ["mailbox:mA1"] }, challenge);
    assert.equal((await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: c.client.client_id })).status, 200);
  });

  test("deleting the person ends their connections", async () => {
    await db.batch([
      db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('uGone', 'gone@alpha.test', 'g', 'x', 'member', 0)"),
      db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('${sha256("session-gone")}', 'uGone', ${Date.now() + 3600e3}, 0)`),
      db.prepare("INSERT INTO mailbox_members (mailbox_id, user_id) VALUES ('mA1', 'uGone')"),
    ]);
    USERS.push({ id: "uGone", session: "session-gone" });
    const c = await connect("uGone", { read: ["mailbox:mA1"] });
    assert.equal((await rpc(c.access_token, "tools/list")).status, 200);
    await db.prepare("DELETE FROM users WHERE id = 'uGone'").run();
    assert.equal((await rpc(c.access_token, "tools/list")).status, 401);
  });
});

describe("an admin's assistant", () => {
  test("given all mailboxes, reads them all", async () => {
    const c = await connect("uAdmin", { read: ["all"] });
    assert.deepEqual((await tool(c.access_token, "list_mailboxes")).map((m) => m.address), ["one@alpha.test", "one@beta.test", "two@alpha.test"]);
    assert.deepEqual(await toolNames(c.access_token), ["get_message", "get_thread", "list_mailboxes", "search_messages", "update_message"]);
  });
});

describe("API keys on /mcp", () => {
  test("work too, with the key's own access", async () => {
    assert.deepEqual(await toolNames(API_KEY), ["get_message", "get_thread", "list_mailboxes", "search_messages", "update_message"]);
    assert.deepEqual((await tool(API_KEY, "list_mailboxes")).map((m) => m.address), ["two@alpha.test"]);
    assert.match((await tool(API_KEY, "send_email", { from: "two@alpha.test", to: ["x@elsewhere.test"], subject: "s", text: "t" })).error, /can't send/);
  });

});

describe("assistants in a browser", () => {
  const crossSite = { "Sec-Fetch-Site": "cross-site", Origin: "https://inspector.test" };

  test("get an answer to the preflight", async () => {
    for (const path of ["/mcp", "/oauth/register", "/oauth/token", "/oauth/revoke"]) {
      const res = await request(path, { method: "OPTIONS", headers: { ...crossSite, "Access-Control-Request-Method": "POST" } });
      assert.equal(res.status, 204, path);
      assert.equal(res.headers.get("access-control-allow-origin"), "*");
      assert.match(res.headers.get("access-control-allow-headers"), /Authorization/);
    }
  });

  test("can register, trade a code and call /mcp from another site", async () => {
    const reg = await request("/oauth/register", {
      method: "POST",
      headers: { ...crossSite, "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Inspector", redirect_uris: ["http://127.0.0.1:5555/callback"] }),
    });
    assert.equal(reg.status, 201);
    const client = await reg.json();
    const { verifier, challenge } = pkce();
    const code = await allow(client, "uMember", { read: ["mailbox:mA1"] }, challenge);
    const res = await request("/oauth/token", {
      method: "POST",
      headers: { ...crossSite, "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const { access_token } = await res.json();
    const mcp = await request("/mcp", {
      method: "POST",
      headers: { ...crossSite, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(mcp.status, 200);
    assert.equal(mcp.headers.get("access-control-allow-origin"), "*");
    const unauth = await request("/mcp", { method: "POST", headers: { ...crossSite, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(unauth.status, 401);
    assert.match(unauth.headers.get("access-control-expose-headers"), /WWW-Authenticate/);
  });

  test("still can't post the consent form from another site", async () => {
    const res = await request("/oauth/authorize", {
      method: "POST",
      headers: { ...crossSite, Cookie: cookie("uMember"), "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ decision: "allow" }),
    });
    assert.equal(res.status, 403);
  });
});

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
  rows.push(`INSERT INTO api_key_grants (key_id, target_type, target_id, can_read, can_organize, can_send) VALUES ('kRead', 'mailbox', 'mA2', 1, 0, 0);`);
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

// Each registration from its own address, as registrations are limited per address.
let ipCount = 0;
async function register(redirect_uris = ["http://127.0.0.1:5555/callback"], extra = {}, ip = `198.51.100.${++ipCount % 250}`) {
  const res = await request("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
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

/** Signs in as `user`, allows `grants` ({ read: [...targets], organize: [...], send: [...] }) and returns the code. */
async function allow(client, user, grants, challenge) {
  const params = authorizeParams(client, challenge);
  const res = await request("/oauth/authorize", {
    method: "POST",
    headers: { Cookie: cookie(user), "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ ...Object.fromEntries(params), decision: "allow", read: grants.read ?? [], organize: grants.organize ?? [], send: grants.send ?? [] }),
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

/** Calls a tool tools/list doesn't show: a JSON-RPC error, and its message. */
async function hiddenTool(bearer, name, args = {}) {
  const res = await rpc(bearer, "tools/call", { name, arguments: args });
  assert.equal(res.body.error?.code, -32602, JSON.stringify(res.body));
  return res.body.error.message;
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
    const base = { grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id, redirect_uri: "http://127.0.0.1:6666/callback" };
    assert.equal((await token({ ...base, client_secret: "wrong" })).status, 401);
    assert.equal((await token({ ...base, client_secret: client.client_secret })).status, 200);
  });
});

describe("registration limits", () => {
  test("one address may register 10 apps a minute", async () => {
    for (let i = 0; i < 10; i++) assert.equal((await register(undefined, {}, "203.0.113.9")).status, 201);
    const res = await register(undefined, {}, "203.0.113.9");
    assert.equal(res.status, 429);
    assert.equal(res.body.error, "slow_down");
    assert.equal((await register(undefined, {}, "203.0.113.10")).status, 201);
  });

  test("past 5,000 apps that never signed in, the hourly clean-up drops the oldest, never the last 15 minutes", async () => {
    // An app registered 10 minutes ago, then 5,010 newer ones: it is past the cap but still kept. One an hour old goes.
    const t = Date.now();
    const { body: signingIn } = await register();
    const { body: stale } = await register();
    await db.batch([
      db.prepare("UPDATE oauth_clients SET created_at = ? WHERE id = ?").bind(t - 10 * 60e3, signingIn.client_id),
      db.prepare("UPDATE oauth_clients SET created_at = ? WHERE id = ?").bind(t - 3600e3, stale.client_id),
      db
        .prepare(
          `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5010)
           INSERT INTO oauth_clients (id, name, redirect_uris, created_at) SELECT 'bulk' || i, 'bulk', '[]', ? + i FROM n`,
        )
        .bind(t - 5 * 60e3),
    ]);
    await (await mf.getWorker()).scheduled({ scheduledTime: new Date(Date.UTC(2026, 0, 1, 12, 0)), cron: "0 * * * *" });
    assert.ok(await db.prepare("SELECT id FROM oauth_clients WHERE id = ?").bind(signingIn.client_id).first());
    assert.equal(await db.prepare("SELECT id FROM oauth_clients WHERE id = ?").bind(stale.client_id).first(), null);
    await db.prepare("DELETE FROM oauth_clients WHERE id LIKE 'bulk%'").run();
  });

  test("app names lose invisible characters that could make them show as another", async () => {
    const { body } = await register(undefined, { client_name: "\u202Eedualc\u200B Bot\u0007" });
    assert.equal(body.client_name, "edualc Bot");
  });

  test("an app name that would show blank gets a stand-in, and a long one isn't cut inside a character", async () => {
    assert.equal((await register(undefined, { client_name: "\u3164\u3164 \u2800" })).body.client_name, "An unnamed app");
    const long = (await register(undefined, { client_name: "a".repeat(79) + "😀😀" })).body.client_name;
    assert.equal(Array.from(long).length, 80);
    assert.ok(long.endsWith("😀"));
  });

  test("redirect URIs are kept short", async () => {
    assert.equal((await register([`https://app.test/${"x".repeat(500)}`])).status, 400);
    assert.equal((await register(Array.from({ length: 6 }, (_, i) => `https://app.test/${i}`))).status, 400);
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

  test("after two-step setup, goes back only to a page on this site, and says so only when it's on", async () => {
    const security = async (next) => (await request(`/account/security?next=${encodeURIComponent(next)}`, { headers: { Cookie: cookie("uMember") } })).text();
    assert.doesNotMatch(await security("/oauth/authorize?x=1"), /Continue where you were/);
    await db.prepare("UPDATE users SET mfa_enabled_at = 1 WHERE id = 'uMember'").run();
    try {
      assert.match(await security("/oauth/authorize?x=1"), /href="\/oauth\/authorize\?x=1"[^>]*>Continue where you were/);
      for (const next of ["/\t/evil.test", "/\n/evil.test", "//evil.test", "/\\evil.test", "/ /evil.test", "https://evil.test", "/.//evil.test", "/%2e//evil.test", "/a/..//evil.test"])
        assert.doesNotMatch(await security(next), /Continue where you were/, JSON.stringify(next));
    } finally {
      await db.prepare("UPDATE users SET mfa_enabled_at = NULL WHERE id = 'uMember'").run();
    }
  });

  test("required two-step not set up: no new tokens, so the app signs in again", async () => {
    const c = await connect("uMember", { read: ["mailbox:mA1"] });
    await db.prepare("INSERT INTO settings (key, value) VALUES ('require_mfa', '1')").run();
    try {
      assert.equal((await rpc(c.access_token, "tools/list")).status, 403);
      assert.equal((await token({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: c.client.client_id })).body.error, "invalid_grant");
    } finally {
      await db.prepare("DELETE FROM settings WHERE key = 'require_mfa'").run();
    }
    assert.equal((await token({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: c.client.client_id })).status, 200);
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

  test("a broken request is shown here, never redirected to the app without a click", async () => {
    const { body: client } = await register(["https://evil.test/phish"]);
    for (const extra of [{ response_type: "token" }, { code_challenge: "" }, { resource: "https://elsewhere.test/mcp" }]) {
      const params = authorizeParams(client, pkce().challenge, { redirect_uri: "https://evil.test/phish", ...extra });
      const res = await request(`/oauth/authorize?${params}`, { headers: { Cookie: cookie("uMember") } });
      assert.equal(res.status, 200, JSON.stringify(extra));
      assert.equal(res.headers.get("location"), null);
      assert.match(await res.text(), /sign-in request is broken/);
    }
  });

  test("an app on this computer is sent the error, so it stops waiting", async () => {
    const { body: client } = await register();
    const res = await request(`/oauth/authorize?${authorizeParams(client, pkce().challenge, { response_type: "token" })}`, { headers: { Cookie: cookie("uMember") } });
    assert.equal(res.status, 303);
    const to = new URL(res.headers.get("location"));
    assert.equal(to.origin, "http://127.0.0.1:6666");
    assert.equal(to.searchParams.get("error"), "unsupported_response_type");
    assert.equal(to.searchParams.get("state"), "st4te");
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
    const location = res.headers.get("location");
    assert.match(location, /^\/oauth\/authorize\?.*err=nothing_ticked/);
    const html = await (await request(location, { headers: { Cookie: cookie("uMember") } })).text();
    assert.match(html, /Tick Read, Organize or Send on at least one line/);
  });

  test("shows only its own error messages, never text from the link", async () => {
    const { body: client } = await register();
    const params = authorizeParams(client, pkce().challenge, { err: "GentleMail has verified this app." });
    const res = await request(`/oauth/authorize?${params}`, { headers: { Cookie: cookie("uMember") } });
    assert.equal(res.status, 200);
    assert.doesNotMatch(await res.text(), /verified this app/);
  });

  test("an app's own scheme is shown whole, never as a site's address", async () => {
    const { body: client } = await register(["claude.ai:cb"], { client_name: "Claude" });
    const params = authorizeParams(client, pkce().challenge, { redirect_uri: "claude.ai:cb" });
    const html = await (await request(`/oauth/authorize?${params}`, { headers: { Cookie: cookie("uMember") } })).text();
    assert.match(html, />claude\.ai:cb</);
    assert.doesNotMatch(html, /claude\.ai:\/\//);
    assert.match(html, /Not a website/);
    assert.doesNotMatch(html, /for Claude it is/);
  });
});

describe("tokens", () => {
  test("a code works once, with the right verifier", async () => {
    const { body: client } = await register();
    const { verifier, challenge } = pkce();
    const code = await allow(client, "uMember", { read: ["mailbox:mA1"] }, challenge);
    const base = { grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: "http://127.0.0.1:6666/callback" };
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
    assert.ok((await tool(next.body.access_token, "list_mailboxes")).length);
    // Past the grace period for retries, the old one is refused (and, being a copy, signs the device out: below).
    await db.prepare("UPDATE oauth_tokens SET used_at = used_at - 60000 WHERE used_at IS NOT NULL").run();
    assert.equal((await token({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: c.client.client_id })).body.error, "invalid_grant");
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
    const second = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: first.client.client_id, redirect_uri: "http://127.0.0.1:6666/callback" });
    assert.equal(second.status, 200);
    const rows = await db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE client_id = ?").bind(first.client.client_id).first();
    assert.equal(rows.n, 1);
    // The new access applies to both; the first device keeps working.
    assert.deepEqual((await tool(first.access_token, "list_mailboxes"))[0].permissions, ["read", "send"]);
    assert.equal((await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: first.client.client_id })).status, 200);
  });

  test("the token request repeats the redirect_uri sent to sign in, and only then", async () => {
    const { body: client } = await register();
    const { verifier, challenge } = pkce();
    const code = await allow(client, "uMember", { read: ["mailbox:mA1"] }, challenge);
    const base = { grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id };
    assert.equal((await token(base)).body.error, "invalid_grant");
    // One registered redirect URI: the app may leave it out of both.
    const { body: single } = await register(["https://app.test/cb"]);
    const p = pkce();
    const params = authorizeParams(single, p.challenge);
    params.delete("redirect_uri");
    const res = await request("/oauth/authorize", {
      method: "POST",
      headers: { Cookie: cookie("uMember"), "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ ...Object.fromEntries(params), decision: "allow", read: "mailbox:mA1" }),
    });
    const code2 = new URL(res.headers.get("location")).searchParams.get("code");
    assert.equal((await token({ grant_type: "authorization_code", code: code2, code_verifier: p.verifier, client_id: single.client_id })).status, 200);
    // Left out of the sign-in, sent with the token request (as many libraries do): fine if it's the registered one.
    const signIn = async () => {
      const p = pkce();
      const res = await request("/oauth/authorize", {
        method: "POST",
        headers: { Cookie: cookie("uMember"), "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ ...Object.fromEntries(params), code_challenge: p.challenge, decision: "allow", read: "mailbox:mA1" }),
      });
      return { code: new URL(res.headers.get("location")).searchParams.get("code"), verifier: p.verifier };
    };
    const a = await signIn();
    assert.equal((await token({ grant_type: "authorization_code", code: a.code, code_verifier: a.verifier, client_id: single.client_id, redirect_uri: "https://app.test/cb" })).status, 200);
    const b = await signIn();
    assert.equal((await token({ grant_type: "authorization_code", code: b.code, code_verifier: b.verifier, client_id: single.client_id, redirect_uri: "https://other.test/cb" })).body.error, "invalid_grant");
  });

  test("a used refresh token coming back signs that device out", async () => {
    const c = await connect("uMember", { read: ["mailbox:mA1"] });
    const refresh = (t) => token({ grant_type: "refresh_token", refresh_token: t, client_id: c.client.client_id });
    const next = await refresh(c.refresh_token);
    assert.equal(next.status, 200);
    // Right away, it's a retry whose first answer was lost: it gets that same answer again.
    const retry = await refresh(c.refresh_token);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.access_token, next.body.access_token);
    assert.equal(retry.body.refresh_token, next.body.refresh_token);
    assert.equal((await rpc(next.body.access_token, "tools/list")).status, 200);
    // Past the 30 seconds, it's a copy: the device is signed out.
    await db.prepare("UPDATE oauth_tokens SET used_at = used_at - 31000 WHERE id = ?").bind(sha256(c.refresh_token)).run();
    assert.equal((await refresh(c.refresh_token)).body.error, "invalid_grant");
    assert.equal((await rpc(next.body.access_token, "tools/list")).status, 401);
    assert.equal((await refresh(next.body.refresh_token)).body.error, "invalid_grant");
  });

  test("an old refresh token coming back after the device went on is a copy, even within 30 seconds", async () => {
    const c = await connect("uMember", { read: ["mailbox:mA1"] });
    const refresh = (t) => token({ grant_type: "refresh_token", refresh_token: t, client_id: c.client.client_id });
    const first = await refresh(c.refresh_token);
    const second = await refresh(first.body.refresh_token);
    assert.equal(second.status, 200);
    assert.equal((await refresh(c.refresh_token)).body.error, "invalid_grant");
    assert.equal((await rpc(second.body.access_token, "tools/list")).status, 401);
    assert.equal((await refresh(second.body.refresh_token)).body.error, "invalid_grant");
  });

  test("two refreshes at the same moment get the same answer, and the device stays one chain", async () => {
    const c = await connect("uMember", { read: ["mailbox:mA1"] });
    const refresh = (t) => token({ grant_type: "refresh_token", refresh_token: t, client_id: c.client.client_id });
    const [a, b] = await Promise.all([refresh(c.refresh_token), refresh(c.refresh_token)]);
    assert.deepEqual([a.status, b.status], [200, 200]);
    assert.equal(a.body.access_token, b.body.access_token);
    assert.equal(a.body.refresh_token, b.body.refresh_token);
    const key = await db.prepare("SELECT id FROM api_keys WHERE client_id = ?").bind(c.client.client_id).first();
    const live = await db.prepare("SELECT COUNT(*) AS n FROM oauth_tokens WHERE key_id = ? AND kind = 'refresh' AND used_at IS NULL").bind(key.id).first();
    assert.equal(live.n, 1);
    // Both tabs going on with it, a minute apart, is fine: the second is a retry.
    const later = await refresh(a.body.refresh_token);
    assert.equal(later.status, 200);
    assert.equal((await refresh(b.body.refresh_token)).body.access_token, later.body.access_token);
  });

  test("the answer kept for a retry is encrypted, and dropped once the 30 seconds are over", async () => {
    const c = await connect("uMember", { read: ["mailbox:mA1"] });
    const next = await token({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: c.client.client_id });
    const row = await db.prepare("SELECT answer FROM oauth_tokens WHERE id = ?").bind(sha256(c.refresh_token)).first();
    assert.ok(row.answer);
    assert.ok(!row.answer.includes(next.body.access_token.slice(5, 20)));
    await db.prepare("UPDATE oauth_tokens SET used_at = used_at - 31000 WHERE id = ?").bind(sha256(c.refresh_token)).run();
    await (await mf.getWorker()).scheduled({ scheduledTime: new Date(Date.UTC(2026, 0, 1, 12, 0)), cron: "0 * * * *" });
    assert.equal((await db.prepare("SELECT answer FROM oauth_tokens WHERE id = ?").bind(sha256(c.refresh_token)).first()).answer, null);
  });

  test("signing in again still works if the connection went away meanwhile", async () => {
    const c = await connect("uMember", { read: ["mailbox:mA1"] });
    const { verifier, challenge } = pkce();
    const code = await allow(c.client, "uMember", { read: ["mailbox:mA1"] }, challenge);
    // The other device signs out (or the hourly clean-up runs) just before the code is traded in.
    await db.prepare("DELETE FROM api_keys WHERE client_id = ?").bind(c.client.client_id).run();
    const res = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: c.client.client_id, redirect_uri: "http://127.0.0.1:6666/callback" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await rpc(res.body.access_token, "tools/list")).status, 200);
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
    c = await connect("uMember", { read: ["mailbox:mA1", "mailbox:mB1"], organize: ["mailbox:mA1"], send: ["mailbox:mA1"] });
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
      [["one@alpha.test", ["read", "organize", "send"]]],
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
    // Cc counts as a recipient.
    await db.prepare("UPDATE messages SET cc_json = ? WHERE id = 'm3'").bind(JSON.stringify([{ name: "", address: "copied@elsewhere.test" }])).run();
    assert.deepEqual((await tool(c.access_token, "search_messages", { query: "copied@elsewhere" })).messages.map((m) => m.id), ["m3"]);
  });

  test("a search leaves out spam and trash unless asked", async () => {
    await db.prepare("UPDATE messages SET folder = 'trash' WHERE id = 'm2'").run();
    try {
      assert.deepEqual((await tool(c.access_token, "search_messages", { query: "invoice 42" })).messages.map((m) => m.id), ["m1"]);
      assert.deepEqual((await tool(c.access_token, "search_messages", { query: "invoice 42", folder: "all" })).messages.map((m) => m.id).sort(), ["m1", "m2"]);
      assert.deepEqual((await tool(c.access_token, "search_messages", { query: "invoice 42", folder: "trash" })).messages.map((m) => m.id), ["m2"]);
    } finally {
      await db.prepare("UPDATE messages SET folder = 'inbox' WHERE id = 'm2'").run();
    }
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
    // The same fields as get_message.
    for (const k of ["to", "unread", "starred", "attachments", "text"]) assert.ok(k in t.messages[0], k);
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

  test("a reply to a message sent from here goes to its recipients, as in the webmail", async () => {
    const out = await tool(c.access_token, "send_email", { from: "one@alpha.test", to: ["client@elsewhere.test"], cc: ["boss@elsewhere.test"], subject: "Quote", text: "Here it is" });
    const r = await tool(c.access_token, "reply", { message_id: out.id, text: "Any news?", reply_all: true });
    const sent = await db.prepare("SELECT to_json, cc_json FROM messages WHERE id = ?").bind(r.id).first();
    assert.deepEqual(JSON.parse(sent.to_json).map((a) => a.address), ["client@elsewhere.test"]);
    assert.deepEqual(JSON.parse(sent.cc_json).map((a) => a.address), ["boss@elsewhere.test"]);
  });

  test("batches are capped and answered in order", async () => {
    const call = (id) => ({ jsonrpc: "2.0", id, method: "tools/list" });
    const post = (body) =>
      request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${c.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const ok = await post([call(1), call(2)]);
    assert.deepEqual((await ok.json()).map((r) => r.id), [1, 2]);
    assert.equal((await post(Array.from({ length: 11 }, (_, i) => call(i)))).status, 400);
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

  test("a long conversation keeps its first message and says what it left out", async () => {
    const t0 = Date.now() - 10_000_000;
    const insert = db.prepare(
      `INSERT INTO messages (id, mailbox_id, thread_id, folder, direction, from_addr, from_name, to_json, subject, snippet, text_body, is_read, date, created_at)
       VALUES (?, 'mA1', 'tL', 'inbox', 'in', 'sender@elsewhere.test', 'Sender', '[]', 'Long', 'hi', ?, 0, ?, ?)`,
    );
    await db.batch(Array.from({ length: 40 }, (_, i) => insert.bind(`ml${String(i).padStart(2, "0")}`, i ? `Reply ${i}` : "The original request", t0 + i * 1000, t0)));
    const t = await tool(c.access_token, "get_thread", { thread_id: "tL" });
    assert.equal(t.left_out, 15);
    const ids = t.messages.filter((m) => m.id).map((m) => m.id);
    assert.equal(ids.length, 25);
    assert.equal(ids[0], "ml00");
    assert.equal(ids[1], "ml16");
    assert.equal(ids.at(-1), "ml39");
    assert.match(t.messages[0].text, /original request/);
    assert.match(t.messages[1].left_out, /15 messages/);
    assert.match(t.note, /15 messages in the middle/);
    // A short one says nothing about it.
    assert.equal((await tool(c.access_token, "get_thread", { thread_id: "tA" })).left_out, undefined);
  });

  test("reads its part of a conversation, however many newer messages it can't see", async () => {
    const t = await tool(c.access_token, "get_thread", { thread_id: "tX" });
    assert.deepEqual(t.messages.map((m) => m.id), ["mx"]);
  });

  test("loses a mailbox as soon as the person does, and gets it back with them", async () => {
    const r = await connect("uMember", { read: ["mailbox:mA1"] }); // to refresh, leaving c's tokens alone
    await db.prepare("DELETE FROM mailbox_members WHERE user_id = 'uMember' AND mailbox_id = 'mA1'").run();
    try {
      // Nothing left it may use: told to sign in again, as with an unknown token.
      const res = await rpc(c.access_token, "tools/list");
      assert.equal(res.status, 401);
      assert.match(res.headers.get("www-authenticate"), /resource_metadata=/);
      // A refused call isn't a use.
      const used = await db.prepare("SELECT last_used_at FROM api_keys WHERE client_id = ?").bind(c.client.client_id).first();
      await rpc(c.access_token, "tools/list");
      assert.deepEqual(await db.prepare("SELECT last_used_at FROM api_keys WHERE client_id = ?").bind(c.client.client_id).first(), used);
      // Refreshing fails too, so the app signs in again instead of retrying in a loop.
      assert.equal((await token({ grant_type: "refresh_token", refresh_token: r.refresh_token, client_id: r.client.client_id })).body.error, "invalid_grant");
    } finally {
      await db.prepare("INSERT INTO mailbox_members (mailbox_id, user_id) VALUES ('mA1', 'uMember')").run();
    }
    assert.deepEqual((await tool(c.access_token, "list_mailboxes")).map((m) => m.address), ["one@alpha.test"]);
    // Its refresh token wasn't used up by the refused try.
    assert.equal((await token({ grant_type: "refresh_token", refresh_token: r.refresh_token, client_id: r.client.client_id })).status, 200);
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

/** Calls a server action as the webmail does, signed in as `user`. */
async function action(file, name, user, args) {
  const res = await request(`/account/security?__rsc&__rsc_action_id=${encodeURIComponent(`/src/app/actions/${file}#${name}`)}`, {
    method: "POST",
    headers: { Cookie: cookie(user), Origin: BASE, "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(args),
  });
  assert.equal(res.status, 200, await res.clone().text());
  return res.text();
}

describe("disconnecting", () => {
  test("Disconnect also cancels a sign-in the app hasn't finished", async () => {
    const c = await connect("uMember", { read: ["mailbox:mA1"] });
    const key = await db.prepare("SELECT id FROM api_keys WHERE client_id = ?").bind(c.client.client_id).first();
    // The app starts signing in again, and holds its code.
    const { verifier, challenge } = pkce();
    const code = await allow(c.client, "uMember", { read: ["mailbox:mA1"] }, challenge);
    await action("connections.ts", "disconnectAssistantAction", "uMember", [key.id]);
    assert.equal(await db.prepare("SELECT id FROM api_keys WHERE id = ?").bind(key.id).first(), null);
    // The code is gone with the connection: the app can't come back with it.
    const res = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: c.client.client_id, redirect_uri: "http://127.0.0.1:6666/callback" });
    assert.equal(res.body.error, "invalid_grant");
    assert.equal(await db.prepare("SELECT id FROM api_keys WHERE client_id = ?").bind(c.client.client_id).first(), null);
    assert.equal((await rpc(c.access_token, "tools/list")).status, 401);
  });

  test("someone else's Disconnect does nothing", async () => {
    const c = await connect("uAdmin", { read: ["all"] });
    const key = await db.prepare("SELECT id FROM api_keys WHERE client_id = ?").bind(c.client.client_id).first();
    await action("connections.ts", "disconnectAssistantAction", "uMember", [key.id]);
    assert.equal((await rpc(c.access_token, "tools/list")).status, 200);
  });

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

  test("signing out on one device leaves the others connected", async () => {
    const laptop = await connect("uMember", { read: ["mailbox:mA1"] });
    const { verifier, challenge } = pkce();
    const code = await allow(laptop.client, "uMember", { read: ["mailbox:mA1"] }, challenge);
    const phone = (await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: laptop.client.client_id, redirect_uri: "http://127.0.0.1:6666/callback" })).body;
    const revoke = (t) =>
      request("/oauth/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ token: t, client_id: laptop.client.client_id }) });
    await revoke(laptop.refresh_token);
    assert.equal((await rpc(laptop.access_token, "tools/list")).status, 401);
    assert.equal((await rpc(phone.access_token, "tools/list")).status, 200);
    // The last device out ends the connection.
    await revoke(phone.access_token);
    assert.equal(await db.prepare("SELECT id FROM api_keys WHERE client_id = ?").bind(laptop.client.client_id).first(), null);
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
    assert.equal((await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: c.client.client_id, redirect_uri: "http://127.0.0.1:6666/callback" })).status, 200);
  });

  test("used refresh tokens are forgotten after a week", async () => {
    const c = await connect("uMember", { read: ["mailbox:mA1"] });
    const next = await token({ grant_type: "refresh_token", refresh_token: c.refresh_token, client_id: c.client.client_id });
    const id = sha256(c.refresh_token);
    await db.prepare("UPDATE oauth_tokens SET used_at = ? WHERE id = ?").bind(Date.now() - 8 * 24 * 3600e3, id).run();
    await (await mf.getWorker()).scheduled({ scheduledTime: new Date(Date.UTC(2026, 0, 1, 12, 0)), cron: "0 * * * *" });
    assert.equal(await db.prepare("SELECT id FROM oauth_tokens WHERE id = ?").bind(id).first(), null);
    assert.equal((await rpc(next.body.access_token, "tools/list")).status, 200);
  });

  test("a connection whose devices all went quiet is removed by the hourly clean-up", async () => {
    const quiet = await connect("uMember", { read: ["mailbox:mA1"] });
    const live = await connect("uMember", { read: ["mailbox:mA1"] });
    const old = Date.now() - 61 * 24 * 3600e3;
    await db.batch([
      db.prepare("UPDATE oauth_tokens SET expires_at = 1 WHERE key_id IN (SELECT id FROM api_keys WHERE client_id = ?)").bind(quiet.client.client_id),
      db.prepare("UPDATE api_keys SET created_at = ?, last_used_at = ? WHERE client_id IN (?, ?)").bind(old, old, quiet.client.client_id, live.client.client_id),
    ]);
    await (await mf.getWorker()).scheduled({ scheduledTime: new Date(Date.UTC(2026, 0, 1, 12, 0)), cron: "0 * * * *" });
    assert.equal(await db.prepare("SELECT id FROM api_keys WHERE client_id = ?").bind(quiet.client.client_id).first(), null);
    assert.ok(await db.prepare("SELECT id FROM api_keys WHERE client_id = ?").bind(live.client.client_id).first());
    assert.equal((await rpc(live.access_token, "tools/list")).status, 200);
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
  test("left with no access, is asked to sign in again (401), as anyone's is", async () => {
    const c = await connect("uAdmin", { read: ["mailbox:mB1"] });
    const key = await db.prepare("SELECT id FROM api_keys WHERE client_id = ?").bind(c.client.client_id).first();
    await db.prepare("DELETE FROM api_key_grants WHERE key_id = ?").bind(key.id).run();
    const res = await rpc(c.access_token, "tools/list");
    assert.equal(res.status, 401);
    assert.match(res.headers.get("www-authenticate"), /invalid_token/);
  });

  test("given all mailboxes, reads them all", async () => {
    const c = await connect("uAdmin", { read: ["all"] });
    assert.deepEqual((await tool(c.access_token, "list_mailboxes")).map((m) => m.address), ["one@alpha.test", "one@beta.test", "two@alpha.test"]);
    assert.deepEqual(await toolNames(c.access_token), ["get_message", "get_thread", "list_mailboxes", "search_messages"]);
  });
});

describe("organize", () => {
  test("a read-only assistant can't mark or move, even calling the tool it isn't shown", async () => {
    const c = await connect("uMember", { read: ["mailbox:mA1"] });
    assert.deepEqual(await toolNames(c.access_token), ["get_message", "get_thread", "list_mailboxes", "search_messages"]);
    for (const action of ["read", "star", "archive", "trash", "spam"])
      assert.deepEqual(await hiddenTool(c.access_token, "update_message", { id: "m3", action }), "This connection can't use update_message: it needs the organize permission.", action);
    const m3 = await db.prepare("SELECT folder, is_read, is_starred FROM messages WHERE id = 'm3'").first();
    assert.deepEqual({ ...m3 }, { folder: "inbox", is_read: 0, is_starred: 0 });
  });

  test("organize alone files messages it can't read", async () => {
    const c = await connect("uMember", { organize: ["mailbox:mA1"] });
    assert.deepEqual(await toolNames(c.access_token), ["list_mailboxes", "update_message"]);
    assert.deepEqual((await tool(c.access_token, "list_mailboxes")).map((m) => m.permissions), [["organize"]]);
    assert.equal(await hiddenTool(c.access_token, "get_message", { id: "m3" }), "This connection can't use get_message: it needs the read permission.");
    assert.equal((await tool(c.access_token, "update_message", { id: "m3", action: "archive" })).status, "ok");
    assert.equal((await db.prepare("SELECT folder FROM messages WHERE id = 'm3'").first()).folder, "archive");
    await db.prepare("UPDATE messages SET folder = 'inbox' WHERE id = 'm3'").run();
    // Organize on mA1 only: another mailbox's message stays out of reach.
    assert.match((await tool(c.access_token, "update_message", { id: "m4", action: "archive" })).error, /No such message/);
  });

  test("a sign-in started before organize existed still completes, without it", async () => {
    const { body: client } = await register();
    const { verifier, challenge } = pkce();
    const code = await allow(client, "uMember", { read: ["mailbox:mA1"] }, challenge);
    // As a sign-in saved by the previous version: grants without can_organize.
    await db
      .prepare("UPDATE oauth_codes SET grants = ? WHERE id = ?")
      .bind(JSON.stringify([{ target_type: "mailbox", target_id: "mA1", can_read: 1, can_send: 0 }]), sha256(code))
      .run();
    const res = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id, redirect_uri: "http://127.0.0.1:6666/callback" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual((await tool(res.body.access_token, "list_mailboxes")).map((m) => m.permissions), [["read"]]);
  });
});

describe("API keys on /mcp", () => {
  test("work too, with the key's own access", async () => {
    assert.deepEqual(await toolNames(API_KEY), ["get_message", "get_thread", "list_mailboxes", "search_messages"]);
    assert.deepEqual((await tool(API_KEY, "list_mailboxes")).map((m) => m.address), ["two@alpha.test"]);
    assert.equal(
      await hiddenTool(API_KEY, "send_email", { from: "two@alpha.test", to: ["x@elsewhere.test"], subject: "s", text: "t" }),
      "This connection can't use send_email: it needs the send permission.",
    );
  });

});

describe("assistants in a browser", () => {
  const crossSite = { "Sec-Fetch-Site": "cross-site", Origin: "https://inspector.test" };

  test("get an answer to the preflight", async () => {
    const paths = ["/mcp", "/oauth/register", "/oauth/token", "/oauth/revoke"];
    const discovery = ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"];
    for (const path of [...paths, ...discovery]) {
      const method = discovery.includes(path) ? "GET" : "POST";
      const res = await request(path, {
        method: "OPTIONS",
        headers: { ...crossSite, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": "mcp-protocol-version" },
      });
      assert.equal(res.status, 204, path);
      assert.equal(res.headers.get("access-control-allow-origin"), "*");
      assert.match(res.headers.get("access-control-allow-headers"), /Authorization/);
      assert.match(res.headers.get("access-control-allow-headers"), /Mcp-Protocol-Version/);
      if (discovery.includes(path)) assert.equal((await request(path, { method: "HEAD" })).status, 200, path);
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
      body: form({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id, redirect_uri: "http://127.0.0.1:6666/callback" }),
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
    // With a trailing slash too: the same endpoint, not a cross-site form post.
    const slash = await request("/mcp/", {
      method: "POST",
      headers: { ...crossSite, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(slash.status, 200);
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

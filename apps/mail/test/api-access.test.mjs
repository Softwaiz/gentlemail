/*
 * API keys reach exactly the mailboxes they are allowed to, on every endpoint.
 *
 * Runs the built Worker in Miniflare (see harness.mjs), seeds domains, mailboxes,
 * messages, attachments and keys, then calls the HTTP API with each key. What each
 * key may do on each mailbox is written out by hand in KEYS below: the test states
 * the rules, it doesn't reuse the app's code to work them out.
 *
 * Run from apps/mail: pnpm test (builds first).
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { q, sha256, startWorker } from "./harness.mjs";

/* ---------- The world ---------- */

const DOMAINS = [
  { id: "dA", name: "alpha.test" },
  { id: "dB", name: "beta.test" },
  // Ends in "alpha.test" but isn't it: a grant on alpha.test must not reach it.
  { id: "dN", name: "notalpha.test" },
];

const MAILBOXES = [
  { id: "mA1", address: "one@alpha.test" },
  // Upper case: domain grants match addresses without regard to case.
  { id: "mA2", address: "Two@ALPHA.test" },
  { id: "mB1", address: "one@beta.test" },
  { id: "mN1", address: "x@notalpha.test" },
  // A subdomain is another domain: a grant on alpha.test doesn't cover it.
  { id: "mS1", address: "y@sub.alpha.test" },
];

const msgOf = (mb) => `msg_${mb}`;
const attOf = (mb) => `att_${mb}`;
const attBytes = (mb) => `attachment of ${mb}`;

const perms = (read, organize, send) => ({ read, organize, send });
const R = perms(true, false, false);
const O = perms(false, true, false);
const S = perms(false, false, true);
const RO = perms(true, true, false);
const RS = perms(true, false, true);
const ROS = perms(true, true, true);

/*
 * Each key: its grants as stored ([target type, target id, read, organize, send]),
 * and what it may do on each mailbox (left out = nothing).
 * `revoked` keys are refused outright.
 */
const KEYS = {
  everything: {
    grants: [["all", "", 1, 1, 1]],
    access: { mA1: ROS, mA2: ROS, mB1: ROS, mN1: ROS, mS1: ROS },
  },
  // Read alone can't mark or move anything.
  readAll: {
    grants: [["all", "", 1, 0, 0]],
    access: { mA1: R, mA2: R, mB1: R, mN1: R, mS1: R },
  },
  alphaRead: {
    grants: [["domain", "dA", 1, 0, 0]],
    access: { mA1: R, mA2: R },
  },
  // Organize without read: files messages it can't read (by id, from a webhook).
  alphaOrganize: {
    grants: [["domain", "dA", 0, 1, 0]],
    access: { mA1: O, mA2: O },
  },
  // Read and organize on one mailbox, read alone on another.
  betaOneReadOrganizeAlphaRead: {
    grants: [
      ["mailbox", "mB1", 1, 1, 0],
      ["domain", "dA", 1, 0, 0],
    ],
    access: { mB1: RO, mA1: R, mA2: R },
  },
  alphaSendBetaOneRead: {
    grants: [
      ["domain", "dA", 0, 0, 1],
      ["mailbox", "mB1", 1, 0, 0],
    ],
    access: { mA1: S, mA2: S, mB1: R },
  },
  betaOneSend: {
    grants: [["mailbox", "mB1", 0, 0, 1]],
    access: { mB1: S },
  },
  // Grants add up: read on the domain plus send on one of its mailboxes.
  alphaReadOneSend: {
    grants: [
      ["domain", "dA", 1, 0, 0],
      ["mailbox", "mA1", 0, 0, 1],
    ],
    access: { mA1: RS, mA2: R },
  },
  subdomainMailbox: {
    grants: [["mailbox", "mS1", 1, 1, 1]],
    access: { mS1: ROS },
  },
  // A grant that allows nothing.
  nothing: {
    grants: [["mailbox", "mA1", 0, 0, 0]],
    access: {},
  },
  // Grants on a domain and a mailbox that no longer exist.
  removedTargets: {
    grants: [
      ["domain", "dGone", 1, 1, 1],
      ["mailbox", "mGone", 1, 1, 1],
    ],
    access: {},
  },
  revoked: {
    grants: [["all", "", 1, 1, 1]],
    access: {},
    revoked: true,
  },
};

const secretOf = (name) => `gm_test_${name}_${"x".repeat(24)}`;

/* ---------- Server ---------- */

let mf;
let request;

function seedSql() {
  const t = Date.now();
  const rows = [];
  for (const d of DOMAINS) rows.push(`INSERT INTO domains (id, name, active, created_at) VALUES (${q(d.id)}, ${q(d.name)}, 1, ${t});`);
  for (const m of MAILBOXES)
    rows.push(`INSERT INTO mailboxes (id, address, display_name, active, created_at) VALUES (${q(m.id)}, ${q(m.address)}, ${q(m.id)}, 1, ${t});`);
  MAILBOXES.forEach((m, i) => {
    rows.push(
      `INSERT INTO messages (id, mailbox_id, thread_id, folder, direction, from_addr, from_name, subject, snippet, text_body, is_read, is_starred, date, created_at)
       VALUES (${q(msgOf(m.id))}, ${q(m.id)}, ${q("t_" + m.id)}, 'inbox', 'in', 'sender@elsewhere.test', 'Sender', ${q("Hello " + m.id)}, 'hi', 'hi', 0, 0, ${t - i * 1000}, ${t});`,
    );
    rows.push(
      `INSERT INTO attachments (id, message_id, filename, content_type, size, r2_key, created_at)
       VALUES (${q(attOf(m.id))}, ${q(msgOf(m.id))}, 'note.txt', 'text/plain', ${attBytes(m.id).length}, ${q("att/" + m.id)}, ${t});`,
    );
  });
  for (const [name, k] of Object.entries(KEYS)) {
    rows.push(
      `INSERT INTO api_keys (id, name, prefix, key_hash, scopes, created_at, revoked_at)
       VALUES (${q(name)}, ${q(name)}, 'gm_test', ${q(sha256(secretOf(name)))}, '', ${t}, ${k.revoked ? t : "NULL"});`,
    );
    for (const [type, id, r, o, s] of k.grants)
      rows.push(
        `INSERT INTO api_key_grants (key_id, target_type, target_id, can_read, can_organize, can_send) VALUES (${q(name)}, ${q(type)}, ${q(id)}, ${r}, ${o}, ${s});`,
      );
  }
  return rows.join("\n");
}

before(async () => {
  ({ mf, request } = await startWorker(seedSql()));
  const bucket = await mf.getR2Bucket("MAIL_BUCKET");
  for (const m of MAILBOXES) await bucket.put(`att/${m.id}`, attBytes(m.id));
});

after(() => mf?.dispose());

/* ---------- Calls ---------- */

async function call(keyName, method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (keyName) headers.Authorization = `Bearer ${secretOf(keyName)}`;
  const res = await request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("application/json") ? await res.json() : await res.text();
  return { status: res.status, data };
}

const can = (key, mb, scope) => !!KEYS[key].access[mb]?.[scope];
const anyGrant = (key, scope) => KEYS[key].grants.some(([, , r, o, s]) => ({ read: r, organize: o, send: s })[scope]);
/** The status a read endpoint returns when the mailbox is off limits: no read grant at all is 403, otherwise "not found". */
const deniedRead = (key, notFound) => (anyGrant(key, "read") ? notFound : 403);

const liveKeys = Object.keys(KEYS).filter((k) => !KEYS[k].revoked);

/* ---------- Tests ---------- */

describe("API key access", () => {
  test("requests without a valid key are refused everywhere", async () => {
    const paths = [
      ["GET", "/api/v1/mailboxes"],
      ["GET", "/api/v1/messages"],
      ["GET", `/api/v1/messages/${msgOf("mA1")}`],
      ["POST", `/api/v1/messages/${msgOf("mA1")}`, { action: "star" }],
      ["GET", `/api/v1/attachments/${attOf("mA1")}`],
      ["POST", "/api/v1/send", { from: "one@alpha.test", to: "a@b.test", text: "hi" }],
    ];
    for (const [method, path, body] of paths) {
      assert.equal((await call(null, method, path, body)).status, 401, `no key: ${method} ${path}`);
      assert.equal((await call("revoked", method, path, body)).status, 401, `revoked key: ${method} ${path}`);
      const res = await request(path, { method, headers: { Authorization: "Bearer gm_not_a_real_key" }, body: body && JSON.stringify(body) });
      assert.equal(res.status, 401, `unknown key: ${method} ${path}`);
    }
  });

  for (const key of liveKeys) {
    describe(`key "${key}"`, () => {
      test("GET /mailboxes lists exactly its mailboxes, with its permissions on each", async () => {
        const res = await call(key, "GET", "/api/v1/mailboxes");
        if (!["read", "organize", "send"].some((p) => anyGrant(key, p))) return assert.equal(res.status, 403);
        assert.equal(res.status, 200);
        const got = Object.fromEntries(res.data.data.map((m) => [m.id, [...m.permissions].sort()]));
        const want = {};
        for (const m of MAILBOXES) {
          const p = ["read", "organize", "send"].filter((scope) => can(key, m.id, scope));
          if (p.length) want[m.id] = p.sort();
        }
        assert.deepEqual(got, want);
      });

      test("GET /messages returns messages from readable mailboxes only", async () => {
        const res = await call(key, "GET", "/api/v1/messages?folder=all&limit=100");
        if (!anyGrant(key, "read")) return assert.equal(res.status, 403);
        assert.equal(res.status, 200);
        // Other tests send mail, so there may be more messages than the seeded ones: every message
        // must come from a readable mailbox, and every seeded message of a readable mailbox must be there.
        const readable = MAILBOXES.filter((m) => can(key, m.id, "read")).map((m) => m.id);
        for (const m of res.data.data) assert.ok(readable.includes(m.mailbox.id), `${m.id} is from ${m.mailbox.id}`);
        const got = res.data.data.map((m) => m.id);
        for (const mb of readable) assert.ok(got.includes(msgOf(mb)), `missing ${msgOf(mb)}`);
      });

      for (const mb of MAILBOXES) {
        const read = can(key, mb.id, "read");
        const organize = can(key, mb.id, "organize");
        const send = can(key, mb.id, "send");

        test(`${mb.address}: list, read and download ${read ? "allowed" : "refused"}, mark and move ${organize ? "allowed" : "refused"}`, async () => {
          const list = await call(key, "GET", `/api/v1/messages?folder=all&mailbox=${encodeURIComponent(mb.address)}`);
          assert.equal(list.status, read ? 200 : 403, "list with ?mailbox=");
          if (read) {
            assert.ok(list.data.data.every((m) => m.mailbox.id === mb.id), "only this mailbox's messages");
            assert.ok(list.data.data.some((m) => m.id === msgOf(mb.id)), "its seeded message");
          }

          const one = await call(key, "GET", `/api/v1/messages/${msgOf(mb.id)}`);
          assert.equal(one.status, read ? 200 : deniedRead(key, 404), "get one message");
          if (read) assert.equal(one.data.data.mailbox.id, mb.id);

          // Organize, not read, decides. Refused: organize_required when it can read this message
          // (a key from before Organize existed), forbidden with no organize anywhere, else not found.
          const refused = read ? [403, "organize_required"] : anyGrant(key, "organize") ? [404, "not_found"] : [403, "forbidden"];
          for (const action of ["star", "archive", "trash"]) {
            const res = await call(key, "POST", `/api/v1/messages/${msgOf(mb.id)}`, { action });
            if (organize) assert.equal(res.status, 200, action);
            else assert.deepEqual([res.status, res.data.error?.code], refused, action);
          }
          // Whatever happened, check it through a key that sees everything, then undo.
          const seen = await call("readAll", "GET", `/api/v1/messages/${msgOf(mb.id)}`);
          assert.equal(seen.data.data.is_starred, organize, "starred only when allowed");
          assert.equal(seen.data.data.folder, organize ? "trash" : "inbox", "moved only when allowed");
          if (organize) {
            await call(key, "POST", `/api/v1/messages/${msgOf(mb.id)}`, { action: "unstar" });
            await call(key, "POST", `/api/v1/messages/${msgOf(mb.id)}`, { action: "inbox" });
          }

          const att = await call(key, "GET", `/api/v1/attachments/${attOf(mb.id)}`);
          assert.equal(att.status, read ? 200 : deniedRead(key, 404), "download the attachment");
          if (read) assert.equal(att.data, attBytes(mb.id));
        });

        test(`${mb.address}: send ${send ? "allowed" : "refused"}`, async () => {
          const res = await call(key, "POST", "/api/v1/send", { from: mb.address, to: "someone@elsewhere.test", subject: "Test", text: "Hello" });
          if (send) {
            // Allowed: it goes through the permission checks (delivery itself may fail locally).
            assert.notEqual(res.status, 403, JSON.stringify(res.data));
            assert.notEqual(res.status, 401);
          } else {
            assert.equal(res.status, 403, JSON.stringify(res.data));
            assert.equal(res.data.error.code, anyGrant(key, "send") ? "mailbox_not_allowed" : "forbidden");
          }
        });
      }

      test("replies only to messages it can read, in the mailbox it sends from", async () => {
        for (const from of MAILBOXES.filter((m) => can(key, m.id, "send"))) {
          for (const of of MAILBOXES) {
            const res = await call(key, "POST", "/api/v1/send", { from: from.address, reply_to_message_id: msgOf(of.id), text: "Re" });
            if (!can(key, from.id, "read")) {
              assert.equal(res.status, 403, `${from.id} → ${of.id}`);
              assert.equal(res.data.error.code, "read_required");
            } else if (of.id !== from.id) {
              assert.equal(res.status, 404, `${from.id} → ${of.id}`);
              assert.equal(res.data.error.code, "original_not_found");
            } else {
              assert.notEqual(res.status, 403, `${from.id} → ${of.id}: ${JSON.stringify(res.data)}`);
              assert.notEqual(res.status, 404, `${from.id} → ${of.id}: ${JSON.stringify(res.data)}`);
            }
          }
        }
      });
    });
  }
});

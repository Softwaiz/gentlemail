/*
 * Mailbox signatures: what may be saved as one, who may save and see it, and how it is sent.
 * Each case goes through the real server actions and reads what they stored.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { encodeReply } from "react-server-dom-webpack/client.edge";
import { BASE, q, sha256, startWorker } from "./harness.mjs";

let mf, db, bucket, request;
const MEMBER = "session-member", ADMIN = "session-admin", OTHER = "session-other";
const API_KEY = `gm_test_signature_${"x".repeat(24)}`;

// 2 × 1 pixels, and nothing the server needs beyond the header that says so.
const PNG = Uint8Array.from(Buffer.from("89504e470d0a1a0a0000000d4948445200000002000000010806000000f478d4fa0000000049454e44ae426082", "hex"));
const GIF = Uint8Array.from(Buffer.from("47494638396104000200800000000000ffffff2c00000000040002000002020c0a003b", "hex"));
const JPEG = Uint8Array.from(Buffer.from("ffd8ffe000104a46494600010100000100010000ffc0000b080005000a01011100ffd9", "hex"));

before(async () => {
  const t = Date.now();
  ({ mf, db, request } = await startWorker(
    [
      `INSERT INTO domains (id, name, active, created_at) VALUES ('d1', 'alpha.test', 1, ${t});`,
      `INSERT INTO mailboxes (id, address, display_name, signature, active, created_at) VALUES ('mb1', 'hello@alpha.test', 'Hello', ${q("Anna\nhttps://alpha.test")}, 1, ${t});`,
      ...[["u1", "member", MEMBER], ["u2", "admin", ADMIN], ["u3", "member", OTHER]].flatMap(([id, role, session]) => [
        `INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('${id}', '${id}@alpha.test', 'U', 'x', '${role}', ${t});`,
        `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (${q(sha256(session))}, '${id}', ${t + 3600e3}, ${t});`,
      ]),
      `INSERT INTO mailbox_members (mailbox_id, user_id) VALUES ('mb1', 'u1');`,
      `INSERT INTO api_keys (id, name, prefix, key_hash, scopes, created_at) VALUES ('k1', 'k1', 'gm_test', ${q(sha256(API_KEY))}, '', ${t});`,
      `INSERT INTO api_key_grants (key_id, target_type, target_id, can_read, can_organize, can_send) VALUES ('k1', 'mailbox', 'mb1', 1, 0, 1);`,
    ].join("\n"),
  ));
  bucket = await mf.getR2Bucket("MAIL_BUCKET");
});
after(() => mf?.dispose());

async function action(path, name, fields, session = MEMBER) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const multipart = new Response(await encodeReply([form]));
  const res = await request(`${path}?__rsc&__rsc_action_id=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { Cookie: `kb_session=${session}`, Origin: BASE, "Content-Type": multipart.headers.get("content-type") },
    body: await multipart.arrayBuffer(),
  });
  return res.text();
}
const save = (fields, session) =>
  action("/mb/mb1/settings", "/src/app/actions/mail.ts#saveMailboxSettings", { mailbox_id: "mb1", display_name: "Hello", signature_fields: "1", ...fields }, session);
const mailbox = () => db.prepare("SELECT * FROM mailboxes WHERE id = 'mb1'").first();
const image = (bytes, name = "logo.png", type = "image/png") => new File([bytes], name, { type });
const logos = async () => (await bucket.list({ prefix: "att/mb1/signature/" })).objects.map((o) => o.key);

let n = 0;
async function send(fields = {}) {
  const subject = `signature ${++n}`;
  const answer = await action("/mb/mb1/compose", "/src/app/actions/mail.ts#sendMessage", { mailbox_id: "mb1", to: "anna@example.com", subject, html: "<p>Hi</p>", signature: "on", ...fields });
  const row = await db.prepare("SELECT * FROM messages WHERE folder = 'sent' AND subject = ?").bind(subject).first();
  assert.ok(row, answer);
  const { results: files } = await db.prepare("SELECT * FROM attachments WHERE message_id = ?").bind(row.id).all();
  return { ...row, files };
}

describe("signatures", () => {
  test("one from before formatting keeps its words, with the line and no dashes", async () => {
    const { html_body, text_body, files } = await send();
    assert.match(html_body, /border-top:1px solid[^>]*>Anna<br>\s*<a href="https:\/\/alpha\.test">/);
    assert.ok(!html_body.includes("-- "), html_body);
    assert.equal(text_body, "Hi\n\n-- \nAnna\nhttps://alpha.test");
    assert.equal(files.length, 0);
  });

  test("a page opened before the update saves its plain text", async () => {
    await action("/mb/mb1/settings", "/src/app/actions/mail.ts#saveMailboxSettings", { mailbox_id: "mb1", display_name: "Hello", signature: "Anna B" });
    const m = await mailbox();
    assert.deepEqual([m.signature, m.signature_html, m.signature_line], ["Anna B", "", 1]);
  });

  test("only the composer's formatting is kept, without colours", async () => {
    await save({
      signature_line: "on",
      signature_html:
        '<p onclick="x()"><b>Anna</b> <span style="color:red">Example</span></p><script>alert(1)</script><p><img src="https://tracker.example/p.gif"><a href="javascript:alert(1)">bad</a> <a href="https://alpha.test">site</a></p><blockquote>Our words</blockquote>',
    });
    const m = await mailbox();
    assert.ok(!/script|onclick|<img|tracker|color|javascript/.test(m.signature_html), m.signature_html);
    assert.match(m.signature_html, /<strong>Anna<\/strong> Example/);
    assert.match(m.signature_html, /<a href="https:\/\/alpha\.test">site<\/a>/);
    assert.match(m.signature, /^Anna Example\n/);
    const { html_body, text_body } = await send();
    assert.ok(html_body.includes(m.signature_html));
    assert.ok(text_body.includes("\n\n-- \nAnna Example"));
    assert.ok(!/(?:^|[;"\s])color\s*:|background/i.test(html_body), html_body);
  });

  test("a page opened before the update can't flatten a formatted one", async () => {
    await action("/mb/mb1/settings", "/src/app/actions/mail.ts#saveMailboxSettings", { mailbox_id: "mb1", display_name: "Hello", signature: "flat" });
    assert.match((await mailbox()).signature_html, /Anna/);
  });

  test("the line can be turned off", async () => {
    await save({ signature_html: "<p>Anna</p>" });
    assert.equal((await mailbox()).signature_line, 0);
    const { html_body, text_body } = await send();
    assert.ok(!html_body.includes("border-top") && !html_body.includes("-- "), html_body);
    assert.ok(text_body.endsWith("-- \nAnna"));
  });

  test("left out of a message when unchecked", async () => {
    const { html_body, text_body } = await send({ signature: "" });
    assert.ok(!html_body.includes("Anna") && text_body === "Hi");
  });

  test("one that is too long is refused, and the saved one stays", async () => {
    const before = await mailbox();
    assert.match(await save({ signature_html: `<p>${"x".repeat(6000)}</p>` }), /too long/);
    assert.match(await save({ signature_html: "<p>x</p>".repeat(30_000) }), /too long/);
    assert.deepEqual(await mailbox(), before);
  });
});

describe("logo", () => {
  test("is read from its bytes: PNG, JPEG and GIF", async () => {
    for (const [bytes, name, type, ratio] of [[GIF, "a.png", "image/gif", 0.5], [JPEG, "a.png", "image/jpeg", 0.5], [PNG, "a.txt", "image/png", 0.5]]) {
      await save({ signature_html: "<p>Anna</p>", logo: image(bytes, name, "text/plain"), logo_width: "100" });
      const m = await mailbox();
      assert.equal(m.logo_type, type);
      assert.equal(m.logo_ratio, ratio);
      // The one it replaced is gone.
      assert.deepEqual(await logos(), [m.logo_key]);
    }
  });

  test("anything else is refused, and so is a big one or a bad link", async () => {
    const before = await mailbox();
    assert.match(await save({ logo: image(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')) }), /PNG, JPEG or GIF/);
    for (let i = 0; i < JPEG.length; i++) await save({ logo: image(PNG.slice(0, Math.min(i, 23))), signature_html: "<p>Anna</p>" });
    const big = new Uint8Array(200 * 1024 + 1);
    big.set(PNG);
    assert.match(await save({ logo: image(big) }), /200 KB/);
    assert.match(await save({ logo_link: "javascript:alert(1)" }), /web address/);
    assert.deepEqual([(await mailbox()).logo_key, await logos()], [before.logo_key, [before.logo_key]]);
  });

  test("its width and position keep to what is offered", async () => {
    await save({ signature_html: "<p>Anna</p>", logo_width: "9999", logo_position: "nowhere", logo_link: "alpha.test" });
    let m = await mailbox();
    assert.deepEqual([m.logo_width, m.logo_position, m.logo_link], [320, "left", "https://alpha.test"]);
    await save({ signature_html: "<p>Anna</p>", logo_width: "1", logo_position: "above", logo_link: "" });
    m = await mailbox();
    assert.deepEqual([m.logo_width, m.logo_position, m.logo_link], [40, "above", ""]);
  });

  test("is sent inside the message, and Sent keeps its own copy", async () => {
    await save({ signature_html: "<p>Anna</p>", signature_line: "on", logo_width: "100", logo_link: "https://alpha.test" });
    const sent = await send();
    assert.equal(sent.files.length, 1);
    const [logo] = sent.files;
    assert.equal(logo.disposition, "inline");
    assert.ok(!logo.content_id.includes("@"));
    assert.ok(sent.html_body.includes(`<a href="https://alpha.test"><img src="cid:${logo.content_id}" width="100" height="50" alt="Hello"`), sent.html_body);
    assert.equal(sent.has_attachments, 0);
    assert.notEqual(logo.r2_key, (await mailbox()).logo_key);
    assert.deepEqual(new Uint8Array(await (await bucket.get(logo.r2_key)).arrayBuffer()), PNG);
    // Shown in the webmail.
    const body = await (await request(`/body/${sent.id}`, { headers: { Cookie: `kb_session=${MEMBER}` } })).text();
    assert.ok(body.includes(`/attachments/${logo.id}`), body);
    // With nothing that paints its own colours, so it follows the reader's theme.
    assert.ok(body.includes('<meta name="color-scheme" content="light dark">'));
  });

  test("goes along in replies and forwards", async () => {
    const original = await send({ signature: "" });
    for (const mode of ["reply", "forward"]) {
      const { files, html_body } = await send({ original: original.id, mode });
      assert.equal(files.length, 1, mode);
      assert.ok(html_body.includes(`cid:${files[0].content_id}`));
    }
  });

  test("is sent by the API when the signature is asked for", async () => {
    for (const [signature, count] of [[true, 1], [false, 0]]) {
      const res = await request("/api/v1/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "hello@alpha.test", to: "anna@example.com", subject: "api", text: "Hi", signature }),
      });
      assert.equal(res.status, 201);
      const { id } = await res.json();
      const { results } = await db.prepare("SELECT * FROM attachments WHERE message_id = ?").bind(id).all();
      assert.equal(results.length, count);
    }
  });

  test("is shown only to people who can open the mailbox", async () => {
    const get = (session) => request("/signature-logo/mb1", { headers: session ? { Cookie: `kb_session=${session}` } : {}, redirect: "manual" });
    const ok = await get(MEMBER);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await get(ADMIN)).status, 200);
    assert.equal((await get(OTHER)).status, 404);
    assert.notEqual((await get(null)).status, 200);
  });

  test("an admin edits it from the mailbox's page; others can't", async () => {
    const name = "/src/app/actions/admin.ts#updateMailbox";
    const fields = { id: "mb1", display_name: "Hello", active: "on", signature_fields: "1", signature_html: "<p>By the admin</p>", logo_remove: "1" };
    await action("/admin/mailboxes/mb1", name, fields, MEMBER);
    assert.equal((await mailbox()).signature, "Anna");
    await save({ signature_html: "<p>Other</p>" }, OTHER);
    assert.equal((await mailbox()).signature, "Anna");
    await action("/admin/mailboxes/mb1", name, fields, ADMIN);
    const m = await mailbox();
    assert.deepEqual([m.signature, m.logo_key, m.logo_type, m.active], ["By the admin", null, null, 1]);
    assert.deepEqual(await logos(), []);
  });

  test("alone is a signature too, named in the plain text", async () => {
    await save({ signature_html: "<p><br></p>", logo: image(PNG) });
    assert.equal((await mailbox()).signature_html, "");
    const { files, text_body } = await send();
    assert.equal(files.length, 1);
    assert.equal(text_body, "Hi\n\n-- \nHello");
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { GentleMail, GentleMailError } from "../dist/index.js";

/** A fake fetch that records requests and answers from a queue. */
function fake(...answers) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init, json: init.body ? JSON.parse(init.body) : undefined });
    const a = answers.shift() ?? { status: 200, body: {} };
    return new Response(typeof a.body === "string" ? a.body : JSON.stringify(a.body), {
      status: a.status ?? 200,
      headers: { "Content-Type": a.type ?? "application/json" },
    });
  };
  return { fetch, calls };
}

test("needs a url and a key", () => {
  assert.throws(() => new GentleMail({ apiKey: "gm_x" }), /url/);
  assert.throws(() => new GentleMail({ url: "https://m.test" }), /apiKey/);
});

test("send: base URL, auth header, JSON body, attachments as base64", async () => {
  const f = fake({ status: 201, body: { id: "m1", thread_id: "t1", from: "a@x.test", status: "sent" } });
  const mail = new GentleMail({ url: "https://m.test/", apiKey: "gm_key", fetch: f.fetch });
  const r = await mail.send({
    from: "a@x.test",
    to: ["Ada <ada@y.test>"],
    subject: "Hi",
    text: "Hello",
    attachments: [
      { filename: "a.txt", content: new TextEncoder().encode("héllo") },
      { filename: "b.bin", content: new Uint8Array([0, 255, 1]).buffer, content_type: "application/octet-stream" },
      { filename: "c.txt", content: "YWJj" },
    ],
  });
  assert.deepEqual(r, { id: "m1", thread_id: "t1", from: "a@x.test", status: "sent" });
  const c = f.calls[0];
  assert.equal(c.url, "https://m.test/api/v1/send");
  assert.equal(c.method, "POST");
  assert.equal(c.headers.Authorization, "Bearer gm_key");
  assert.equal(c.headers["Content-Type"], "application/json");
  assert.equal(Buffer.from(c.json.attachments[0].content, "base64").toString(), "héllo");
  assert.deepEqual([...Buffer.from(c.json.attachments[1].content, "base64")], [0, 255, 1]);
  assert.equal(c.json.attachments[1].content_type, "application/octet-stream");
  assert.equal(c.json.attachments[2].content, "YWJj");
  assert.equal("content_type" in c.json.attachments[0], false);
});

test("large attachments encode without overflowing", async () => {
  const f = fake({ status: 201, body: {} });
  const mail = new GentleMail({ url: "https://m.test", apiKey: "k", fetch: f.fetch });
  const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
  await mail.send({ from: "a@x.test", to: "b@y.test", text: "x", attachments: [{ filename: "big", content: big }] });
  assert.ok(Buffer.from(f.calls[0].json.attachments[0].content, "base64").equals(Buffer.from(big)));
});

test("messages.list builds the query; since accepts a Date", async () => {
  const f = fake({ body: { data: [{ id: "m1" }] } }, { body: { data: [] } });
  const mail = new GentleMail({ url: "https://m.test", apiKey: "k", fetch: f.fetch });
  const list = await mail.messages.list({ mailbox: "s@x.test", folder: "all", unread: true, since: new Date(1700000000000), limit: 10 });
  assert.deepEqual(list, [{ id: "m1" }]);
  assert.equal(f.calls[0].url, "https://m.test/api/v1/messages?mailbox=s%40x.test&folder=all&unread=true&since=1700000000000&limit=10");
  await mail.messages.list();
  assert.equal(f.calls[1].url, "https://m.test/api/v1/messages");
  assert.equal(f.calls[1].body, undefined);
});

test("get, update, mailboxes", async () => {
  const f = fake({ body: { data: { id: "a/b", html: null } } }, { body: { id: "a/b", action: "archive", status: "ok" } }, { body: { data: [{ address: "s@x.test", permissions: ["read"] }] } });
  const mail = new GentleMail({ url: "https://m.test", apiKey: "k", fetch: f.fetch });
  assert.equal((await mail.messages.get("a/b")).id, "a/b");
  assert.equal(f.calls[0].url, "https://m.test/api/v1/messages/a%2Fb");
  assert.equal(await mail.messages.update("a/b", "archive"), undefined);
  assert.deepEqual(f.calls[1].json, { action: "archive" });
  assert.deepEqual((await mail.mailboxes.list())[0].permissions, ["read"]);
  assert.equal(f.calls[2].url, "https://m.test/api/v1/mailboxes");
});

test("messages.reply sends from the message's mailbox, in its thread", async () => {
  const f = fake({ status: 201, body: { id: "r1" } });
  const mail = new GentleMail({ url: "https://m.test", apiKey: "k", fetch: f.fetch });
  await mail.messages.reply({ id: "m9", mailbox: { id: "b", address: "support@x.test" } }, { text: "On it" });
  assert.deepEqual(f.calls[0].json, { text: "On it", from: "support@x.test", reply_to_message_id: "m9" });
});

test("attachments.download takes an id or a url, returns the response", async () => {
  const f = fake({ body: "PDFDATA", type: "application/pdf" }, { body: "X", type: "text/plain" });
  const mail = new GentleMail({ url: "https://m.test", apiKey: "k", fetch: f.fetch });
  const r = await mail.attachments.download("att1");
  assert.equal(await r.text(), "PDFDATA");
  assert.equal(f.calls[0].url, "https://m.test/api/v1/attachments/att1");
  await mail.attachments.download("https://m.test/api/v1/attachments/att2");
  assert.equal(f.calls[1].url, "https://m.test/api/v1/attachments/att2");
});

test("API errors become GentleMailError with status and code", async () => {
  const f = fake(
    { status: 403, body: { error: { code: "mailbox_not_allowed", message: "This key can't send from x." } } },
    { status: 502, body: "<html>Bad gateway</html>", type: "text/html" },
    { status: 404, body: { error: { code: "not_found", message: "No such attachment." } } },
  );
  const mail = new GentleMail({ url: "https://m.test", apiKey: "k", fetch: f.fetch });
  await assert.rejects(mail.send({ from: "x", to: "y@z.test", text: "t" }), (e) => {
    assert.ok(e instanceof GentleMailError);
    assert.equal(e.status, 403);
    assert.equal(e.code, "mailbox_not_allowed");
    assert.equal(e.message, "This key can't send from x.");
    return true;
  });
  await assert.rejects(mail.mailboxes.list(), (e) => e.status === 502 && e.code === "http_error");
  await assert.rejects(mail.attachments.download("a"), (e) => e.code === "not_found");
});

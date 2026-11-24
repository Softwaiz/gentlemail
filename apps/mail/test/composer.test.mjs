/*
 * The webmail composer's formatted messages: the server keeps only the composer's own
 * formatting, whatever the browser posts, and writes a readable plain-text version.
 * Each case sends through the real sendMessage action and reads the copy kept in Sent.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { encodeReply } from "react-server-dom-webpack/client.edge";
import { BASE, q, sha256, startWorker } from "./harness.mjs";

let mf, db, request;
const SESSION = "session-composer";
const API_KEY = `gm_test_composer_${"x".repeat(24)}`;

before(async () => {
  const t = Date.now();
  ({ mf, db, request } = await startWorker(
    [
      `INSERT INTO domains (id, name, active, created_at) VALUES ('d1', 'alpha.test', 1, ${t});`,
      `INSERT INTO mailboxes (id, address, display_name, active, created_at) VALUES ('mb1', 'hello@alpha.test', 'Hello', 1, ${t});`,
      `INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('u1', 'u1@alpha.test', 'U', 'x', 'member', ${t});`,
      `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (${q(sha256(SESSION))}, 'u1', ${t + 3600e3}, ${t});`,
      `INSERT INTO mailbox_members (mailbox_id, user_id) VALUES ('mb1', 'u1');`,
      `INSERT INTO api_keys (id, name, prefix, key_hash, scopes, created_at) VALUES ('k1', 'k1', 'gm_test', ${q(sha256(API_KEY))}, '', ${t});`,
      `INSERT INTO api_key_grants (key_id, target_type, target_id, can_read, can_organize, can_send) VALUES ('k1', 'mailbox', 'mb1', 0, 0, 1);`,
    ].join("\n"),
  ));
});
after(() => mf?.dispose());

let n = 0;
/** Posts to the composer's action; returns the response and the stored Sent copy, if any. */
async function post(fields) {
  const subject = `composer ${++n}`;
  const form = new FormData();
  for (const [k, v] of Object.entries({ mailbox_id: "mb1", to: "anna@example.com", subject, ...fields })) form.set(k, v);
  // Miniflare's fetch takes bytes: serialize the reply as the browser would (multipart).
  const multipart = new Response(await encodeReply([form]));
  const res = await request(`/mb/mb1/compose?__rsc&__rsc_action_id=${encodeURIComponent("/src/app/actions/mail.ts#sendMessage")}`, {
    method: "POST",
    headers: { Cookie: `kb_session=${SESSION}`, Origin: BASE, "Content-Type": multipart.headers.get("content-type") },
    body: await multipart.arrayBuffer(),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const row = await db.prepare("SELECT text_body, html_body FROM messages WHERE folder = 'sent' AND subject = ?").bind(subject).first();
  return { res, row };
}

/** Sends through the composer's action; returns the stored Sent copy. */
async function send(fields) {
  const { res, row } = await post(fields);
  assert.ok(row, `not sent: ${await res.text()}`);
  return row;
}

describe("composer formatting", () => {
  test("keeps every toolbar format, in one spelling", async () => {
    const { html_body, text_body } = await send({
      html:
        '<p dir="ltr"><b><strong class="font-semibold" style="white-space: pre-wrap;">Bold</strong></b> <i><em>it</em></i> ' +
        '<span class="underline"><u>under</u></span> <s>gone</s> H<sub>2</sub>O x<sup>2</sup> <code>npm test</code></p>' +
        '<ul><li value="1">apples</li><li value="2">pears</li></ul><ol><li value="1">first</li><li value="2">second</li></ol>' +
        '<blockquote>quoted</blockquote><p><a href="https://example.com/a?b=1&amp;c=2" rel="noreferrer">the site</a> and ' +
        '<a href="mailto:anna@example.com">anna@example.com</a></p>',
    });
    for (const part of [
      "<strong>Bold</strong>",
      "<em>it</em>",
      "<u>under</u>",
      "<s>gone</s>",
      "H<sub>2</sub>O",
      "x<sup>2</sup>",
      "<ul><li>apples</li><li>pears</li></ul>",
      '<ol><li value="1">first</li><li value="2">second</li></ol>',
      '<a href="https://example.com/a?b=1&amp;c=2">the site</a>',
      '<a href="mailto:anna@example.com">',
    ])
      assert.ok(html_body.includes(part), `${part} missing from ${html_body}`);
    assert.match(html_body, /<blockquote style="[^"]*border-left[^"]*">quoted<\/blockquote>/);
    assert.match(html_body, /<code style="[^"]*monospace[^"]*">npm test<\/code>/);
    assert.ok(!/<strong><strong>|<b>|<i>|class=|dir=|<ul><li value|rel=|white-space/.test(html_body), html_body);

    assert.equal(
      text_body,
      [
        "Bold it under gone H2O x2 npm test",
        "- apples",
        "- pears",
        "1. first",
        "2. second",
        "> quoted",
        "the site (https://example.com/a?b=1&c=2) and anna@example.com",
      ].join("\n"),
    );
  });

  test("removes scripts, handlers, styles and unsafe links", async () => {
    const { html_body, text_body } = await send({
      html:
        "<script>alert(1)</script><style>p{color:red}</style><!-- note -->" +
        '<p onclick="steal()" style="color:red" class="x" id="y">hello</p>' +
        '<img src="https://tracker.example/x.gif" onerror="alert(2)">' +
        '<p><a href="javascript:alert(3)">js link</a> <a href="data:text/html,hi">data link</a> <a href=" JaVaScRiPt:alert(4)">spaced</a></p>' +
        '<iframe src="https://evil.example"></iframe><svg><script>alert(5)</script></svg>' +
        '<form action="https://evil.example"><input name="p"><button>Go</button></form>' +
        '<div><span style="font-size:40px">kept text</span></div><h1>heading text</h1>',
    });
    const body = html_body.toLowerCase();
    for (const bad of ["<script", "alert", "<style", "color:red", "<!--", "onclick", "onerror", "class=", "id=", "<img", "tracker", "javascript", "data:", "<iframe", "evil", "<svg", "<form", "<input", "<button", "font-size:40px", "<h1", "<span", "<div><span"])
      assert.ok(!body.slice(body.indexOf("hello") - 10).includes(bad), `${bad} left in ${html_body}`);
    assert.ok(html_body.includes('<p style="margin:0">hello</p>'), html_body);
    assert.ok(html_body.includes("js link") && html_body.includes("data link") && html_body.includes("kept text") && html_body.includes("heading text"));
    assert.ok(!text_body.includes("alert") && !text_body.includes("color:red"), text_body);
    assert.match(text_body, /^hello\njs link data link spaced/);
  });

  test("keeps the text people typed, markup characters included", async () => {
    const { html_body, text_body } = await send({ html: "<p>if a &lt; b &amp;&amp; c &gt; d: &lt;script&gt;</p><p><br></p><p>bye</p>" });
    assert.ok(html_body.includes('<p style="margin:0">if a &lt; b &amp;&amp; c &gt; d: &lt;script&gt;</p>'), html_body);
    assert.equal(text_body, "if a < b && c > d: <script>\n\nbye");
  });

  for (const tag of ["xmp", "noembed", "noframes", "plaintext", "listing"]) {
    test(`markup hidden as text in <${tag}> doesn't come back out`, async () => {
      const { html_body, text_body } = await send({
        html: `<p>ok</p><${tag}><script>alert(1)</script><img src="https://tracker.example/x.gif" onerror="alert(2)"><b>x</b></${tag}>`,
      });
      for (const bad of ["<script", "<img", "onerror", "alert", "tracker", "&lt;script"]) assert.ok(!html_body.includes(bad), `${bad} left in ${html_body}`);
      assert.ok(html_body.includes('<p style="margin:0">ok</p>'), html_body);
      assert.equal(text_body, "ok");
    });
  }

  test("paragraphs have no margins, so lines aren't double-spaced", async () => {
    const { html_body } = await send({ html: "<p>one</p><p>two</p>" });
    assert.ok(html_body.includes('<p style="margin:0">one</p><p style="margin:0">two</p>'), html_body);
  });

  test("keeps repeated spaces and tabs", async () => {
    const { html_body, text_body } = await send({
      html: '<p><span style="white-space: pre-wrap;">a  b\tc</span></p><p><span style="white-space: pre-wrap;">if a &lt; b  &amp;&amp; c</span></p>',
    });
    assert.ok(html_body.includes("a &nbsp;b &nbsp;&nbsp;&nbsp;c"), html_body);
    assert.ok(html_body.includes("if a &lt; b &nbsp;&amp;&amp; c"), html_body);
    assert.equal(text_body, "a  b    c\nif a < b  && c");
  });

  test("a link with a quote in its address stays a link", async () => {
    const { html_body } = await send({ html: `<p><a href="https://example.com/it's">the page</a></p>` });
    assert.match(html_body, /<a href="https:\/\/example\.com\/it(&#39;|')s">the page<\/a>/);
  });

  test("closes what's left open and drops stray end tags", async () => {
    const { html_body } = await send({ html: '<p><a href="https://example.com">open link</p></b></em><p>next' });
    const body = html_body.slice(html_body.indexOf("<p"), html_body.lastIndexOf("</div>"));
    assert.equal(body, '<p style="margin:0"><a href="https://example.com">open link</a></p><p style="margin:0">next</p>');
  });

  test("a nested list keeps its numbering, with no empty marker before it", async () => {
    const { html_body, text_body } = await send({
      html: '<ol><li value="1">one</li><li value="2" class="composer-li-nested"><ol><li value="1">one.a</li></ol></li><li value="2">two</li></ol>',
    });
    assert.ok(
      html_body.includes('<ol><li value="1">one</li><li value="2" style="list-style:none"><ol><li value="1">one.a</li></ol></li><li value="2">two</li></ol>'),
      html_body,
    );
    assert.equal(text_body, "1. one\n  1. one.a\n2. two");
  });

  test("a numbered list keeps where it starts", async () => {
    const { html_body, text_body } = await send({ html: '<ol start="3"><li value="3">c</li><li value="4">d</li></ol><ol start="x"><li value="1e3">e</li></ol>' });
    assert.ok(html_body.includes('<ol start="3"><li value="3">c</li><li value="4">d</li></ol><ol><li>e</li></ol>'), html_body);
    assert.equal(text_body, "3. c\n4. d\n1. e");
  });

  test("spaces around a format, or at the start of a line, are kept", async () => {
    const { html_body, text_body } = await send({
      html: '<p><span style="white-space: pre-wrap;">a </span><b><strong style="white-space: pre-wrap;"> b</strong></b></p><p><span>  indented</span></p>',
    });
    assert.ok(html_body.includes('<p style="margin:0">a <strong>&nbsp;b</strong></p><p style="margin:0">&nbsp;&nbsp;indented</p>'), html_body);
    assert.equal(text_body, "a  b\n  indented");
  });

  test("a line break inside a link doesn't repeat its address", async () => {
    const { text_body } = await send({ html: '<p>see <a href="https://example.com">https://example.com<br></a>next</p>' });
    assert.equal(text_body, "see https://example.com\nnext");
  });

  test("only web and email addresses on a domain name stay links", async () => {
    const { html_body } = await send({
      html:
        '<p><a href="tel:+33612345678">call</a> <a href="sms:+33612345678">text</a> <a href="http://192.168.1.10/admin">router</a> ' +
        '<a href="http://localhost:8080/">local</a> <a href="https://xn--e1afmkfd.xn--p1ai/">idn</a></p>',
    });
    for (const bad of ["tel:", "sms:", "192.168", "localhost"]) assert.ok(!html_body.includes(bad), `${bad} left in ${html_body}`);
    assert.ok(html_body.includes('<p style="margin:0">call text router local <a href="https://xn--e1afmkfd.xn--p1ai/">idn</a></p>'), html_body);
  });

  test("a paragraph or item left open ends where the next one starts", async () => {
    const { html_body, text_body } = await send({ html: "<p>a<p>b<ul><li>x<li><strong>y<li>z</ul>" });
    const body = html_body.slice(html_body.indexOf("<p"), html_body.lastIndexOf("</div>"));
    assert.equal(body, '<p style="margin:0">a</p><p style="margin:0">b</p><ul><li>x</li><li><strong>y</strong></li><li>z</li></ul>');
    assert.equal(text_body, "a\nb\n- x\n- y\n- z");
  });

  test("text from an unwrapped block keeps its own line", async () => {
    const { text_body } = await send({ html: "<div>Hello</div><p>World</p>" });
    assert.equal(text_body, "Hello\nWorld");
  });

  test("a long paste is judged on what is sent, not on the editor's markup", async () => {
    const run = '<span class="composer-text" style="white-space: pre-wrap;" data-x="padding padding">a</span>';
    const html = `<p>${run.repeat(8000)}</p>`;
    assert.ok(html.length > 500_000);
    const { text_body } = await send({ html });
    assert.equal(text_body, "a".repeat(8000));
  });

  test("a bare < in the text keeps what follows it", async () => {
    const { html_body, text_body } = await send({ html: "<p>if a < b and c > d then go</p>" });
    assert.ok(html_body.includes('<p style="margin:0">if a &lt; b and c &gt; d then go</p>'), html_body);
    assert.equal(text_body, "if a < b and c > d then go");
  });

  test("empty lines typed in a row all stay, and so does the first line's indent", async () => {
    const { text_body } = await send({
      html: '<p><span style="white-space: pre-wrap;">    indented</span></p><p><br></p><p><br></p><p><br></p><p>after three</p>',
    });
    assert.equal(text_body, "    indented\n\n\n\nafter three");
  });

  test("indented HTML doesn't add spaces or lines", async () => {
    const { html_body, text_body } = await send({ html: "<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>\n<p>\n  done\n</p>" });
    assert.ok(!html_body.includes("&nbsp;"), html_body);
    assert.equal(text_body, "- a\n- b\ndone");
  });

  test("a new paragraph closes a link left open in the one before", async () => {
    const { html_body } = await send({ html: '<p><a href="https://example.com">link<p>after' });
    const body = html_body.slice(html_body.indexOf("<p"), html_body.lastIndexOf("</div>"));
    assert.equal(body, '<p style="margin:0"><a href="https://example.com">link</a></p><p style="margin:0">after</p>');
  });

  test("spaces between two blocks don't make a line of their own", async () => {
    const { html_body, text_body } = await send({ html: "<p>a</p> <p>b</p> <ul> <li>x</li> </ul>" });
    assert.ok(!html_body.includes("&nbsp;"), html_body);
    assert.equal(text_body, "a\nb\n- x");
  });

  test("the size limit counts bytes, so a long message in Chinese is refused before it goes", async () => {
    // 3 bytes a character: 100,000 characters fit in the limit, 200,000 don't.
    const fits = await send({ html: `<p>${"漢".repeat(80_000)}</p>` });
    assert.equal(fits.text_body, "漢".repeat(80_000));
    const { res, row } = await post({ html: `<p>${"漢".repeat(200_000)}</p>` });
    assert.ok(!row);
    assert.match(await res.text(), /too long/);
  });

  test("a Sent copy too big for its row keeps its HTML in storage", async () => {
    const subject = "big api send";
    const res = await request("/api/v1/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "hello@alpha.test", to: "anna@example.com", subject, html: `<p>${"漢".repeat(400_000)}</p>`, text: "字".repeat(400_000) }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    const row = await db.prepare("SELECT text_body, html_body, html_key FROM messages WHERE folder = 'sent' AND subject = ?").bind(subject).first();
    assert.equal(row.html_body, null);
    assert.ok(row.html_key);
    const stored = await (await mf.getR2Bucket("MAIL_BUCKET")).get(row.html_key);
    assert.ok((await stored.text()).includes("漢".repeat(400_000)));
    assert.ok(new TextEncoder().encode(row.text_body).length <= 900_000);
    assert.match(row.text_body, /truncated/);
  });

  test("a message too long to keep is refused", async () => {
    const { res, row } = await post({ html: `<p>${"x".repeat(600_000)}</p>` });
    assert.ok(!row);
    assert.match(await res.text(), /too long/);
  });

  test("kept spaces count toward the limit", async () => {
    const { row } = await post({ html: `<p>a${" ".repeat(200_000)}b</p>` });
    assert.ok(!row);
  });

  test("a page without the editor still sends its plain text", async () => {
    const { html_body, text_body } = await send({ body: "Plain <b>text</b>\nsecond line" });
    // Form posts send line breaks as \r\n, as browsers always did for the textarea.
    assert.match(text_body, /^Plain <b>text<\/b>\r?\nsecond line$/);
    assert.ok(html_body.includes("Plain &lt;b&gt;text&lt;/b&gt;<br>"), html_body);
  });

  test("an empty editor falls back to the plain body", async () => {
    const { text_body } = await send({ html: "<p><br></p>", body: "fallback" });
    assert.equal(text_body, "fallback");
  });
});

describe("messages with nothing in them", () => {
  const seedOriginal = () =>
    db
      .prepare(
        `INSERT OR IGNORE INTO messages (id, mailbox_id, thread_id, folder, direction, from_addr, from_name, to_json, subject, snippet, text_body, is_read, date, created_at)
         VALUES ('orig', 'mb1', 'th1', 'inbox', 'in', 'ada@example.com', 'Ada', '[]', 'Hi', 'Hello', 'Hello', 1, 1, 1)`,
      )
      .run();

  test("aren't sent: only an address, blank lines, or only a signature", async () => {
    await db.prepare("UPDATE mailboxes SET signature = 'Hello team' WHERE id = 'mb1'").run();
    for (const fields of [{}, { html: "<p><br></p>" }, { html: "<p>&nbsp; </p><p><br></p>" }, { body: " \n " }, { html: "<p><br></p>", signature: "on" }]) {
      const { res, row } = await post(fields);
      assert.equal(row, null, JSON.stringify(fields));
      assert.match(await res.text(), /Write a message or attach a file first\./);
    }
    await db.prepare("UPDATE mailboxes SET signature = '' WHERE id = 'mb1'").run();
  });

  test("nor is an empty reply", async () => {
    await seedOriginal();
    const { res, row } = await post({ original: "orig", mode: "reply", html: "<p><br></p>" });
    assert.equal(row, null);
    assert.match(await res.text(), /Write a message or attach a file first\./);
  });

  test("a file alone, or a forward with no word added, is sent", async () => {
    await seedOriginal();
    assert.ok((await post({ files: new File(["x"], "x.txt", { type: "text/plain" }) })).row);
    assert.ok((await post({ original: "orig", mode: "forward", html: "<p><br></p>" })).row);
  });

  test("a forward of a message that isn't in this mailbox counts as a new one", async () => {
    assert.equal((await post({ original: "nope", mode: "forward" })).row, null);
  });
});

describe("attached files", () => {
  // The local email service writes each attachment it is given to a file, under its own temporary folder.
  const delivered = (ext) =>
    readdirSync(tmpdir())
      .filter((d) => d.startsWith("miniflare-"))
      .map((d) => join(tmpdir(), d, "email"))
      .filter((d) => existsSync(d))
      .flatMap((d) => readdirSync(d, { recursive: true }).map((f) => join(d, String(f))))
      .filter((f) => f.endsWith(`.${ext}`))
      .map((f) => readFileSync(f));

  test("reach the email service as the file's own bytes", async () => {
    const ext = `x${randomBytes(6).toString("hex")}`;
    const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x80, 0xff]), randomBytes(5000)]);
    assert.ok((await post({ html: "<p>Photo</p>", files: new File([bytes], `photo.${ext}`, { type: "image/png" }) })).row);
    const files = delivered(ext);
    assert.ok(files.length > 0, "nothing was delivered");
    for (const f of files) assert.ok(f.equals(bytes), `${f.length} bytes delivered for ${bytes.length}`);
    // The copy kept in Sent, stored after the send, is the same file.
    const { r2_key } = await db.prepare("SELECT r2_key FROM attachments WHERE filename = ?").bind(`photo.${ext}`).first();
    const kept = await (await mf.getR2Bucket("MAIL_BUCKET")).get(r2_key);
    assert.ok(Buffer.from(await kept.arrayBuffer()).equals(bytes));
  });
});

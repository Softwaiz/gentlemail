/*
 * The webmail composer's formatted messages: the server keeps only the composer's own
 * formatting, whatever the browser posts, and writes a readable plain-text version.
 * Each case sends through the real sendMessage action and reads the copy kept in Sent.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { encodeReply } from "react-server-dom-webpack/client.edge";
import { BASE, q, sha256, startWorker } from "./harness.mjs";

let mf, db, request;
const SESSION = "session-composer";

before(async () => {
  const t = Date.now();
  ({ mf, db, request } = await startWorker(
    [
      `INSERT INTO domains (id, name, active, created_at) VALUES ('d1', 'alpha.test', 1, ${t});`,
      `INSERT INTO mailboxes (id, address, display_name, active, created_at) VALUES ('mb1', 'hello@alpha.test', 'Hello', 1, ${t});`,
      `INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('u1', 'u1@alpha.test', 'U', 'x', 'member', ${t});`,
      `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (${q(sha256(SESSION))}, 'u1', ${t + 3600e3}, ${t});`,
      `INSERT INTO mailbox_members (mailbox_id, user_id) VALUES ('mb1', 'u1');`,
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

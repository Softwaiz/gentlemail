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
/** Sends through the composer's action; returns the stored Sent copy. */
async function send(fields) {
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
      "<ol><li>first</li><li>second</li></ol>",
      '<a href="https://example.com/a?b=1&amp;c=2">the site</a>',
      '<a href="mailto:anna@example.com">',
    ])
      assert.ok(html_body.includes(part), `${part} missing from ${html_body}`);
    assert.match(html_body, /<blockquote style="[^"]*border-left[^"]*">quoted<\/blockquote>/);
    assert.match(html_body, /<code style="[^"]*monospace[^"]*">npm test<\/code>/);
    assert.ok(!/<strong><strong>|<b>|<i>|class=|dir=|value=|rel=|white-space/.test(html_body), html_body);

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
    assert.ok(html_body.includes("<p>hello</p>"), html_body);
    assert.ok(html_body.includes("js link") && html_body.includes("data link") && html_body.includes("kept text") && html_body.includes("heading text"));
    assert.ok(!text_body.includes("alert") && !text_body.includes("color:red"), text_body);
    assert.match(text_body, /^hello\njs link data link spaced/);
  });

  test("keeps the text people typed, markup characters included", async () => {
    const { html_body, text_body } = await send({ html: "<p>if a &lt; b &amp;&amp; c &gt; d: &lt;script&gt;</p><p><br></p><p>bye</p>" });
    assert.ok(html_body.includes("<p>if a &lt; b &amp;&amp; c &gt; d: &lt;script&gt;</p>"), html_body);
    assert.equal(text_body, "if a < b && c > d: <script>\n\nbye");
  });

  test("a nested list keeps its numbering", async () => {
    const { text_body } = await send({
      html: '<ol><li value="1">one</li><li value="2"><ol><li value="1">one.a</li></ol></li><li value="2">two</li></ol>',
    });
    assert.equal(text_body, "1. one\n  1. one.a\n2. two");
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

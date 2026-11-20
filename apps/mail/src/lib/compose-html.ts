/*
 * The HTML the webmail's composer posts, made safe to send.
 *
 * The browser can post anything, so this keeps only what the composer's toolbar
 * makes: paragraphs and line breaks, bold, italic, underline, strikethrough,
 * subscript, superscript, links, lists, quotes and inline code. Every attribute
 * goes, except a link's address when it is http, https or mailto. Script-like
 * elements go with their content; any other element is replaced by its content.
 * Quotes and code get inline styles, the only styling mail clients keep.
 *
 * Programs sending HTML through the API are not cleaned: their key holder chose it.
 */

import { isSendableUrl } from "@/lib/links";

/** Tags kept, after renaming (b → strong, i → em, strike and del → s). */
const KEEP = new Set(["p", "br", "strong", "em", "u", "s", "sub", "sup", "a", "ul", "ol", "li", "blockquote", "code"]);
const RENAME: Record<string, string> = { b: "strong", i: "em", strike: "s", del: "s" };
/**
 * Removed with everything inside them. Some (xmp, noembed, noframes, plaintext, listing,
 * textarea, title…) hold their content as text: unwrapped, that text would turn back into
 * markup, so they must go whole.
 */
const DROP = [
  "script", "style", "noscript", "template", "iframe", "frame", "frameset", "object", "embed", "applet",
  "svg", "math", "head", "title", "textarea", "select", "button", "input", "img", "video", "audio", "picture",
  "link", "meta", "base", "xmp", "noembed", "noframes", "plaintext", "listing",
];

const STYLE: Record<string, string> = {
  // Each Enter is a paragraph: without this, mail clients add their own margins and the message looks double-spaced.
  p: "margin:0",
  blockquote: "margin:0 0 0 0.8ex;border-left:2px solid #ccc;padding-left:1ex;color:#555",
  code: "font-family:Menlo,Consolas,monospace;font-size:90%;background:#f2f2f2;padding:0 3px;border-radius:3px",
};

/**
 * At most this many UTF-8 bytes of cleaned composer HTML and its plain text are sent
 * (bytes, as D1 counts them: a Chinese character is 3). Well under what a Sent row keeps,
 * which also holds the signature and the quoted message.
 */
export const COMPOSER_HTML_LIMIT = 500_000;
/**
 * At most this many characters are taken from the browser. The editor's own HTML carries a
 * class and a style on every run of text, so it can be many times longer than once cleaned.
 */
export const COMPOSER_RAW_LIMIT = 10 * COMPOSER_HTML_LIMIT;

/** Keeps only the composer's own formatting. */
export async function cleanComposerHtml(html: string): Promise<string> {
  const rewriter = new HTMLRewriter()
    .on(DROP.join(", "), {
      element: (el) => {
        el.remove();
      },
    })
    .on("*", {
      element: (el) => {
        if (el.removed) return;
        const tag = el.tagName.toLowerCase();
        if (RENAME[tag]) {
          // Same meaning, one spelling: the content, wrapped in the kept tag.
          el.before(`<${RENAME[tag]}>`, { html: true });
          el.after(`</${RENAME[tag]}>`, { html: true });
          el.removeAndKeepContent();
          return;
        }
        if (!KEEP.has(tag)) {
          el.removeAndKeepContent();
          return;
        }
        const href = tag === "a" ? (el.getAttribute("href") ?? "").trim() : "";
        // A numbered list's numbers: where it starts, and each item's own (Lexical numbers
        // every item; balance() drops the number of an item in a bulleted list).
        const number = (tag === "ol" ? el.getAttribute("start") : tag === "li" ? el.getAttribute("value") : null)?.trim() ?? "";
        for (const [name] of [...(el.attributes as unknown as Iterable<[string, string]>)]) el.removeAttribute(name);
        if (tag === "a") {
          if (isSendableUrl(href)) el.setAttribute("href", href);
          else el.removeAndKeepContent();
        }
        if (/^\d{1,6}$/.test(number)) el.setAttribute(tag === "ol" ? "start" : "value", String(Number(number)));
        if (STYLE[tag]) el.setAttribute("style", STYLE[tag]);
      },
    })
    .onDocument({
      comments: (c) => {
        c.remove();
      },
      // A bare < or > in the text (not escaped by whoever posted it) is escaped here, so it
      // can't be read as the start of a tag later on.
      text: (t) => {
        if (/[<>]/.test(t.text)) t.replace(t.text.replace(/</g, "&lt;").replace(/>/g, "&gt;"), { html: true });
      },
    });
  const out = await rewriter
    .transform(new Response(html.replace(/<!doctype[^>]*>/gi, ""), { headers: { "content-type": "text/html; charset=utf-8" } }))
    .text();
  return keepSpaces(balance(out))
    // Lexical writes bold as <b><strong>…</strong></b>: once renamed, the same tag twice.
    .replace(/<(strong|em|s|u)><\1>((?:(?!<\/?\1>)[\s\S])*)<\/\1><\/\1>/g, "<$1>$2</$1>")
    // A nested list sits in an item of its own, which the editor shows without a marker.
    .replace(/<li( value="\d+")?>(?=<[uo]l\b)/g, '<li$1 style="list-style:none">');
}

/** Tags after which only another block can follow: a list's start, or a block's end. */
const BETWEEN_BLOCKS = /^<(\/(p|li|ul|ol|blockquote)|ul|ol)\b/i;

/** Tags after which a space starts a line, where mail clients would drop it. */
const LINE_START = /^<\/?(p|br|li|ul|ol|blockquote)\b/i;

/**
 * The editor keeps repeated spaces and tabs with a white-space style, which goes: keep
 * them as non-breaking spaces instead. Done on the whole output, so a run split across
 * text chunks or around an inline tag (bold, a link…) still counts as one run.
 */
function keepSpaces(html: string): string {
  let afterSpace = true;
  let betweenBlocks = false;
  return html.replace(/<[^>]*>|[^<]+/g, (token) => {
    if (token[0] === "<") {
      if (LINE_START.test(token)) afterSpace = true;
      betweenBlocks = BETWEEN_BLOCKS.test(token);
      return token;
    }
    // Spaces between two blocks (only hand-written HTML has them) aren't text: as
    // non-breaking spaces they would show as a line of their own.
    if (betweenBlocks && /^\s*$/.test(token)) return token;
    // A line break in the source and the indentation after it are layout, not typed
    // spaces (the editor writes its line breaks as <br>): left as they are.
    let out = "";
    for (const ch of token.replace(/\n[ \t]+/g, "\n").replace(/\t/g, "    ")) {
      if (ch === " ") {
        out += afterSpace ? "&nbsp;" : " ";
        afterSpace = true;
      } else {
        out += ch;
        afterSpace = false;
      }
    }
    return out;
  });
}

/** Opening one of these ends a paragraph left open, as browsers read HTML. */
const ENDS_P = new Set(["p", "ul", "ol", "li", "blockquote"]);

/**
 * Closes what was left open and drops end tags that close nothing, so an unclosed link
 * can't take in the signature and the quoted message added after it. A new paragraph or
 * list item first closes the one left open before it, as browsers do, rather than going
 * inside it. The input holds only kept tags, with attributes this file wrote.
 */
function balance(html: string): string {
  const open: string[] = [];
  const close = (from: number) => open.splice(from).reverse().map((t) => `</${t}>`).join("");
  const out = html.replace(/<(\/?)([a-z]+)\b[^>]*>/gi, (tag, slash: string, name: string) => {
    const n = name.toLowerCase();
    if (n === "br") return tag;
    if (!slash) {
      let before = "";
      // Down to the open paragraph, wherever it is: an unclosed link inside it goes too.
      const p = open.lastIndexOf("p");
      if (ENDS_P.has(n) && p >= 0) before += close(p);
      if (n === "li") {
        // The item left open in the same list, and anything inline still open in it.
        const list = Math.max(open.lastIndexOf("ul"), open.lastIndexOf("ol"));
        const item = open.lastIndexOf("li");
        if (item > list) before += close(item);
        // Only a numbered list's items keep their number.
        if (open.at(-1) !== "ol") tag = tag.replace(/ value="\d+"/, "");
      }
      open.push(n);
      return before + tag;
    }
    const at = open.lastIndexOf(n);
    if (at < 0) return "";
    return close(at);
  });
  return out + close(0);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/**
 * The plain-text version of cleaned composer HTML: a paragraph per line, "- " and
 * "1. " for list items, "> " for quotes and "text (address)" for links.
 */
export function composerText(clean: string): string {
  const out: string[] = [];
  let line = "";
  let quote = 0;
  const lists: { ordered: boolean; n: number }[] = [];
  let link: { href: string; label: string } | null = null;
  let afterBr = false;
  const prefix = () => "> ".repeat(quote);
  const endLine = () => {
    out.push(prefix() + line.trimEnd()); // not /\s+$/: slow on a long run of spaces
    line = "";
  };

  for (const [token] of clean.matchAll(/<\/?[a-z][^>]*>|<|[^<]+/gi)) {
    if (token === "<" || token[0] !== "<") {
      // Spaces between two blocks (hand-written HTML) aren't text. Typed ones arrive as &nbsp;.
      if (!line && /^\s+$/.test(token)) continue;
      // A line break in the source reads as a space, but not at the start of a line.
      let text = decode(token.replace(/[ \t]*[\r\n]+[ \t]*/g, "\n"));
      if (text.includes("\n")) {
        text = text.replace(/\n+/g, " ");
        if (/(^|\s)$/.test(line)) text = text.replace(/^ /, "");
      }
      line += text;
      if (link) link.label += text;
      continue;
    }
    const m = /^<(\/?)([a-z0-9]+)/i.exec(token);
    if (!m) continue;
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const justBr = afterBr;
    afterBr = tag === "br";
    switch (tag) {
      case "br":
        endLine();
        if (link) link.label += " ";
        break;
      case "p":
        // Text left before it (from a block that was unwrapped) is a line of its own.
        if (!closing && line.trim() && !/^\s*(- |\d+\. )$/.test(line)) endLine();
        // <p><br></p> is one empty line, not two.
        if (closing && !(justBr && !line)) endLine();
        break;
      case "blockquote":
        if (line) endLine();
        quote += closing ? -1 : 1;
        quote = Math.max(quote, 0);
        break;
      case "ul":
      case "ol":
        if (!closing && /^\s*(- |\d+\. )$/.test(line)) {
          // A list nested in an item of its own: that item gets no marker, nor a number.
          const parent = lists[lists.length - 1];
          if (parent?.ordered) parent.n--;
          line = "";
        }
        if (line) endLine();
        if (closing) lists.pop();
        else lists.push({ ordered: tag === "ol", n: Number(/start="(\d+)"/.exec(token)?.[1] ?? 1) - 1 });
        break;
      case "li": {
        if (closing) {
          if (line.trim()) endLine();
          else line = "";
          break;
        }
        if (line) endLine();
        const list = lists[lists.length - 1];
        const value = /value="(\d+)"/.exec(token)?.[1];
        if (list && value) list.n = Number(value) - 1;
        const indent = "  ".repeat(Math.max(lists.length - 1, 0));
        line = indent + (list?.ordered ? `${++list.n}. ` : "- ");
        break;
      }
      case "a":
        if (!closing) {
          const href = /href="([^"]*)"/i.exec(token)?.[1];
          link = href ? { href: decode(href), label: "" } : null;
        } else if (link) {
          // The link's own text, even when a line break inside it ended the line.
          const label = link.label.replace(/\s+/g, " ").trim();
          const shown = link.href.replace(/^mailto:/i, "");
          if (label !== shown && label !== link.href) line += ` (${shown})`;
          link = null;
        }
        break;
    }
  }
  if (line) endLine();
  // Empty lines the user typed stay; only those at the very start and end go.
  return out.join("\n").replace(/^(?:[ \t]*\n)+/, "").trimEnd();
}

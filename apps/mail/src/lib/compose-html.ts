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
/** Same rule as the editor's (components/rich-editor.tsx): web and email addresses. */
const SAFE_HREF = /^(https?:\/\/|mailto:)[^\s"<>]+$/i;

const STYLE: Record<string, string> = {
  // Each Enter is a paragraph: without this, mail clients add their own margins and the message looks double-spaced.
  p: "margin:0",
  blockquote: "margin:0 0 0 0.8ex;border-left:2px solid #ccc;padding-left:1ex;color:#555",
  code: "font-family:Menlo,Consolas,monospace;font-size:90%;background:#f2f2f2;padding:0 3px;border-radius:3px",
};

/** At most this many characters of composer HTML are accepted. */
export const COMPOSER_HTML_LIMIT = 1_000_000;

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
        for (const [name] of [...(el.attributes as unknown as Iterable<[string, string]>)]) el.removeAttribute(name);
        if (tag === "a") {
          if (SAFE_HREF.test(href)) el.setAttribute("href", href);
          else el.removeAndKeepContent();
        }
        if (STYLE[tag]) el.setAttribute("style", STYLE[tag]);
      },
    })
    .onDocument({
      comments: (c) => {
        c.remove();
      },
      // The editor keeps repeated spaces and tabs with a white-space style, which goes:
      // keep them as non-breaking spaces instead. (Text arrives as written, entities included.)
      text: (t) => {
        if (/ {2}|\t/.test(t.text)) t.replace(t.text.replace(/\t/g, "    ").replace(/ {2,}/g, (run) => " " + "&nbsp;".repeat(run.length - 1)), { html: true });
      },
    });
  const out = await rewriter
    .transform(new Response(html.replace(/<!doctype[^>]*>/gi, ""), { headers: { "content-type": "text/html; charset=utf-8" } }))
    .text();
  // Lexical writes bold as <b><strong>…</strong></b>: once renamed, the same tag twice.
  return balance(out).replace(/<(strong|em|s|u)><\1>((?:(?!<\/?\1>)[\s\S])*)<\/\1><\/\1>/g, "<$1>$2</$1>");
}

/**
 * Closes what was left open and drops end tags that close nothing, so an unclosed link
 * can't take in the signature and the quoted message added after it. The input holds
 * only kept tags, with attributes this file wrote.
 */
function balance(html: string): string {
  const open: string[] = [];
  const out = html.replace(/<(\/?)([a-z]+)\b[^>]*>/gi, (tag, slash: string, name: string) => {
    const n = name.toLowerCase();
    if (n === "br") return tag;
    if (!slash) {
      open.push(n);
      return tag;
    }
    const at = open.lastIndexOf(n);
    if (at < 0) return "";
    return open.splice(at).reverse().map((t) => `</${t}>`).join("");
  });
  return out + open.reverse().map((t) => `</${t}>`).join("");
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
  let link: { href: string; start: number } | null = null;
  let afterBr = false;
  const prefix = () => "> ".repeat(quote);
  const endLine = () => {
    out.push(prefix() + line.replace(/\s+$/, ""));
    line = "";
  };

  for (const [token] of clean.matchAll(/<[^>]*>|[^<]+/g)) {
    if (token[0] !== "<") {
      line += decode(token).replace(/[\r\n]+/g, " ");
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
        break;
      case "p":
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
        else lists.push({ ordered: tag === "ol", n: 0 });
        break;
      case "li": {
        if (closing) {
          if (line.trim()) endLine();
          else line = "";
          break;
        }
        if (line) endLine();
        const list = lists[lists.length - 1];
        const indent = "  ".repeat(Math.max(lists.length - 1, 0));
        line = indent + (list?.ordered ? `${++list.n}. ` : "- ");
        break;
      }
      case "a":
        if (!closing) {
          const href = /href="([^"]*)"/i.exec(token)?.[1];
          link = href ? { href: decode(href), start: line.length } : null;
        } else if (link) {
          const label = line.slice(link.start).trim();
          const shown = link.href.replace(/^mailto:/i, "");
          if (label !== shown && label !== link.href) line += ` (${shown})`;
          link = null;
        }
        break;
    }
  }
  if (line) endLine();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

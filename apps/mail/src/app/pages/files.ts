import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { notFound } from "@/app/http";
import { type AttachmentRow, getHtmlBody, getMessageForUser, listAttachments } from "@/lib/db";
import { escapeHtml, htmlHasOwnColors } from "@/lib/util";

const disposition = (type: "inline" | "attachment", filename: string) => {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};

const INLINE_SAFE = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf|text\/plain)/i;

/** GET /attachments/:id — download (or ?inline=1 to view safe types). */
export async function attachmentHandler({ params, ctx, request }: RequestInfo) {
  const att = await env.DB.prepare("SELECT * FROM attachments WHERE id = ?")
    .bind(params.id)
    .first<AttachmentRow>();
  if (!att) return notFound();
  if (!(await getMessageForUser(ctx.user!, att.message_id))) return notFound();

  const obj = await env.MAIL_BUCKET.get(att.r2_key);
  if (!obj) return notFound();

  const wantsInline = new URL(request.url).searchParams.get("inline") === "1";
  const inline = wantsInline && INLINE_SAFE.test(att.content_type);
  const headers = new Headers({
    "Content-Type": inline ? att.content_type : "application/octet-stream",
    "Content-Disposition": disposition(inline ? "inline" : "attachment", att.filename),
    "Content-Length": String(obj.size),
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  if (!/pdf/i.test(att.content_type)) {
    headers.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  }
  return new Response(obj.body, { headers });
}

/** GET /raw/:id — original .eml */
export async function rawHandler({ params, ctx }: RequestInfo) {
  const found = await getMessageForUser(ctx.user!, params.id);
  if (!found?.msg.raw_key) return notFound();
  const obj = await env.MAIL_BUCKET.get(found.msg.raw_key);
  if (!obj) return notFound();
  const name = (found.msg.subject || "message").replace(/[^\w\- ]+/g, "").slice(0, 60) || "message";
  return new Response(obj.body, {
    headers: {
      "Content-Type": "message/rfc822",
      "Content-Disposition": disposition("attachment", `${name}.eml`),
    },
  });
}

// URL attributes that must never carry script.
const URL_ATTRS = new Set(["href", "src", "action", "formaction", "xlink:href", "background", "poster", "srcset", "data"]);
const BAD_URL = /^\s*(javascript|vbscript|data:(?!image\/(png|jpe?g|gif|webp|avif|bmp);))/i;

/**
 * Third line of defence (after the iframe sandbox and CSP): strip anything
 * executable with a real HTML parser before the mail ever reaches a browser.
 */
async function sanitize(html: string): Promise<string> {
  const rewriter = new HTMLRewriter()
    .on("script, noscript, iframe, frame, frameset, object, embed, applet, base, link, meta, portal, template", {
      element: (el) => {
        el.remove();
      },
    })
    // Forms can't submit (CSP + sandbox), but keep their visible text.
    .on("form", {
      element: (el) => {
        el.removeAndKeepContent();
      },
    })
    .on("*", {
      element: (el) => {
        for (const [name, value] of [...(el.attributes as unknown as Iterable<[string, string]>)]) {
          const n = name.toLowerCase();
          if (n.startsWith("on") || n === "formaction" || n === "srcdoc" || n === "http-equiv") el.removeAttribute(name);
          else if (URL_ATTRS.has(n) && BAD_URL.test(value)) el.removeAttribute(name);
        }
      },
    });
  return rewriter.transform(new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })).text();
}

/**
 * GET /body/:id: HTML body of a message, shown in a sandboxed iframe.
 * Three layers keep mail inert: HTML sanitising, a CSP with no scripts and a
 * sandbox (sent as both iframe attribute and CSP directive, so it also holds
 * when the URL is opened directly). Remote content only with ?images=1.
 */
export async function bodyHandler({ params, ctx, request }: RequestInfo) {
  const found = await getMessageForUser(ctx.user!, params.id);
  if (!found) return notFound();
  const { msg } = found;
  const allowRemote = new URL(request.url).searchParams.get("images") === "1";

  const raw = (await getHtmlBody(msg)) ?? `<pre>${escapeHtml(msg.text_body ?? "")}</pre>`;
  let html = await sanitize(raw);

  // Point cid: references at our attachment endpoint.
  const atts = await listAttachments([msg.id]);
  const byCid = new Map(atts.filter((a) => a.content_id).map((a) => [a.content_id!.toLowerCase(), a.id]));
  html = html.replace(/cid:([^"'\s)>]+)/gi, (whole, cid: string) => {
    const id = byCid.get(decodeURIComponent(cid).toLowerCase());
    return id ? `/attachments/${id}?inline=1` : whole;
  });

  const remote = allowRemote ? " https: http:" : "";
  const csp = [
    "sandbox allow-same-origin allow-popups allow-popups-to-escape-sandbox",
    "default-src 'none'",
    `img-src 'self' data:${remote}`,
    `style-src 'unsafe-inline'${remote}`,
    `font-src data:${remote}`,
    "script-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
    "base-uri 'none'",
  ].join("; ");

  // Mail with its own colours keeps the white page it was designed for;
  // everything else follows the reader's light/dark theme.
  const adaptive = !htmlHasOwnColors(raw);
  const theme = adaptive
    ? `:root{color-scheme:light dark}html,body{background:transparent;color:CanvasText}a{color:LinkText}blockquote{border-color:color-mix(in srgb,CanvasText 25%,transparent);color:color-mix(in srgb,CanvasText 70%,transparent)}`
    : `:root{color-scheme:light}html,body{background:#fff;color:#1d1d1f}blockquote{border-color:#ccc;color:#555}`;

  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<meta name="referrer" content="no-referrer">${adaptive ? '<meta name="color-scheme" content="light dark">' : ""}
<style>${theme}html,body{margin:0;padding:0}body{padding:4px 2px;font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap;font:inherit}blockquote{margin:0 0 0 .8ex;border-left:2px solid;padding-left:1ex}</style>
</head><body>${html}</body></html>`;

  return new Response(doc, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "X-Frame-Options": "SAMEORIGIN",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

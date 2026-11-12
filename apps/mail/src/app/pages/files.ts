import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { notFound } from "@/app/http";
import { type AttachmentRow, getHtmlBody, getMessageForUser, listAttachments } from "@/lib/db";
import { escapeHtml } from "@/lib/util";

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

/**
 * GET /body/:id — HTML body of a message, meant for a sandboxed iframe.
 * Scripts are blocked by CSP; remote images only with ?images=1.
 */
export async function bodyHandler({ params, ctx, request }: RequestInfo) {
  const found = await getMessageForUser(ctx.user!, params.id);
  if (!found) return notFound();
  const { msg } = found;
  const allowRemote = new URL(request.url).searchParams.get("images") === "1";

  let html = (await getHtmlBody(msg)) ?? `<pre>${escapeHtml(msg.text_body ?? "")}</pre>`;

  // Drop meta refresh/redirect tricks.
  html = html.replace(/<meta[^>]*http-equiv[^>]*>/gi, "");

  // Point cid: references at our attachment endpoint.
  const atts = await listAttachments([msg.id]);
  const byCid = new Map(atts.filter((a) => a.content_id).map((a) => [a.content_id!.toLowerCase(), a.id]));
  html = html.replace(/cid:([^"'\s)>]+)/gi, (whole, cid: string) => {
    const id = byCid.get(decodeURIComponent(cid).toLowerCase());
    return id ? `/attachments/${id}?inline=1` : whole;
  });

  const remote = allowRemote ? " https: http:" : "";
  const csp = [
    "default-src 'none'",
    `img-src 'self' data:${remote}`,
    `style-src 'unsafe-inline'${remote}`,
    `font-src data:${remote}`,
    "script-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
    "base-uri 'none'",
  ].join("; ");

  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<meta name="referrer" content="no-referrer">
<style>html,body{margin:0;padding:0;background:#fff;color:#1d1d1f}body{padding:4px 2px;font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap}blockquote{margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex;color:#555}</style>
</head><body>${html}</body></html>`;

  return new Response(doc, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "X-Frame-Options": "SAMEORIGIN",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

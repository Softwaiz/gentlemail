import { env } from "cloudflare:workers";
import { cleanComposerHtml, composerText } from "./compose-html";
import type { Mailbox } from "./db";
import { isSendableUrl } from "./links";
import type { OutgoingFile } from "./outbound";
import { LOGO_DEFAULT, LOGO_MAX, LOGO_MIN, type SignatureLook, signatureBlock } from "./signature-html";
import { byteLength, newId } from "./util";

/* A mailbox's signature: saving it, and adding it to what the mailbox sends. */

export const LOGO_LIMIT = 200 * 1024;
/** UTF-8 bytes of cleaned HTML. The plain text keeps the 5,000 characters it always had. */
export const SIGNATURE_LIMIT = 20_000;
/** What is taken from the browser: the editor's HTML is many times longer than once cleaned. */
const RAW_LIMIT = 10 * SIGNATURE_LIMIT;
const TEXT_LIMIT = 5000;

export const hasSignature = (m: Mailbox) => !!(m.signature.trim() || m.logo_key);

/** How the signature looks, with its logo at `logoSrc`. */
export function signatureLook(m: Mailbox, logoSrc: string | null): SignatureLook {
  return {
    // Columns a database not migrated yet doesn't have read as undefined: plain text, with the line.
    html: m.signature_html ?? "",
    text: m.signature.trim(),
    line: m.signature_line !== 0,
    logo:
      m.logo_key && logoSrc
        ? { src: logoSrc, width: m.logo_width, ratio: m.logo_ratio ?? 1, link: m.logo_link, position: m.logo_position, alt: m.display_name }
        : null,
  };
}

/** Where the webmail shows a mailbox's logo. The key changes with the image, so the address does too. */
export const logoUrl = (m: Mailbox) => (m.logo_key ? `/signature-logo/${m.id}?v=${m.logo_key.split("/").pop()}` : null);

/** The signature as sent: its HTML, its plain text, and its logo to send inside the message. */
export async function outgoingSignature(m: Mailbox): Promise<{ html: string; text: string; files: OutgoingFile[] }> {
  const files: OutgoingFile[] = [];
  if (m.logo_key) {
    const obj = await env.MAIL_BUCKET.get(m.logo_key);
    const type = m.logo_type ?? "image/png";
    if (obj) files.push({ filename: `logo.${EXTENSION[type] ?? "png"}`, type, content: await obj.arrayBuffer(), contentId: `logo-${newId()}` });
  }
  const look = signatureLook(m, files.length ? `cid:${files[0].contentId}` : null);
  // A logo alone is named in the plain text, where it can't be shown.
  return { html: signatureBlock(look), text: look.text || (look.logo ? look.logo.alt : ""), files };
}

const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" };

/** What an image is, from its own bytes: PNG, JPEG and GIF, the ones mail apps show. Null for anything else. */
export function readImage(buf: ArrayBuffer): { type: string; width: number; height: number } | null {
  const b = new Uint8Array(buf);
  const v = new DataView(buf);
  const size = (type: string, width: number, height: number) => (width > 0 && height > 0 ? { type, width, height } : null);
  if (b.length >= 24 && v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a) return size("image/png", v.getUint32(16), v.getUint32(20));
  if (b.length >= 10 && /^GIF8[79]a$/.test(String.fromCharCode(...b.subarray(0, 6)))) return size("image/gif", v.getUint16(6, true), v.getUint16(8, true));
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // Segments, up to the one that starts the frame and holds its size.
    for (let i = 2; i + 9 <= b.length; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return size("image/jpeg", v.getUint16(i + 7), v.getUint16(i + 5));
      const length = v.getUint16(i + 2);
      if (length < 2) return null;
      i += 2 + length;
    }
  }
  return null;
}

export type SignatureProblem = "too_long" | "logo_type" | "logo_size" | "logo_link";

/**
 * Reads the signature fields of a form (components/signature-fields.tsx). Nothing is stored yet:
 * `save` stores the new logo and gives the statement to run, `done` removes the logo it replaced.
 */
export async function readSignature(form: FormData, m: Mailbox): Promise<{ problem: SignatureProblem } | { problem: null; save: () => Promise<{ statement: D1PreparedStatement; done: () => Promise<void> }> }> {
  let text = m.signature;
  let html = m.signature_html;
  const raw = form.get("signature_html");
  const plain = form.get("body") ?? form.get("signature");
  if (typeof raw === "string") {
    if (raw.length > RAW_LIMIT) return { problem: "too_long" };
    // Without the colours a message's quotes and code get: the signature takes its message's.
    html = (await cleanComposerHtml(raw)).replace(/<(blockquote|code) style="[^"]*">/g, (tag) => tag.replace(";color:#555", "").replace("background:#f2f2f2;", ""));
    text = composerText(html);
    if (!text) html = "";
    if (byteLength(html) > SIGNATURE_LIMIT || text.length > TEXT_LIMIT) return { problem: "too_long" };
  } else if (typeof plain === "string" && (form.has("body") || !m.signature_html)) {
    // The editor failed and a plain field took over ("body"). Or a page opened before this
    // version ("signature"): it can change a plain signature, but not flatten a formatted one.
    text = plain.slice(0, TEXT_LIMIT);
    html = "";
  }

  const own = form.get("signature_fields") === "1";
  const line = own ? (form.get("signature_line") === "on" ? 1 : 0) : m.signature_line;
  const width = own ? Math.min(LOGO_MAX, Math.max(LOGO_MIN, Math.round(Number(form.get("logo_width")) || LOGO_DEFAULT))) : m.logo_width;
  const position = own ? (form.get("logo_position") === "above" ? "above" : "left") : m.logo_position;
  const file = form.get("logo");
  const upload = file && typeof file !== "string" && file.size ? file : null;
  const removed = form.get("logo_remove") === "1" && !upload;
  let link = m.logo_link;
  if (own) {
    link = String(form.get("logo_link") ?? "").trim();
    if (link && !/^(https?:|mailto:)/i.test(link)) link = `https://${link}`;
    if (link && !isSendableUrl(link)) return { problem: "logo_link" };
  }

  let key = removed ? null : m.logo_key;
  let type = m.logo_type;
  let ratio = m.logo_ratio;
  let bytes: ArrayBuffer | null = null;
  if (upload) {
    if (upload.size > LOGO_LIMIT) return { problem: "logo_size" };
    bytes = await upload.arrayBuffer();
    const image = readImage(bytes);
    if (!image) return { problem: "logo_type" };
    type = image.type;
    ratio = image.height / image.width;
    // Under att/<mailbox>/, so it goes when the mailbox is deleted.
    key = `att/${m.id}/signature/${newId()}`;
  }

  return {
    problem: null,
    save: async () => {
      if (bytes && key) await env.MAIL_BUCKET.put(key, bytes, { httpMetadata: { contentType: type ?? "image/png" } });
      return {
        statement: env.DB.prepare(
          `UPDATE mailboxes SET signature = ?, signature_html = ?, signature_line = ?, logo_key = ?, logo_type = ?, logo_ratio = ?,
             logo_width = ?, logo_link = ?, logo_position = ? WHERE id = ?`,
        ).bind(text, html, line, key, key ? type : null, key ? ratio : null, width, link, position, m.id),
        done: async () => {
          if (m.logo_key && m.logo_key !== key) await env.MAIL_BUCKET.delete(m.logo_key);
        },
      };
    },
  };
}

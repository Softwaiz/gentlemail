import { t } from "@lingui/core/macro";
import { i18n } from "@/lib/i18n";
export type Addr = { name: string; address: string };

export const newId = () => crypto.randomUUID();

/** A JSON response. The one helper for it, on every route. */
export const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
export const now = () => Date.now();
/** Base64url without padding (tokens, PKCE). */
export const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** "a@Example.com" → "example.com". The one definition, shared by the server and the key editor. */
export const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain text -> simple HTML (escaped, line breaks kept, URLs linked). */
export function textToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\r?\n/g, "<br>\n");
}

/** Rough HTML -> text, used for snippets and quoting when no text part exists. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function makeSnippet(text: string | undefined | null, html?: string | null): string {
  const t = text && text.trim() ? text : html ? htmlToText(html) : "";
  return t.replace(/\s+/g, " ").trim().slice(0, 200);
}

export const stripBrackets = (id?: string | null) =>
  id ? id.trim().replace(/^<|>$/g, "") : null;

/** Parse "a@b.com, Name <c@d.com>" into addresses. */
export function parseAddressList(input: string): Addr[] {
  return input
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.*)<([^>]+)>$/);
      if (m) return { name: m[1].trim().replace(/^"|"$/g, ""), address: m[2].trim() };
      return { name: "", address: part };
    });
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const isEmail = (s: string) => EMAIL_RE.test(s);

export const formatAddr = (a: Addr) => (a.name ? `${a.name} <${a.address}>` : a.address);

export function normalizeSubject(s: string): string {
  return s.replace(/^\s*((re|fwd?|tr|aw)\s*:\s*)+/i, "").trim().toLowerCase();
}

export function formatBytes(n: number): string {
  const num = (v: number, digits: number) => v.toLocaleString(dateLocale(), { maximumFractionDigits: digits, minimumFractionDigits: digits });
  if (n < 1024) return t({ id: "size.bytes", message: `${n} B` });
  if (n < 1024 * 1024) return t({ id: "size.kb", message: `${num(n / 1024, 0)} KB` });
  return t({ id: "size.mb", message: `${num(n / 1024 / 1024, 1)} MB` });
}

/** The locale dates and numbers are written in: the reader's language (day before month in English, as before). */
export const dateLocale = () => (i18n.locale === "fr" ? "fr-FR" : "en-GB");

export function formatDate(ms: number, full = false): string {
  const d = new Date(ms);
  if (full) {
    return d.toLocaleString(dateLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }) + " UTC";
  }
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  }
  return d.toLocaleDateString(dateLocale(), { day: "numeric", month: "short", timeZone: "UTC" });
}

/** A date written into mail that goes out: always in English, like the words around it, whoever's language the page is in. */
export const mailDate = (ms: number) => `${new Date(ms).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;

export function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * True when an HTML email paints its own colours. Those are designed for a
 * white page and stay on white; plain HTML follows the reader's theme.
 */
export const htmlHasOwnColors = (html: string) =>
  /\bbgcolor\s*=|\bbackground(-color)?\s*:|(^|[\s;"'{])color\s*:|<font[^>]*\bcolor\s*=|<body[^>]*\b(text|link)\s*=/i.test(html);

/** D1 allows 100 bound values per query: split id lists (leaving room for a few other values). */
export const chunks = <T>(list: T[], size = 90): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/**
 * Largest body text or HTML kept in a message's row, in UTF-8 bytes: D1 limits a row to
 * 2 MB, and a message keeps both. Larger HTML goes to storage (html_key); text is cut.
 */
export const D1_TEXT_LIMIT = 900_000;

const utf8 = new TextEncoder();
/** Size in UTF-8 bytes, as D1 counts it: a Chinese character is 3. */
export const byteLength = (s: string) => utf8.encode(s).length;

/** The text cut to at most this many UTF-8 bytes, without splitting a character. */
export function clipBytes(s: string, max: number): string {
  const bytes = utf8.encode(s);
  if (bytes.length <= max) return s;
  return new TextDecoder().decode(bytes.subarray(0, max)).replace(/\uFFFD$/, "");
}

/** Body text for a message's row: cut, with a note, when it's over D1_TEXT_LIMIT. */
export function rowText(text: string): string {
  const note = "\n\n[…truncated — full message kept in storage]";
  return byteLength(text) > D1_TEXT_LIMIT ? clipBytes(text, D1_TEXT_LIMIT - byteLength(note)) + note : text;
}

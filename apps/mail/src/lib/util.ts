export type Addr = { name: string; address: string };

export const newId = () => crypto.randomUUID();
export const now = () => Date.now();

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
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(ms: number, full = false): string {
  const d = new Date(ms);
  if (full) {
    return d.toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }) + " UTC";
  }
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  }
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

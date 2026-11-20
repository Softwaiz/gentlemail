/*
 * What the composer lets a link point to, the same in the editor (components/rich-editor.tsx)
 * and when the message is sent (lib/compose-html.ts): a web address on a domain name, or an
 * email address. Nothing else (tel:, sms:, javascript:…) is ever sent as a link.
 *
 * Web addresses need a domain name with a dot and a real last label: IP addresses and
 * single names (http://192.168.1.10, localhost) are refused on purpose. They only work on
 * the sender's own network, and a phone number typed in the link card ("+336…") must not
 * become https://+336….
 */

const MAILTO = /^mailto:[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$/i;
const WEB = /^https?:\/\/[^\s"<>]+$/i;
// URL gives non-ASCII names as punycode, so the last label can be "xn--p1ai".
const DOMAIN = /^([a-z0-9-]+\.)+([a-z]{2,}|xn--[a-z0-9-]+)$/i;

/** Whether a link may point to this address. */
export function isSendableUrl(url: string): boolean {
  if (MAILTO.test(url)) return true;
  if (!WEB.test(url)) return false;
  try {
    return DOMAIN.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * A web address found in running text, without the punctuation after it: "…/Mercury_(planet)"
 * keeps its closing bracket, "(see https://a.com/x)" doesn't, nor a closing quote or full stop.
 */
export function trimUrlEnd(url: string): string {
  let end = url.length;
  for (;;) {
    const c = url[end - 1];
    if (/[.,;:!?'"*]/.test(c)) end--;
    else if ((c === ")" || c === "]") && count(url.slice(0, end), c === ")" ? "(" : "[") < count(url.slice(0, end), c)) end--;
    else break;
  }
  return url.slice(0, end);
}

const count = (s: string, c: string) => s.split(c).length - 1;

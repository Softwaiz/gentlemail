/*
 * A mailbox's signature as HTML, the same wherever it appears: in the sent email, in the
 * composer and in the settings preview. No server code here: the preview runs in the browser.
 */

import { escapeHtml, textToHtml } from "@/lib/util";

export type LogoPosition = "left" | "above";

/** What a signature looks like. `html` is cleaned HTML (lib/compose-html.ts); without it, `text` is shown. */
export type SignatureLook = {
  html: string;
  text: string;
  line: boolean;
  logo: { src: string; width: number; ratio: number; link: string; position: LogoPosition; alt: string } | null;
};

export const LOGO_MIN = 40;
export const LOGO_MAX = 320;
export const LOGO_DEFAULT = 120;

/** The size a logo is shown at: as wide as asked, unless that makes it taller than the widest logo. */
export function logoSize(width: number, ratio: number) {
  const w = Math.min(width, Math.max(1, Math.floor(LOGO_MAX / ratio)));
  return { width: w, height: Math.max(1, Math.round(w * ratio)) };
}

/*
 * Tables, and sizes as attributes: Outlook on Windows ignores the padding of a div and the size
 * set in a style. No text colour, so it reads in light and dark, and a message isn't taken for
 * one with its own colours (htmlHasOwnColors). Fonts are repeated: some mail apps don't pass
 * them down into a table.
 */
const FONT = "font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5";
const TABLE = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;

export function signatureBlock(look: SignatureLook): string {
  const words = look.html || (look.text ? textToHtml(look.text) : "");
  const { logo } = look;
  if (!words && !logo) return "";

  let inner = words;
  if (logo) {
    const { width, height } = logoSize(logo.width, logo.ratio);
    const img = `<img src="${escapeHtml(logo.src)}" width="${width}" height="${height}" alt="${escapeHtml(logo.alt)}" style="display:block;border:0">`;
    const shown = logo.link ? `<a href="${escapeHtml(logo.link)}">${img}</a>` : img;
    if (!words) inner = shown;
    else if (logo.position === "above") inner = `${shown}<div style="padding-top:8px">${words}</div>`;
    else
      inner =
        `<table ${TABLE}><tr><td valign="top" style="padding-right:16px;vertical-align:top">${shown}</td>` +
        `<td valign="top" style="${FONT};vertical-align:top">${words}</td></tr></table>`;
  }
  const line = look.line ? `;padding-top:12px;border-top:1px solid #a6a6a6` : "";
  return `<table ${TABLE} width="100%" style="width:100%;max-width:480px"><tr><td style="${FONT}${line}">${inner}</td></tr></table>`;
}

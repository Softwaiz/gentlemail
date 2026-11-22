// Translations. Every word the webmail shows goes through here (Lingui macros compile to
// i18n._(…) on this object; see lingui.config.ts).
//
// On the Worker, each request gets its own instance in its language (worker.tsx sets how to find
// it); in the browser there is one instance, in the language the page was rendered in.
import { type I18n, type Messages, setupI18n } from "@lingui/core";
import { messages as en } from "@/locales/en/messages";
import { messages as fr } from "@/locales/fr/messages";

export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
const CATALOGS: Record<Locale, Messages> = { en, fr };

export function createI18n(locale: Locale): I18n {
  return setupI18n({ locale, messages: { [locale]: CATALOGS[locale] } });
}

/** The best supported language for an Accept-Language header; English when none fits. */
export function pickLocale(acceptLanguage: string | null): Locale {
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase().split("-")[0];
    if ((LOCALES as readonly string[]).includes(tag)) return tag as Locale;
  }
  return "en";
}

let current: () => I18n = (() => {
  let browser: I18n | undefined;
  return () => (browser ??= createI18n(pickLocale(typeof document === "undefined" ? null : document.documentElement.lang)));
})();

const fallback = createI18n("en");

// The Worker's server components and the server render of client components each load their
// own copy of this file, but share globalThis: the getter lives there so both follow the request.
const KEY = Symbol.for("gentlemail.i18n");
type WithGetter = typeof globalThis & { [KEY]?: () => I18n };

/** Called once by the Worker: from then on, translations use the current request's instance. */
export function followRequestI18n(get: () => I18n) {
  (globalThis as WithGetter)[KEY] = get;
}

/** What the macros call. A thin stand-in that forwards to the right instance at call time. */
export const i18n = new Proxy({} as I18n, {
  get: (_, key) => {
    let target: I18n;
    try {
      target = ((globalThis as WithGetter)[KEY] ?? current)();
    } catch {
      target = fallback; // outside a request (module start-up): English
    }
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

import { defineConfig } from "@lingui/cli";

export default defineConfig({
  sourceLocale: "en",
  // English only for now; a language is added here and as a catalog (src/locales/<locale>/messages.po).
  locales: ["en", "fr"],
  catalogs: [{ path: "<rootDir>/src/locales/{locale}/messages", include: ["src"] }],
  // `npm run i18n` writes messages.ts next to each messages.po: the app imports those, so the
  // build never reads .po files itself (rwsdk's dev server renames them, which Lingui can't follow).
  compileNamespace: "ts",
  // A key not translated yet shows the English text, never a blank or the key itself.
  fallbackLocales: { default: "en" },
  // Macros (t`…`, msg`…`, plural) translate through our i18n object, not Lingui's global one:
  // on the Worker it's one instance per request, so two people in different languages never mix.
  runtimeConfigModule: { i18n: ["@/lib/i18n", "i18n"], Trans: ["@/lib/i18n-trans", "Trans"] },
});

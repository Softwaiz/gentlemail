// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const repo = "https://github.com/Softwaiz/gentlemail";

export default defineConfig({
  site: "https://gentlemail.dev",
  // Served at gentlemail.dev/docs. Files are written to dist/docs so the paths match.
  base: "/docs",
  outDir: "./dist/docs",
  trailingSlash: "ignore",
  integrations: [
    starlight({
      title: "GentleMail docs",
      description: "Run GentleMail, the open-source multi-domain webmail, API and webhooks on your own Cloudflare account.",
      // The gentlemail.dev wordmark (lime dot on dark, olive on light) with a "docs" label (theme.css).
      logo: { dark: "./src/assets/wordmark.svg", light: "./src/assets/wordmark-ink.svg", alt: "GentleMail docs", replacesTitle: true },
      favicon: "/favicon.svg",
      // The social card for every docs page (source: social/og.html). Starlight sets the title and description.
      head: [
        { tag: "meta", attrs: { property: "og:image", content: "https://gentlemail.dev/docs/og.png" } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { property: "og:image:alt", content: "GentleMail docs: deploy it, then send, read and catch mail in code." } },
        { tag: "meta", attrs: { name: "twitter:image", content: "https://gentlemail.dev/docs/og.png" } },
      ],
      // The phone menu and the footer, in the website's style (src/components).
      components: {
        Footer: "./src/components/Footer.astro",
        MobileMenuToggle: "./src/components/MobileMenuToggle.astro",
      },
      social: [{ icon: "github", label: "GitHub", href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/apps/docs/` },
      customCss: ["@fontsource-variable/google-sans", "./src/styles/theme.css"],
      lastUpdated: true,
      sidebar: [
        { label: "Start here", items: ["index", "deploy", "updating"] },
        { label: "Using GentleMail", items: ["guides/two-step", "guides/spam", "mcp"] },
        {
          label: "API",
          items: ["api", "sdk", { label: "SDK changelog", link: "/sdk/changelog/" }, "api/keys", "api/send", "api/read", "api/errors"],
        },
        { label: "Webhooks", items: ["webhooks", "webhooks/verify", "webhooks/recipes"] },
        { label: "Changelog", link: "/changelog/" },
      ],
    }),
  ],
});

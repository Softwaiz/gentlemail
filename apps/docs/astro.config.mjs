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
      logo: { src: "./public/favicon.svg", alt: "GentleMail" },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/apps/docs/` },
      customCss: ["@fontsource-variable/google-sans", "./src/styles/theme.css"],
      lastUpdated: true,
      sidebar: [
        { label: "Start here", items: ["index", "deploy", "updating"] },
        { label: "Using GentleMail", items: ["guides/two-step", "guides/spam"] },
        {
          label: "API",
          items: ["api", "api/keys", "api/send", "api/read", "api/errors"],
        },
        { label: "Webhooks", items: ["webhooks", "webhooks/verify", "webhooks/recipes"] },
        { label: "Changelog", link: "/changelog/" },
      ],
    }),
  ],
});

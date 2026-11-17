import { env } from "cloudflare:workers";
import { requestInfo } from "rwsdk/worker";
import { themeFrom } from "@/lib/theme";
import styles from "./styles.css?url";

export const Document: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  // The theme cookie is read here, so the first paint already has the right colours.
  <html lang="en" data-theme={themeFrom(requestInfo.request.headers.get("Cookie"))}>
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="theme-color" content="#080b10" />
      <meta name="robots" content="noindex, nofollow" />
      <title>{env.APP_NAME || "Mail"}</title>
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="stylesheet" href={styles} />
      <link rel="modulepreload" href="/src/client.tsx" />
    </head>
    <body>
      {children}
      <script>import("/src/client.tsx")</script>
    </body>
  </html>
);

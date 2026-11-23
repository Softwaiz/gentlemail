import { Fragment } from "react";
import type { Decorator, Preview } from "@storybook/react-vite";
import "./styles.css";
import { Toaster } from "../src/app/components/ui/sonner";
import { stayOnStory } from "./fakes/browser";
import { LOCALES, LOCALE_NAMES, type Locale, createI18n, followRequestI18n } from "../src/lib/i18n";
import { env } from "./fakes/cloudflare-workers";
import { type ServerMode, server } from "./fakes/server";

stayOnStory();

/** The app has one language per page; here the toolbar can change it, so translations follow it. */
const languages = Object.fromEntries(LOCALES.map((l) => [l, createI18n(l)])) as Record<Locale, ReturnType<typeof createI18n>>;
let language: Locale = "en";
followRequestI18n(() => languages[language]);

/** Theme, language, app name and how the fake server answers, from the toolbar (or a story's parameters). `parameters.toaster: false` for what brings its own Toaster. */
const withApp: Decorator = (Story, { globals, parameters }) => {
  document.documentElement.dataset.theme = globals.theme ?? "dark";
  language = globals.language ?? "en";
  document.documentElement.lang = language;
  env.APP_NAME = globals.name ?? "GentleMail";
  server.mode = (parameters.server as ServerMode | undefined) ?? globals.server ?? "ok";
  return (
    // Text is translated as it's drawn: another language draws the story again.
    <Fragment key={language}>
      <Story />
      {parameters.toaster !== false && <Toaster />}
    </Fragment>
  );
};

const preview: Preview = {
  decorators: [withApp],
  globalTypes: {
    theme: {
      description: "Theme",
      toolbar: { title: "Theme", icon: "mirror", items: ["dark", "light"], dynamicTitle: true },
    },
    language: {
      description: "Language",
      toolbar: {
        title: "Language",
        icon: "globe",
        items: LOCALES.map((l) => ({ value: l, title: LOCALE_NAMES[l] })),
        dynamicTitle: true,
      },
    },
    name: {
      description: "APP_NAME: the GentleMail logo, or an instance with its own name",
      toolbar: { title: "Name", icon: "edit", items: ["GentleMail", "Acme Mail"], dynamicTitle: true },
    },
    server: {
      description: "How fake server actions answer",
      toolbar: {
        title: "Server",
        icon: "lightning",
        items: [
          { value: "ok", title: "Server: succeeds" },
          { value: "fail", title: "Server: fails" },
          { value: "slow", title: "Server: slow (2.5 s)" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "dark", language: "en", name: "GentleMail", server: "ok" },
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true, sort: "requiredFirst" },
    viewport: {
      options: {
        phone: { name: "Phone", styles: { width: "390px", height: "844px" }, type: "mobile" },
        tablet: { name: "Tablet", styles: { width: "820px", height: "1180px" }, type: "tablet" },
        desktop: { name: "Desktop", styles: { width: "1440px", height: "900px" }, type: "desktop" },
      },
    },
  },
};

export default preview;

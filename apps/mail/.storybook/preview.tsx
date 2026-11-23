import type { Decorator, Preview } from "@storybook/react-vite";
import "./styles.css";
import { Toaster } from "../src/app/components/ui/sonner";
import { stayOnStory } from "./fakes/browser";
import { env } from "./fakes/cloudflare-workers";
import { type ServerMode, server } from "./fakes/server";

stayOnStory();

/** Theme, app name and how the fake server answers, from the toolbar (or a story's parameters). `parameters.toaster: false` for what brings its own Toaster. */
const withApp: Decorator = (Story, { globals, parameters }) => {
  document.documentElement.dataset.theme = globals.theme ?? "dark";
  env.APP_NAME = globals.name ?? "GentleMail";
  server.mode = (parameters.server as ServerMode | undefined) ?? globals.server ?? "ok";
  return (
    <>
      <Story />
      {parameters.toaster !== false && <Toaster />}
    </>
  );
};

const preview: Preview = {
  decorators: [withApp],
  globalTypes: {
    theme: {
      description: "Theme",
      toolbar: { title: "Theme", icon: "mirror", items: ["dark", "light"], dynamicTitle: true },
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
  initialGlobals: { theme: "dark", name: "GentleMail", server: "ok" },
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

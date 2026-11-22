import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs"],
  framework: {
    name: "@storybook/react-vite",
    // Not the app's vite.config.ts: that one starts the Worker (rwsdk, Cloudflare). Stories run in the browser only.
    options: { builder: { viteConfigPath: ".storybook/vite.config.ts" } },
  },
  // react-docgen reads prop types from the source. react-docgen-typescript needs the JavaScript
  // compiler API, which TypeScript 7 (this project's) no longer has.
  typescript: { reactDocgen: "react-docgen" },
  core: { disableTelemetry: true },
};

export default config;

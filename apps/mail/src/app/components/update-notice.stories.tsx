import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import type { Release } from "@/lib/releases";
import { UpdateNotice } from "./update-notice";

/*
 * The pop-up about a newer version, on its own. Where it shows in the app (admins only, never
 * while writing, on a phone): "App/Sidebar and frame".
 */

const fix: Release = { version: "0.8.1", date: "2026-12-04", sections: { Fixed: ["A long subject no longer hides the date."] } };
const steps: Release = {
  version: "0.8.0",
  date: "2026-12-01",
  sections: { Added: ["Formatted signatures, with a logo."], Upgrading: ["Migration 0011_signatures.sql. Until it's applied, mailbox settings can't be saved."] },
};
const security: Release = { version: "0.9.0", date: "2026-12-10", sections: { Security: ["Sign-in links expire sooner."] } };

const meta = {
  title: "App/Update notice",
  component: UpdateNotice,
  args: { announce: true, news: { current: "0.8.0", later: false, releases: [fix] } },
  decorators: [
    (Story) => (
      <div className="w-64 bg-sidebar p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UpdateNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

const open = () => screen.findByRole("dialog");
const gone = () => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

/** A fix: nothing to do first, no word about security. */
export const Fix: Story = {
  globals: { language: "en" },
  play: async () => {
    const dialog = await open();
    await expect(dialog).toHaveTextContent("You have 0.8.0.");
    await expect(dialog).not.toHaveTextContent("Before you update");
    await expect(dialog).not.toHaveTextContent("security");
  },
};

export const WithSteps: Story = { args: { news: { current: "0.7.2", later: false, releases: [steps] } } };
export const Security: Story = { args: { news: { current: "0.8.1", later: false, releases: [security] } } };

/** Several releases behind: every release's changes, and the steps of all of them first. */
export const SeveralBehind: Story = {
  args: { news: { current: "0.7.2", later: false, releases: [security, fix, steps] } },
  globals: { language: "en" },
  play: async ({ canvasElement, step }) => {
    const line = () => within(canvasElement).getByText("GentleMail 0.9.0 is available");
    await step("says what to do and what changed", async () => {
      const dialog = await open();
      for (const text of ["Before you update", "0011_signatures.sql", "security changes", "0.8.1", "git pull"]) await expect(dialog).toHaveTextContent(text);
    });
    await step("Escape closes it; the line opens it again", async () => {
      await userEvent.keyboard("{Escape}");
      await gone();
      await userEvent.click(line());
      await open();
    });
    await step("Later closes it", async () => {
      await userEvent.click(within(await open()).getByRole("button", { name: "Later" }));
      await gone();
    });
  },
};

/** Closed before: the line only. */
export const Later: Story = { args: { news: { current: "0.8.0", later: true, releases: [fix] } } };

/** A lot to read: it scrolls, the buttons stay. */
export const Long: Story = {
  args: {
    news: {
      current: "0.7.2",
      later: false,
      releases: [{ version: "0.9.0", date: "2026-12-10", sections: { Added: Array.from({ length: 40 }, (_, n) => `Change number ${n + 1}, described in a sentence long enough to take two lines in the pop-up.`) } }],
    },
  },
};

/** The words around it are in French; the release notes stay in English, as they are written. */
export const French: Story = { args: { news: { current: "0.7.2", later: false, releases: [security, steps] } }, globals: { language: "fr" } };

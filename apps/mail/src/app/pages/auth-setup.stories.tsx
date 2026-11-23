import type { Meta, StoryObj } from "@storybook/react-vite";
import { SetupView } from "./auth-views";

/* A new instance's first screen, from auth-views.tsx. */

const meta = {
  title: "Screens/First-run setup",
  component: SetupView,
  args: { hasToken: true },
} satisfies Meta<typeof SetupView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstRunSetup: Story = {};
export const SetupWithoutToken: Story = { args: { hasToken: false } };
/** What was typed stays, except the token and the password. */
export const InvalidSetupToken: Story = { args: { err: "Invalid setup token.", bad: "token", name: "Ada Lovelace", email: "ada@example.com" } };
export const PasswordTooShort: Story = {
  args: { err: "Password too short: use 10 characters or more.", bad: "password", name: "Ada Lovelace", email: "ada@example.com" },
};
export const French: Story = { globals: { language: "fr" } };

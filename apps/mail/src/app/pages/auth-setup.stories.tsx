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
export const InvalidSetupToken: Story = { args: { err: "Invalid setup token." } };
